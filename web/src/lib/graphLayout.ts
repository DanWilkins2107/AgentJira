import dagre from '@dagrejs/dagre'
import type { EdgeType, NodeEdge, TaskNode } from './types'

export const NODE_WIDTH = 230
export const NODE_HEIGHT = 76

const DEPTH_CAP = 50

/** Edge types that participate in the dagre layout. relates_to is context only. */
const LAYOUT_EDGE_TYPES: ReadonlySet<EdgeType> = new Set([
  'subtask',
  'firm_block',
  'firm_block_plan',
  'soft_block',
  'soft_block_plan',
  'reassess_after',
])

/**
 * Dagre edge weights: hierarchy dominates, but block edges still pull the
 * blocker's rank ABOVE what it blocks, so blocks flow top-to-bottom instead
 * of sideways between siblings. reassess_after gates pickup like a firm block,
 * so it ranks like one.
 */
const LAYOUT_EDGE_WEIGHT: Record<EdgeType, number> = {
  subtask: 4,
  firm_block: 2,
  firm_block_plan: 2,
  reassess_after: 2,
  soft_block: 1,
  soft_block_plan: 1,
  relates_to: 0, // never in the layout set
}

/**
 * De-cycle the combined layout edge set (non-removed subtask + firm_block +
 * soft_block + reassess_after) for layout. Cycles are legal data — dagre can't take them —
 * so we DFS with a visited set + on-stack set (depth cap 50) and drop
 * back-edges from the LAYOUT set only. Dropped edges are still rendered.
 */
export function acyclicLayoutEdges(nodes: TaskNode[], edges: NodeEdge[]): NodeEdge[] {
  const layoutable = edges.filter((e) => LAYOUT_EDGE_TYPES.has(e.type) && e.removed_at === null)
  const adj = new Map<string, NodeEdge[]>()
  for (const e of layoutable) {
    const list = adj.get(e.source_id)
    if (list) list.push(e)
    else adj.set(e.source_id, [e])
  }

  const keep: NodeEdge[] = []
  const visited = new Set<string>()
  const onStack = new Set<string>()

  function dfs(id: string, depth: number): void {
    if (depth > DEPTH_CAP) return
    visited.add(id)
    onStack.add(id)
    for (const e of adj.get(id) ?? []) {
      if (onStack.has(e.target_id)) continue // back-edge → cycle; drop from layout
      keep.push(e)
      if (!visited.has(e.target_id)) dfs(e.target_id, depth + 1)
    }
    onStack.delete(id)
  }

  // Roots: vision nodes first so the vision sits at the top rank, then any
  // node with no incoming layout edge, then anything still unvisited (pure cycles).
  const hasIncoming = new Set(layoutable.map((e) => e.target_id))
  const ordered = [
    ...nodes.filter((n) => n.is_vision),
    ...nodes.filter((n) => !n.is_vision && !hasIncoming.has(n.id)),
    ...nodes.filter((n) => !n.is_vision && hasIncoming.has(n.id)),
  ]
  for (const n of ordered) {
    if (!visited.has(n.id)) dfs(n.id, 0)
  }
  return keep
}

/**
 * Dagre TB layout over the (de-cycled) layout edges. Subtask edges carry the
 * most weight so hierarchy dominates; firm/soft block edges rank the blocker
 * above the blocked node. Returns node positions.
 */
export function layoutPositions(
  nodes: TaskNode[],
  layoutEdges: NodeEdge[],
): Map<string, { x: number; y: number }> {
  const g = new dagre.graphlib.Graph()
  g.setGraph({ rankdir: 'TB', nodesep: 50, ranksep: 100, marginx: 20, marginy: 20 })
  g.setDefaultEdgeLabel(() => ({}))
  for (const n of nodes) g.setNode(n.id, { width: NODE_WIDTH, height: NODE_HEIGHT })
  for (const e of layoutEdges) {
    g.setEdge(e.source_id, e.target_id, { weight: LAYOUT_EDGE_WEIGHT[e.type], minlen: 1 })
  }
  dagre.layout(g)

  const positions = new Map<string, { x: number; y: number }>()
  for (const n of nodes) {
    const pos = g.node(n.id)
    positions.set(n.id, {
      x: pos.x - NODE_WIDTH / 2,
      y: pos.y - NODE_HEIGHT / 2,
    })
  }
  return positions
}
