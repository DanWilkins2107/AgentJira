import dagre from '@dagrejs/dagre'
import type { NodeEdge, TaskNode } from './types'

export const NODE_WIDTH = 230
export const NODE_HEIGHT = 76

const DEPTH_CAP = 50

/**
 * De-cycle the subtask edge set for layout. Cycles are legal data — dagre just
 * can't take them — so we DFS with a visited set + on-stack set (depth cap 50)
 * and drop back-edges from the LAYOUT set only. Dropped edges are still rendered.
 */
export function acyclicSubtaskEdges(nodes: TaskNode[], edges: NodeEdge[]): NodeEdge[] {
  const subtask = edges.filter((e) => e.type === 'subtask' && e.removed_at === null)
  const adj = new Map<string, NodeEdge[]>()
  for (const e of subtask) {
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
  // node with no incoming subtask edge, then anything still unvisited (pure cycles).
  const hasIncoming = new Set(subtask.map((e) => e.target_id))
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

/** Dagre TB layout over the (de-cycled) subtask edges. Returns node positions. */
export function layoutPositions(
  nodes: TaskNode[],
  layoutEdges: NodeEdge[],
): Map<string, { x: number; y: number }> {
  const g = new dagre.graphlib.Graph()
  g.setGraph({ rankdir: 'TB', nodesep: 40, ranksep: 80, marginx: 20, marginy: 20 })
  g.setDefaultEdgeLabel(() => ({}))
  for (const n of nodes) g.setNode(n.id, { width: NODE_WIDTH, height: NODE_HEIGHT })
  for (const e of layoutEdges) g.setEdge(e.source_id, e.target_id)
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
