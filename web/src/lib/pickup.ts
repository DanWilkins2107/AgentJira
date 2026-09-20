import { treeLayout } from './graphLayout'
import { STATUS_META } from './statusMeta'
import type { GraphNode, NodeEdge } from './types'

/**
 * Has this node's plan LANDED? The satisfaction point for plan-variant block
 * edges (firm_block_plan / soft_block_plan). A `_plan` edge asks for the
 * source's DECISION, not its implementation, and that decision exists once:
 *
 *   - the node finished outright (`done`), or
 *   - its deliverable merged (`merge_sha` — typically a breakdown_on_merge node
 *     whose plan PR merged and which re-entered breakdown to split the work), or
 *   - the node was BROKEN DOWN. Reaching `broken_down` *is* the decision
 *     landing: the split has been approved and materialized. A node broken down
 *     WITHOUT a plan-document PR reaches neither `done` nor a `merge_sha`, so
 *     without this its `_plan` edges would gate their targets permanently.
 *
 * If a target also needs some child's implementation, that belongs as a new
 * explicit block edge on the relevant child, added when needed.
 *
 * Deliberately NOT the rule for plain firm_block / soft_block from a
 * broken_down source: those are coarse parent-level blocks that keep gating
 * until the whole subtree completes (see `subtreeCompleteIds`).
 */
export function planLanded(node: GraphNode): boolean {
  return node.status === 'done' || node.status === 'broken_down' || node.merge_sha !== null
}

/** Statuses that are NOT live work: terminal (done/invalidated) or a container
 * (broken_down). Everything else is pending work that keeps a subtree open. */
const NON_LIVE_STATUSES = new Set<string>(['done', 'invalidated', 'broken_down'])

/**
 * Node ids whose subtask subtree carries no pending work — the client-side
 * mirror of the `subtree_complete` RPC (migration 0010). A node qualifies iff
 * no node within its subtree (the node itself included) is in a LIVE status.
 * The walk follows non-removed subtask edges, prunes at invalidated nodes (a
 * dead subtree), guards cycles per branch, and caps depth at 50 (cycles are
 * legal data). This is what lets a coarse block — a firm/soft block left on a
 * `broken_down` parent, which can never reach `done` — finally satisfy.
 *
 * Pass the FULL node/edge sets so the whole subtree is present.
 */
export function subtreeCompleteIds(nodes: GraphNode[], edges: NodeEdge[]): Set<string> {
  const childrenBySource = new Map<string, string[]>()
  for (const e of edges) {
    if (e.removed_at !== null || e.type !== 'subtask') continue
    const list = childrenBySource.get(e.source_id)
    if (list) list.push(e.target_id)
    else childrenBySource.set(e.source_id, [e.target_id])
  }
  const statusById = new Map(nodes.map((n) => [n.id, n.status as string]))
  const complete = new Set<string>()
  for (const root of nodes) {
    const seen = new Set<string>()
    const stack: { id: string; depth: number }[] = [{ id: root.id, depth: 0 }]
    let live = false
    while (stack.length > 0) {
      const { id, depth } = stack.pop() as { id: string; depth: number }
      if (seen.has(id) || depth > 50) continue
      seen.add(id)
      const status = statusById.get(id)
      if (status === undefined) continue
      if (!NON_LIVE_STATUSES.has(status)) {
        live = true
        break
      }
      if (status === 'invalidated') continue // prune: dead subtree
      for (const c of childrenBySource.get(id) ?? []) stack.push({ id: c, depth: depth + 1 })
    }
    if (!live) complete.add(root.id)
  }
  return complete
}

/**
 * Progress of a `broken_down` container toward clearing its coarse gates: of its
 * DIRECT subtask children, how many are settled. A child is settled when it is
 * terminal (done/invalidated) or is itself a complete container. When
 * settled === total the whole subtree is complete (see `subtreeCompleteIds`),
 * so the container's coarse blocks stop gating. Pass the `completeIds` set from
 * `subtreeCompleteIds` so container children are judged consistently.
 */
export function directChildrenSettled(
  nodeId: string,
  nodes: GraphNode[],
  edges: NodeEdge[],
  completeIds: Set<string>,
): { settled: number; total: number } {
  const statusById = new Map(nodes.map((n) => [n.id, n.status as string]))
  let settled = 0
  let total = 0
  for (const e of edges) {
    if (e.removed_at !== null || e.type !== 'subtask' || e.source_id !== nodeId) continue
    total += 1
    const status = statusById.get(e.target_id)
    if (
      status === 'done' ||
      status === 'invalidated' ||
      (status === 'broken_down' && completeIds.has(e.target_id))
    ) {
      settled += 1
    }
  }
  return { settled, total }
}

/**
 * Targets with at least one UNFINISHED firm-family gate — the reason a node
 * is held back from pickup.
 *
 * DEAD FIRST: a blocker whose own status is `invalidated`, or that is itself
 * stale, is **dead** and stops gating outright — for every block-family edge
 * type. A dead node can never reach `done` (invalidated is terminal; a stale
 * node is dead until its ancestor is restored), so the plain status rule would
 * park its target forever with no release but hand-removing the edge. Pass
 * `deadSet` — the very set `effectivelyInvalidated` returns (invalidated ∪
 * stale), the same one the callers already use to exclude dead TARGETS; here it
 * is applied to block SOURCES. Checking it first also means a stale
 * `broken_down` blocker needs no subtree lookup and a `merge_sha` on an
 * invalidated one is moot. Nothing is written and no edge changes: restoring
 * the invalidated node re-arms every block it was carrying.
 *
 * Otherwise a firm_block or reassess_after gates until its source is `done`, or
 * — when the source is a `broken_down` parent (a coarse block) — until its
 * subtree is complete (see `subtreeCompleteIds`). A firm_block_plan gates only
 * until the source's PLAN LANDS (source `done`, `broken_down`, OR merge_sha
 * recorded — see `planLanded`), even while the source's own follow-up breakdown
 * continues. An unknown blocker (edge to a node we can't see) counts as
 * unfinished — same as `aj tasks`. Soft blocks (and soft_block_plan) never
 * gate: they are judgment, not a constraint.
 *
 * Pass the FULL node/edge sets (not a filtered view) so every blocker is present.
 */
export function firmlyGatedTargets(
  nodes: GraphNode[],
  edges: NodeEdge[],
  deadSet: Set<string>,
): Set<string> {
  const nodeById = new Map(nodes.map((n) => [n.id, n]))
  const completeIds = subtreeCompleteIds(nodes, edges)
  const gated = new Set<string>()
  for (const e of edges) {
    if (e.removed_at !== null) continue
    if (deadSet.has(e.source_id)) continue // dead blocker — no longer gates
    const source = nodeById.get(e.source_id)
    if (e.type === 'firm_block' || e.type === 'reassess_after') {
      const satisfied =
        source?.status === 'done' ||
        (source?.status === 'broken_down' && completeIds.has(source.id))
      if (!satisfied) gated.add(e.target_id)
    } else if (e.type === 'firm_block_plan') {
      if (!source || !planLanded(source)) gated.add(e.target_id)
    }
  }
  return gated
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
 *   - it is not firmly gated (see `firmlyGatedTargets`).
 *
 * Pass the FULL node/edge sets (not a filtered view) so every blocker is present.
 */
export function readyToPickupIds(
  nodes: GraphNode[],
  edges: NodeEdge[],
  invalidSet: Set<string>,
): Set<string> {
  const gated = firmlyGatedTargets(nodes, edges, invalidSet)
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

/**
 * The agent side of the board, counted: how many nodes are an agent's to move,
 * and how many of those an agent already holds.
 *
 * `available` is every agent-turn node that isn't dead or parked — the same
 * exclusions as `readyToPickupIds` (not stale/invalidated, not firmly gated)
 * MINUS the claim filter, so a node an agent is working on right now still
 * counts as agent work. `inProgress` is exactly that claimed subset, so
 * `available - inProgress` is `readyToPickupIds().size` — the queue waiting to
 * be picked up.
 *
 * Pass the FULL node/edge sets (not a filtered view) so every blocker is present.
 */
export function agentWorkload(
  nodes: GraphNode[],
  edges: NodeEdge[],
  invalidSet: Set<string>,
): { available: number; inProgress: number } {
  const gated = firmlyGatedTargets(nodes, edges, invalidSet)
  let available = 0
  let inProgress = 0
  for (const n of nodes) {
    if (STATUS_META[n.status].turn !== 'agent') continue
    if (invalidSet.has(n.id)) continue // invalidated or stale
    if (gated.has(n.id)) continue
    available += 1
    if (n.claimed_by !== null) inProgress += 1
  }
  return { available, inProgress }
}

/**
 * Node ids nobody should pick up yet because an unfinished firm-family gate
 * holds them — the exact reason they're sitting idle. Covers BOTH turns that
 * can act on a node: agent-turn (the complement of `readyToPickupIds` within
 * {agent-turn, not stale, not claimed} — so ready and blocked are disjoint)
 * and human-turn, including `human_only_action`. A gate is a gate whoever
 * holds the node: doing the work early is wasted either way, so the card must
 * read as parked rather than as the loudest thing on the board.
 *
 * Wider than `aj tasks`, which lists agent-turn statuses only — the human view
 * is the only place human-turn gating is visible at all.
 *
 * Pass the FULL node/edge sets (not a filtered view) so every blocker is present.
 */
export function blockedFromPickupIds(
  nodes: GraphNode[],
  edges: NodeEdge[],
  invalidSet: Set<string>,
): Set<string> {
  const gated = firmlyGatedTargets(nodes, edges, invalidSet)
  const blocked = new Set<string>()
  for (const n of nodes) {
    const turn = STATUS_META[n.status].turn
    if (turn !== 'agent' && turn !== 'human') continue
    if (invalidSet.has(n.id)) continue // invalidated or stale
    if (n.claimed_by !== null) continue // already in flight
    if (!gated.has(n.id)) continue
    blocked.add(n.id)
  }
  return blocked
}

/**
 * Agent-turn, non-stale nodes carrying at least one ACTIVE soft-family block —
 * shared-decision advice, not a gate (mirrors the "SOFT-BLOCKED" annotation in
 * `aj tasks`). A soft block from a DEAD source (invalidated or stale — pass the
 * set from `effectivelyInvalidated`) is not active at all: there is no open
 * shared decision upstream if the upstream node is dead, and it could never
 * clear on its own. Otherwise a soft_block is active until its source is done
 * (or, for a broken_down source, its subtree is complete); a soft_block_plan
 * until the source's plan lands (`planLanded` — which a `broken_down` source
 * already satisfies). Independent of firm-gating and claim: a node can be ready AND
 * soft-blocked, or firm-blocked AND soft-blocked — the tag is purely
 * "shared decisions are still open upstream; picking up is a stretch".
 *
 * Pass the FULL node/edge sets (not a filtered view) so every blocker is present.
 */
export function softBlockedIds(
  nodes: GraphNode[],
  edges: NodeEdge[],
  invalidSet: Set<string>,
): Set<string> {
  const nodeById = new Map(nodes.map((n) => [n.id, n]))
  const completeIds = subtreeCompleteIds(nodes, edges)
  const tagged = new Set<string>()
  for (const e of edges) {
    if (e.removed_at !== null) continue
    if (e.type !== 'soft_block' && e.type !== 'soft_block_plan') continue
    if (invalidSet.has(e.source_id)) continue // dead blocker — no longer gates
    const source = nodeById.get(e.source_id)
    const active =
      e.type === 'soft_block_plan'
        ? !source || !planLanded(source)
        : !(
            source?.status === 'done' ||
            (source?.status === 'broken_down' && completeIds.has(source.id))
          )
    if (active) tagged.add(e.target_id)
  }
  const out = new Set<string>()
  for (const n of nodes) {
    if (!tagged.has(n.id)) continue
    if (STATUS_META[n.status].turn !== 'agent') continue
    if (invalidSet.has(n.id)) continue // invalidated or stale
    out.add(n.id)
  }
  return out
}

/**
 * Nodes awaiting a PERSON right now — the mobile queue's contents, in the
 * graph's own reading order (top to bottom, then left to right, from the same
 * tidy-tree layout the desktop board draws). A node is queued iff:
 *
 *   - its turn is 'human' or 'github' (a raised PR awaits the human's review on
 *     GitHub, which is still the person's move),
 *   - it is not stale/invalidated — pass the derived set from
 *     `effectivelyInvalidated`,
 *   - it is not claimed — an agent already holds it, and
 *   - it is not firmly gated (see `firmlyGatedTargets`): doing the work early is
 *     wasted, so a gated card is not "available" whoever holds it.
 *
 * The human-turn mirror of `readyToPickupIds`. Pass the FULL node/edge sets so
 * every blocker and every parent is present.
 */
export function humanQueue(
  nodes: GraphNode[],
  edges: NodeEdge[],
  invalidSet: Set<string>,
): GraphNode[] {
  const blocked = blockedFromPickupIds(nodes, edges, invalidSet)
  const boxes = treeLayout(nodes, edges)
  return nodes
    .filter((n) => {
      const turn = STATUS_META[n.status].turn
      if (turn !== 'human' && turn !== 'github') return false
      if (invalidSet.has(n.id)) return false
      if (n.claimed_by !== null) return false
      return !blocked.has(n.id)
    })
    .sort((a, b) => {
      const ba = boxes.get(a.id)
      const bb = boxes.get(b.id)
      return (
        (ba?.y ?? 0) - (bb?.y ?? 0) ||
        (ba?.x ?? 0) - (bb?.x ?? 0) ||
        a.created_at.localeCompare(b.created_at)
      )
    })
}
