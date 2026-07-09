import { STATUS_META } from './statusMeta'
import type { NodeEdge, TaskNode } from './types'

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
 *   - it is not firm-blocked by an unfinished blocker (blocker status !== 'done').
 *
 * Soft blocks do NOT disqualify a node — they are judgment, not a gate, exactly
 * as `aj tasks` keeps soft-blocked nodes in RECOMMENDED (with a warning).
 *
 * Pass the FULL node/edge sets (not a filtered view) so every blocker is present.
 */
export function readyToPickupIds(
  nodes: TaskNode[],
  edges: NodeEdge[],
  invalidSet: Set<string>,
): Set<string> {
  const statusById = new Map(nodes.map((n) => [n.id, n.status]))

  // Targets with at least one unfinished firm-block. An unknown blocker (edge to
  // a node we can't see) counts as unfinished — same as `aj tasks`.
  const firmBlocked = new Set<string>()
  for (const e of edges) {
    if (e.type !== 'firm_block' || e.removed_at !== null) continue
    if (statusById.get(e.source_id) !== 'done') firmBlocked.add(e.target_id)
  }

  const ready = new Set<string>()
  for (const n of nodes) {
    if (STATUS_META[n.status].turn !== 'agent') continue
    if (invalidSet.has(n.id)) continue // invalidated or stale
    if (n.claimed_by !== null) continue // already in flight
    if (firmBlocked.has(n.id)) continue
    ready.add(n.id)
  }
  return ready
}
