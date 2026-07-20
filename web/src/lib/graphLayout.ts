import type { NodeEdge, TaskNode } from './types'

// Base card size (fallback / reference). Real cards taper by spine depth — see
// sizeForDepth — so a parent is visibly bigger than its children.
export const NODE_WIDTH = 230
export const NODE_HEIGHT = 76

// Size taper: a node's card shrinks one step per level down the subtask spine,
// so parentage reads at a glance even zoomed out — a big card sits at the top
// of a column and tapers toward its leaves. Floored so deep leaves stay legible.
const BASE_WIDTH = 250
const BASE_HEIGHT = 96
const WIDTH_STEP = 14
const HEIGHT_STEP = 6
const MIN_WIDTH = 178
const MIN_HEIGHT = 66

/** Card dimensions for a node at the given depth down the primary subtask spine. */
export function sizeForDepth(depth: number): { width: number; height: number } {
  return {
    width: Math.max(MIN_WIDTH, BASE_WIDTH - depth * WIDTH_STEP),
    height: Math.max(MIN_HEIGHT, BASE_HEIGHT - depth * HEIGHT_STEP),
  }
}

const SIBLING_GAP = 36 // horizontal gap between sibling subtree bands
const TREE_GAP = 90 // horizontal gap between whole top-level trees
const LEVEL_GAP = 64 // vertical gap between depth rows
const DEPTH_CAP = 60

export interface NodeBox {
  x: number
  y: number
  width: number
  height: number
}

/**
 * Territorial tidy-tree layout over the SUBTASK spine.
 *
 * The graph is a freeform DAG — a node may have several subtask parents — but a
 * tree is what makes parentage spatially legible. So each node keeps exactly one
 * PRIMARY parent (its oldest incoming subtask edge); every subtree then owns a
 * contiguous horizontal column that no foreign node can drift into. Whole
 * top-level trees are laid out side by side in their own disjoint bands too.
 *
 * Block edges, secondary subtask edges, and relates_to do NOT influence layout —
 * they ride on top as overlays (drawn by GraphPage). Cards taper by depth
 * (sizeForDepth), and rows are stacked by the tallest card at each depth so
 * variable-height rows never overlap.
 *
 * Returns each node's absolute box (top-left x/y + width/height). Nodes with no
 * primary parent are roots; a pure subtask cycle (no root reachable) has its
 * first-seen member promoted to a root so nothing is dropped.
 */
export function treeLayout(nodes: TaskNode[], edges: NodeEdge[]): Map<string, NodeBox> {
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const nodeIds = new Set(byId.keys())

  // Primary parent = oldest incoming subtask edge (deterministic tie-break on id).
  const subtaskEdges = edges
    .filter(
      (e) =>
        e.type === 'subtask' &&
        e.removed_at === null &&
        nodeIds.has(e.source_id) &&
        nodeIds.has(e.target_id) &&
        e.source_id !== e.target_id,
    )
    .sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id))

  const primaryParent = new Map<string, string>()
  for (const e of subtaskEdges) {
    if (!primaryParent.has(e.target_id)) primaryParent.set(e.target_id, e.source_id)
  }

  const childrenOf = new Map<string, string[]>()
  for (const [child, parent] of primaryParent) {
    const list = childrenOf.get(parent)
    if (list) list.push(child)
    else childrenOf.set(parent, [child])
  }
  // Deterministic sibling order: creation time, then id.
  const orderKey = (id: string): string => {
    const n = byId.get(id)
    return n ? `${n.created_at}|${id}` : id
  }
  for (const list of childrenOf.values()) {
    list.sort((a, b) => orderKey(a).localeCompare(orderKey(b)))
  }

  // Roots: no primary parent. Vision first (top of the board), then creation order.
  const rootIds = nodes
    .filter((n) => !primaryParent.has(n.id))
    .sort((a, b) => {
      if (a.is_vision !== b.is_vision) return a.is_vision ? -1 : 1
      return orderKey(a.id).localeCompare(orderKey(b.id))
    })
    .map((n) => n.id)

  // --- Pass 1: depth, size, subtree width (bottom-up), tallest card per row. ---
  const depth = new Map<string, number>()
  const size = new Map<string, { width: number; height: number }>()
  const subtreeWidth = new Map<string, number>()
  const rowHeight: number[] = []
  const visited = new Set<string>()

  const measure = (id: string, d: number): void => {
    if (visited.has(id) || d > DEPTH_CAP) return
    visited.add(id)
    depth.set(id, d)
    const sz = sizeForDepth(d)
    size.set(id, sz)
    rowHeight[d] = Math.max(rowHeight[d] ?? 0, sz.height)

    const kids = (childrenOf.get(id) ?? []).filter((c) => !visited.has(c))
    let span = 0
    for (const c of kids) {
      measure(c, d + 1)
      span += subtreeWidth.get(c) ?? sz.width
    }
    if (kids.length > 0) span += SIBLING_GAP * (kids.length - 1)
    subtreeWidth.set(id, Math.max(sz.width, span))
  }

  for (const id of rootIds) measure(id, 0)
  // Pure-cycle survivors: promote the first unvisited node to a root.
  for (const n of nodes) if (!visited.has(n.id)) measure(n.id, 0)

  // Row y-offsets: each depth sits below the tallest card of the depth above it.
  const rowY: number[] = []
  let accY = 0
  for (let d = 0; d < rowHeight.length; d++) {
    rowY[d] = accY
    accY += (rowHeight[d] ?? 0) + LEVEL_GAP
  }

  // --- Pass 2: assign x top-down; a parent centers over its children's block. ---
  const box = new Map<string, NodeBox>()

  const place = (id: string, leftEdge: number): number => {
    const sz = size.get(id)!
    const d = depth.get(id)!
    const bandWidth = subtreeWidth.get(id)!
    const kids = (childrenOf.get(id) ?? []).filter(
      (c) => depth.get(c) === d + 1 && !box.has(c),
    )

    let centerX: number
    if (kids.length === 0) {
      centerX = leftEdge + bandWidth / 2
    } else {
      const span =
        kids.reduce((s, c) => s + subtreeWidth.get(c)!, 0) + SIBLING_GAP * (kids.length - 1)
      let cursor = leftEdge + (bandWidth - span) / 2 // center the children block in the band
      const centers: number[] = []
      for (const c of kids) {
        place(c, cursor)
        centers.push(box.get(c)!.x + size.get(c)!.width / 2)
        cursor += subtreeWidth.get(c)! + SIBLING_GAP
      }
      centerX = (centers[0] + centers[centers.length - 1]) / 2
    }

    box.set(id, {
      x: centerX - sz.width / 2,
      y: rowY[d] ?? 0,
      width: sz.width,
      height: sz.height,
    })
    return centerX
  }

  let cursorX = 0
  const placeRoot = (id: string): void => {
    if (box.has(id) || depth.get(id) !== 0) return
    place(id, cursorX)
    cursorX += (subtreeWidth.get(id) ?? sizeForDepth(0).width) + TREE_GAP
  }
  for (const id of rootIds) placeRoot(id)
  for (const n of nodes) placeRoot(n.id) // any promoted cycle-root, in node order

  return box
}
