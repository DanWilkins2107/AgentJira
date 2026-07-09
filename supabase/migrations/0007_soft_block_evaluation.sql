-- AgentJira — soft-block evaluation.
-- The LLM-judge handoff lands in the STATE layer as two additions the board
-- itself never reasons about (the board never calls an LLM). See
-- docs/architecture.md.
--
-- 1. node_status 'evaluating_soft_block' (agent turn): a soft-blocked node has
--    been queued for the soft-block judge. An external supervisor watches for
--    this agent-turn status and dispatches a fresh headless judge session; the
--    judge routes the node onward — proceed, escalate to the human
--    (awaiting_human_response), or defer for reassessment (a reassess_after
--    edge). The supervisor stays deterministic plain code and never reads the
--    verdict; all LLM judgment lives in the throwaway judge session.
--
-- 2. edge_type 'reassess_after' (source -> target): the target should be
--    reassessed after the source resolves. It BEHAVES LIKE A FIRM BLOCK — a
--    node targeted by a non-removed reassess_after edge whose source is not
--    'done' is held back from pickup (aj tasks / graph frontier) — but the
--    intent is "come back and re-judge", not "wait forever". Blocks are
--    information for agents, never hard DB constraints; no cycle enforcement.
--
-- Postgres note: ALTER TYPE ... ADD VALUE is transaction-safe on PG12+ so long
-- as the new label is not *used* (cast/compared) in the same transaction.
-- Re-creating node_context below only STORES 'reassess_after' as text in a
-- plpgsql body (resolved at call time, not now), so this migration is safe.

-- ---------------------------------------------------------------------------
-- 1. New enum labels. Positioned to keep each enum's declared order aligned
--    with the pipeline / edge families (mirrors 0006's `after` convention).
-- ---------------------------------------------------------------------------

alter type public.node_status add value if not exists 'evaluating_soft_block' after 'ready_for_pickup';
alter type public.edge_type add value if not exists 'reassess_after' after 'soft_block';

-- ---------------------------------------------------------------------------
-- 2. node_context: identical response shape and derived-stale semantics as
--    0003, but the curated `blockers` list now also surfaces reassess_after
--    edges (block_type = 'reassess_after') alongside firm/soft blocks, since a
--    reassess_after edge gates pickup exactly like a firm block. A blocker's
--    own status is the signal — blockers never make this node stale.
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

  -- Blockers: sources of non-removed firm/soft/reassess_after block edges
  -- targeting this node. A blocker's own (possibly invalidated) status is the
  -- signal — blockers never make this node stale.
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
     and e.type in ('firm_block', 'soft_block', 'reassess_after')
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
