-- AgentJira — coarse (broken-down) blocks gain a completion semantics.
--
-- Design gap being closed: when a node that blocks some outside node is broken
-- down, aj-breakdown INTENTIONALLY leaves the block on the parent as a "coarse"
-- block — it must NOT be fanned onto every child (see aj-breakdown/SKILL.md:
-- "Do NOT replicate the parent's outside blocks onto each child"). The coarse
-- block stands in for "wait for the parent's work", which is now its subtree.
--
-- But the gate only ever satisfied a plain firm_block / soft_block when the
-- source reached status 'done', and a broken_down container NEVER reaches
-- 'done'. So a coarse block gated its target forever, with no path to clear —
-- the breakdown side created coarse blocks on purpose, the gating side had no
-- way to satisfy them. (firm_block_plan / soft_block_plan already dodge this
-- via their merge_sha rule; the plain variants had nothing.)
--
-- This RPC supplies the completion semantics the breakdown design assumes: a
-- broken-down source is satisfied when its whole subtask subtree is complete —
-- no descendant is still in a LIVE (pending-work) status. Callers (aj tasks,
-- aj context) treat such a source as no longer gating.
--
-- LIVE status = pending work: any node status EXCEPT the terminal/container
-- ones done / invalidated / broken_down. Traversal follows non-removed subtask
-- edges, prunes at invalidated nodes (their subtree is stale/dead), guards
-- against cycles per branch via the visited path, and caps depth at 50 (cycles
-- are legal data — same convention as stale_node_ids / node_context).
--
-- Intended for broken_down (container) sources, but well-defined for any node:
-- a 'done' node is trivially complete; a node with a live descendant is not.

create or replace function public.subtree_complete(p_ids uuid[])
returns table (id uuid, complete boolean)
language sql
stable
as $$
  with recursive tree as (
    -- Roots: each requested node at depth 0, seeding its own branch path.
    select r as root_id, r as node_id, 0 as depth, array[r] as path
      from unnest(p_ids) as r
    union all
    -- Descend into children via non-removed subtask edges. Do not expand past
    -- an invalidated node (its subtree is dead), and skip any node already on
    -- this branch's path (cycle guard). Depth capped at 50.
    select t.root_id, e.target_id, t.depth + 1, t.path || e.target_id
      from tree t
      join public.nodes n on n.id = t.node_id
      join public.edges e
        on e.source_id = t.node_id
       and e.type = 'subtask'
       and e.removed_at is null
     where t.depth < 50
       and n.status <> 'invalidated'
       and not (e.target_id = any (t.path))
  ),
  -- A root has pending work iff any node in its (pruned) subtree — the root
  -- itself included — is in a live status.
  live_roots as (
    select distinct t.root_id
      from tree t
      join public.nodes n on n.id = t.node_id
     where n.status not in ('done', 'invalidated', 'broken_down')
  )
  select r as id, (lr.root_id is null) as complete
    from unnest(p_ids) as r
    left join live_roots lr on lr.root_id = r;
$$;

-- Grants, consistent with 0002/0003.
grant execute on function public.subtree_complete(uuid[]) to authenticated, service_role;
