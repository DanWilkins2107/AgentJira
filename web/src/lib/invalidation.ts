import type { GraphNode, NodeEdge } from './types'

const DEPTH_CAP = 50

/**
 * Compute the set of node ids that are effectively invalidated: nodes whose
 * own status is `invalidated`, plus every descendant reachable from them via
 * non-removed `subtask` edges (BFS, visited set, depth cap 50 — cycles are
 * legal data).
 *
 * A node is **stale** iff it is in this set AND its own status is not
 * `invalidated` — i.e. an ancestor is currently invalidated. Stale is DERIVED
 * everywhere, never persisted (the server-side equivalent is the
 * `stale_node_ids` RPC). That's the point: restoring the invalidated ancestor
 * automatically un-stales the whole subtree with zero writes. Blocks never
 * affect staleness.
 */
export function effectivelyInvalidated(nodes: GraphNode[], edges: NodeEdge[]): Set<string> {
  const children = new Map<string, string[]>()
  for (const e of edges) {
    if (e.type !== 'subtask' || e.removed_at !== null) continue
    const list = children.get(e.source_id)
    if (list) list.push(e.target_id)
    else children.set(e.source_id, [e.target_id])
  }

  const invalid = new Set<string>()
  // BFS frontier of [id, depth]; seeds are the explicitly invalidated nodes.
  let frontier: Array<[string, number]> = []
  for (const n of nodes) {
    if (n.status === 'invalidated') {
      invalid.add(n.id)
      frontier.push([n.id, 0])
    }
  }

  while (frontier.length > 0) {
    const next: Array<[string, number]> = []
    for (const [id, depth] of frontier) {
      if (depth >= DEPTH_CAP) continue
      for (const child of children.get(id) ?? []) {
        if (invalid.has(child)) continue // visited
        invalid.add(child)
        next.push([child, depth + 1])
      }
    }
    frontier = next
  }
  return invalid
}
