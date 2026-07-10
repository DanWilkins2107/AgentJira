-- AgentJira — plan-variant block edges.
--
-- Companion to 0008 (breakdown_on_merge). A plan-deliverable node has TWO
-- milestones: its decision/plan document merging, and the follow-up split of
-- the planned work finishing. Plain firm/soft blocks gate on "source is done",
-- which over-blocks targets that only depend on the DECISION — after the plan
-- merges and the node re-enters breakdown (or later sits at broken_down), the
-- decision exists but the block stays armed indefinitely.
--
-- edge_type 'firm_block_plan' / 'soft_block_plan' (source -> target): behave
-- exactly like firm_block / soft_block until the source's plan LANDS —
-- source status = 'done' OR source.merge_sha is recorded — and are satisfied
-- (informational only, no longer gating pickup) from then on. Read-side
-- judgment as always: blocks are information for agents, never hard DB
-- constraints; no cycle enforcement.
--
-- Postgres note: ALTER TYPE ... ADD VALUE is transaction-safe on PG12+ so long
-- as the new label is not *used* (cast/compared) in the same transaction.
-- node_context below only stores the labels as text in a plpgsql body
-- (resolved at call time), mirroring 0007.

alter type public.edge_type add value if not exists 'firm_block_plan' after 'firm_block';
alter type public.edge_type add value if not exists 'soft_block_plan' after 'soft_block';

-- ---------------------------------------------------------------------------
-- node_context: identical to 0007's shape, but the curated `blockers` list
-- also surfaces the plan variants (block_type = 'firm_block_plan' /
-- 'soft_block_plan'). Each blocker row already carries status; it now also
-- carries merge_sha so callers can apply the plan-landed rule.
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

  -- Blockers: sources of non-removed block-family edges targeting this node,
  -- including the plan variants. A blocker's own (possibly invalidated) status
  -- is the signal — blockers never make this node stale. merge_sha is included
  -- so plan-variant satisfaction ("plan landed") is computable by callers.
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', b.id,
           'title', b.title,
           'status', b.status,
           'stale', b.id = any (v_stale),
           'merge_sha', b.merge_sha,
           'block_type', e.type) order by e.created_at), '[]'::jsonb)
    into v_blockers
    from public.edges e
    join public.nodes b on b.id = e.source_id
   where e.target_id = p_node
     and e.type in ('firm_block', 'soft_block', 'firm_block_plan', 'soft_block_plan', 'reassess_after')
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
