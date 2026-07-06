-- AgentJira — staleness becomes derived-only.
-- Contract change (docs/architecture.md): a node is STALE iff its own status
-- is not 'invalidated' and at least one ancestor via non-removed `subtask`
-- edges is 'invalidated'. Stale is computed at read time, never persisted:
-- restoring the invalidated ancestor un-stales the whole subtree with zero
-- writes. Blocks never affect staleness — a blocker's status is already
-- visible in node_context/blockers.
--
-- History is sacred: existing `node.marked_stale` event rows stay untouched;
-- the event type is simply no longer emitted. Dropping the `stale` COLUMN is
-- schema evolution, not history deletion.

-- ---------------------------------------------------------------------------
-- 1. Node-update logging trigger without the stale clause. Replaced BEFORE
--    the column drop so the trigger never references a missing column.
-- ---------------------------------------------------------------------------

create or replace function public.log_node_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text := current_actor_role(new.project_id);
  v_changed jsonb := '{}'::jsonb;
begin
  -- Status transitions always get their own event with {from, to}.
  if new.status is distinct from old.status then
    insert into events (project_id, node_id, actor_id, actor_role, type, data)
    values (new.project_id, new.id, auth.uid(), v_role, 'node.status_changed',
            jsonb_build_object('from', old.status, 'to', new.status));
  end if;

  -- Claim changes get their own events too.
  if new.claimed_by is distinct from old.claimed_by then
    if new.claimed_by is not null then
      insert into events (project_id, node_id, actor_id, actor_role, type, data)
      values (new.project_id, new.id, auth.uid(), v_role, 'node.claimed',
              jsonb_build_object('claimed_by', new.claimed_by));
    else
      insert into events (project_id, node_id, actor_id, actor_role, type, data)
      values (new.project_id, new.id, auth.uid(), v_role, 'node.unclaimed',
              jsonb_build_object('was_claimed_by', old.claimed_by));
    end if;
  end if;

  -- Everything else: one node.updated event listing the changed fields.
  if new.title is distinct from old.title then
    v_changed := v_changed || jsonb_build_object('title', new.title);
  end if;
  if new.body is distinct from old.body then
    v_changed := v_changed || jsonb_build_object('body', 'changed');
  end if;
  if new.spec is distinct from old.spec then
    v_changed := v_changed || jsonb_build_object('spec', 'changed');
  end if;
  if new.pr_url is distinct from old.pr_url then
    v_changed := v_changed || jsonb_build_object('pr_url', new.pr_url);
  end if;
  if new.pr_number is distinct from old.pr_number then
    v_changed := v_changed || jsonb_build_object('pr_number', new.pr_number);
  end if;
  if new.merge_sha is distinct from old.merge_sha then
    v_changed := v_changed || jsonb_build_object('merge_sha', new.merge_sha);
  end if;
  if new.invalidation_reason is distinct from old.invalidation_reason then
    v_changed := v_changed || jsonb_build_object('invalidation_reason', new.invalidation_reason);
  end if;
  if new.tldraw_doc is distinct from old.tldraw_doc then
    v_changed := v_changed || jsonb_build_object('tldraw_doc', 'changed');
  end if;
  if new.canvas_png_path is distinct from old.canvas_png_path then
    v_changed := v_changed || jsonb_build_object('canvas_png_path', new.canvas_png_path);
  end if;

  if v_changed <> '{}'::jsonb then
    insert into events (project_id, node_id, actor_id, actor_role, type, data)
    values (new.project_id, new.id, auth.uid(), v_role, 'node.updated',
            jsonb_build_object('changed', v_changed));
  end if;

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Drop the persisted flag. Nothing else references it (the fts generated
--    column does not include stale).
-- ---------------------------------------------------------------------------

alter table public.nodes drop column stale;

-- ---------------------------------------------------------------------------
-- 3. invalidate_node: status + reason + node.invalidated event only. The old
--    stale-marking BFS (descendants and firm-block targets) is gone —
--    staleness is derived at read time and blocks never affect it.
-- ---------------------------------------------------------------------------

create or replace function public.invalidate_node(p_node uuid, p_reason text)
returns void
language plpgsql
as $$
declare
  v_project uuid;
begin
  update public.nodes
     set status = 'invalidated',
         invalidation_reason = p_reason
   where id = p_node
   returning project_id into v_project;

  if v_project is null then
    raise exception 'node not found';
  end if;

  insert into public.events (project_id, node_id, actor_id, actor_role, type, data)
  values (v_project, p_node, auth.uid(), public.current_actor_role(v_project),
          'node.invalidated', jsonb_build_object('reason', p_reason));
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. stale_node_ids: the project's derived stale set. BFS down from every
--    'invalidated' node via non-removed `subtask` edges (visited-set,
--    depth <= 50 — cycles are legal data); a reached node is stale unless its
--    own status is 'invalidated'. Security invoker: RLS applies to the caller.
-- ---------------------------------------------------------------------------

create function public.stale_node_ids(p_project uuid)
returns setof uuid
language plpgsql
stable
as $$
declare
  v_visited uuid[];
  v_frontier uuid[];
  v_next uuid[];
  v_depth integer := 0;
begin
  select coalesce(array_agg(n.id), '{}'::uuid[])
    into v_frontier
    from public.nodes n
   where n.project_id = p_project
     and n.status = 'invalidated';

  v_visited := v_frontier;

  while v_depth < 50 loop
    select coalesce(array_agg(distinct e.target_id), '{}'::uuid[])
      into v_next
      from public.edges e
     where e.source_id = any (v_frontier)
       and e.type = 'subtask'
       and e.removed_at is null
       and not (e.target_id = any (v_visited));

    exit when v_next = '{}'::uuid[];

    return query
      select n.id
        from public.nodes n
       where n.id = any (v_next)
         and n.status <> 'invalidated';

    v_visited := v_visited || v_next;
    v_frontier := v_next;
    v_depth := v_depth + 1;
  end loop;
end;
$$;

-- Grants, consistent with 0002 (default privileges already cover functions
-- created by postgres; explicit for clarity).
grant execute on function public.stale_node_ids(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 5. node_context: identical response shape (the JSON field is still named
--    `stale` everywhere it was), but the value is now DERIVED — membership in
--    the project's stale_node_ids set, computed once per call.
-- ---------------------------------------------------------------------------

create or replace function public.node_context(p_node uuid)
returns jsonb
language plpgsql
stable
as $$
declare
  v_node public.nodes%rowtype;
  v_stale uuid[];
  v_edges jsonb;
  v_ancestors jsonb := '[]'::jsonb;
  v_children jsonb;
  v_blockers jsonb;
  v_visited uuid[];
  v_frontier uuid[];
  v_next uuid[];
  v_depth integer := 0;
  v_level jsonb;
begin
  select * into v_node from public.nodes where id = p_node;
  if not found then
    raise exception 'node not found';
  end if;

  -- Derived stale set for the whole project, computed once.
  select coalesce(array_agg(s), '{}'::uuid[])
    into v_stale
    from public.stale_node_ids(v_node.project_id) s;

  -- Edges, both directions, including removed ones.
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', e.id,
           'type', e.type,
           'source_id', e.source_id,
           'target_id', e.target_id,
           'removed_at', e.removed_at,
           'created_at', e.created_at,
           'direction', case when e.source_id = p_node then 'out' else 'in' end,
           'other_node', jsonb_build_object(
             'id', o.id, 'title', o.title, 'status', o.status,
             'stale', o.id = any (v_stale))
         ) order by e.created_at), '[]'::jsonb)
    into v_edges
    from public.edges e
    join public.nodes o
      on o.id = case when e.source_id = p_node then e.target_id else e.source_id end
   where e.source_id = p_node or e.target_id = p_node;

  -- Ancestor chain: walk up non-removed subtask edges (parent = source).
  v_visited := array[p_node];
  v_frontier := array[p_node];
  while v_depth < 50 loop
    select coalesce(array_agg(distinct e.source_id), '{}'::uuid[])
      into v_next
      from public.edges e
     where e.target_id = any (v_frontier)
       and e.type = 'subtask'
       and e.removed_at is null
       and not (e.source_id = any (v_visited));

    exit when v_next = '{}'::uuid[];
    v_depth := v_depth + 1;

    select coalesce(jsonb_agg(jsonb_build_object(
             'id', n.id,
             'title', n.title,
             'status', n.status,
             'stale', n.id = any (v_stale),
             'invalidation_reason', n.invalidation_reason,
             'is_vision', n.is_vision,
             'depth', v_depth)), '[]'::jsonb)
      into v_level
      from public.nodes n
     where n.id = any (v_next);

    v_ancestors := v_ancestors || v_level;
    v_visited := v_visited || v_next;
    v_frontier := v_next;
  end loop;

  -- Children: targets of non-removed subtask edges from this node.
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', c.id,
           'title', c.title,
           'status', c.status,
           'stale', c.id = any (v_stale),
           'claimed_by', c.claimed_by) order by c.created_at), '[]'::jsonb)
    into v_children
    from public.edges e
    join public.nodes c on c.id = e.target_id
   where e.source_id = p_node
     and e.type = 'subtask'
     and e.removed_at is null;

  -- Blockers: sources of non-removed firm/soft block edges targeting this node.
  -- A blocker's own (possibly invalidated) status is the signal — blockers
  -- never make this node stale.
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', b.id,
           'title', b.title,
           'status', b.status,
           'stale', b.id = any (v_stale),
           'block_type', e.type) order by e.created_at), '[]'::jsonb)
    into v_blockers
    from public.edges e
    join public.nodes b on b.id = e.source_id
   where e.target_id = p_node
     and e.type in ('firm_block', 'soft_block')
     and e.removed_at is null;

  return jsonb_build_object(
    'node', (to_jsonb(v_node) - 'fts')
              || jsonb_build_object('stale', v_node.id = any (v_stale)),
    'edges', v_edges,
    'ancestors', v_ancestors,
    'children', v_children,
    'blockers', v_blockers
  );
end;
$$;
