import { STATUS_META } from './statusMeta'
import type { NodeEdge, TaskNode } from './types'

/**
 * Has this node's plan LANDED? The satisfaction point for plan-variant block
 * edges (firm_block_plan / soft_block_plan): the node finished outright, or
 * its deliverable merged (typically a breakdown_on_merge node whose plan PR
 * merged and which re-entered breakdown to split the planned work).
 */
export function planLanded(node: TaskNode): boolean {
  return node.status === 'done' || node.merge_sha !== null
}

/**
 * Node ids an agent could pick up **right now** — the graph's parallelization
 * frontier (how many independent things an agent could start in parallel).
 *
 * This mirrors the RECOMMENDED set of `aj tasks` (cli/src/commands/tasks.ts),
 * which is the contract for "actionable now". A node is ready iff:
 *
 *   - its status is an agent-turn status (STATUS_META[status].turn === 'agent'),
 *   - it is not stale/invalidated — pass the derived set from
 *     `effectivelyInvalidated`; such nodes are dead until the ancestor is
 *     restored,
 *   - it is not claimed — a claimed node is already in flight, not a fresh
 *     pickup, and
 *   - it is not firm-blocked, nor reassess_after-blocked, by an unfinished
 *     blocker (blocker status !== 'done'). A reassess_after edge gates pickup
 *     like a firm block — the node is deferred for re-judgment until then. A
 *     firm_block_plan edge gates only until the blocker's PLAN LANDS (blocker
 *     status 'done' OR merge_sha recorded) — the decision exists from then on,
 *     even while the blocker's own follow-up breakdown continues.
 *
 * Soft blocks (and soft_block_plan) do NOT disqualify a node — they are
 * judgment, not a gate, exactly as `aj tasks` keeps soft-blocked nodes in
 * RECOMMENDED (with a warning).
 *
 * Pass the FULL node/edge sets (not a filtered view) so every blocker is present.
 */
export function readyToPickupIds(
  nodes: TaskNode[],
  edges: NodeEdge[],
  invalidSet: Set<string>,
): Set<string> {
  const nodeById = new Map(nodes.map((n) => [n.id, n]))

  // Targets with at least one unfinished firm-block, firm_block_plan, or
  // reassess_after gate. An unknown blocker (edge to a node we can't see)
  // counts as unfinished — same as `aj tasks`.
  const gated = new Set<string>()
  for (const e of edges) {
    if (e.removed_at !== null) continue
    const source = nodeById.get(e.source_id)
    if (e.type === 'firm_block' || e.type === 'reassess_after') {
      if (source?.status !== 'done') gated.add(e.target_id)
    } else if (e.type === 'firm_block_plan') {
      if (!source || !planLanded(source)) gated.add(e.target_id)
    }
  }

  const ready = new Set<string>()
  for (const n of nodes) {
    if (STATUS_META[n.status].turn !== 'agent') continue
    if (invalidSet.has(n.id)) continue // invalidated or stale
    if (n.claimed_by !== null) continue // already in flight
    if (gated.has(n.id)) continue
    ready.add(n.id)
  }
  return ready
}
