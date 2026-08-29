import type { GraphNode, NodeEdge } from './types'

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
const LEVEL_GAP = 64 // vertical gap between rank rows
const DEPTH_CAP = 60

/** Block-family edge types — each keeps its target ranked below its source. */
const BLOCK_FAMILY: ReadonlySet<string> = new Set([
  'firm_block',
  'firm_block_plan',
  'soft_block',
  'soft_block_plan',
  'reassess_after',
])

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
 * Columns (X) and card size come purely from the subtask spine — blocks and
 * relates_to never move a node sideways. Block edges DO set vertical order,
 * though: a node's row is its rank (longest "must sit below" chain of subtask +
 * block edges), so a blocker is always drawn above what it blocks. Cards taper
 * by depth (sizeForDepth); rows stack by the tallest card in each rank.
 *
 * Returns each node's absolute box (top-left x/y + width/height). Nodes with no
 * primary parent are roots; a pure subtask cycle (no root reachable) has its
 * first-seen member promoted to a root so nothing is dropped.
 */
/**
 * Each node's PRIMARY subtask parent: its oldest incoming subtask edge
 * (deterministic tie-break on id). The graph is a DAG — a node may have several
 * subtask parents — so this one choice is what turns it into the tree the layout
 * draws, and the same chain the queue view walks for a node's breadcrumb.
 * Restricted to edges whose BOTH ends are in `nodes`, so a filtered view never
 * points at a node that isn't there.
 */
export function primaryParents(nodes: GraphNode[], edges: NodeEdge[]): Map<string, string> {
  const nodeIds = new Set(nodes.map((n) => n.id))
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
  return primaryParent
}

export function treeLayout(nodes: GraphNode[], edges: NodeEdge[]): Map<string, NodeBox> {
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const nodeIds = new Set(byId.keys())

  const primaryParent = primaryParents(nodes, edges)

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
  const visited = new Set<string>()

  const measure = (id: string, d: number): void => {
    if (visited.has(id) || d > DEPTH_CAP) return
    visited.add(id)
    depth.set(id, d)
    const sz = sizeForDepth(d)
    size.set(id, sz)

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

  // --- Vertical rank: keep every blocked node BELOW what blocks it. ---
  // Y is driven by rank, not raw spine depth. A node's rank is the longest chain
  // of "must sit below" constraints reaching it — every subtask edge (a child
  // sits below its parents) plus every block-family edge (a target sits below
  // its blocker). So block arrows point downward while X (columns) and card size
  // stay tied to the subtask spine.
  //
  // Constraints can form cycles (legal data), which no ranking can fully honor.
  // We break them with a DFS topological order in which SUBTASK edges are the
  // trunk (explored first, so they become tree edges and are never the dropped
  // back-edge) — the subtask hierarchy is therefore always respected (a child is
  // never above its parent), and only a genuinely cyclic BLOCK edge is dropped.
  // pr 0 = subtask, pr 1 = block/sink.
  interface OutEdge {
    to: string
    pr: number
  }
  const constraintOut = new Map<string, OutEdge[]>()
  const addConstraint = (from: string, to: string, pr: number): void => {
    if (from === to) return
    const list = constraintOut.get(from)
    if (list) list.push({ to, pr })
    else constraintOut.set(from, [{ to, pr }])
  }

  // All subtask children (whole DAG, not just the primary spine) — used to sink
  // a node blocked on a broken_down container below the container's ENTIRE
  // subtree, so the gate reads as "clears everything under that container".
  const subtaskKids = new Map<string, string[]>()
  for (const e of edges) {
    if (
      e.type !== 'subtask' ||
      e.removed_at !== null ||
      e.source_id === e.target_id ||
      !nodeIds.has(e.source_id) ||
      !nodeIds.has(e.target_id)
    )
      continue
    const list = subtaskKids.get(e.source_id)
    if (list) list.push(e.target_id)
    else subtaskKids.set(e.source_id, [e.target_id])
  }
  const subtreeOf = (root: string): string[] => {
    const out: string[] = []
    const seen = new Set<string>([root])
    const stack = [root]
    let steps = 0
    while (stack.length > 0 && steps++ < 5000) {
      for (const k of subtaskKids.get(stack.pop()!) ?? []) {
        if (seen.has(k)) continue
        seen.add(k)
        out.push(k)
        stack.push(k)
      }
    }
    return out
  }

  for (const e of edges) {
    if (e.removed_at !== null || e.source_id === e.target_id) continue
    if (!nodeIds.has(e.source_id) || !nodeIds.has(e.target_id)) continue
    if (e.type === 'subtask') {
      addConstraint(e.source_id, e.target_id, 0)
    } else if (BLOCK_FAMILY.has(e.type)) {
      addConstraint(e.source_id, e.target_id, 1)
      // Blocked on a container → sit below its whole subtree, not just the card.
      if (byId.get(e.source_id)?.status === 'broken_down') {
        for (const d of subtreeOf(e.source_id)) addConstraint(d, e.target_id, 1)
      }
    }
  }

  // Explore subtask edges before block edges so the DFS tree follows the
  // hierarchy; deterministic tie-break keeps layout stable across loads.
  for (const list of constraintOut.values()) {
    list.sort((a, b) => a.pr - b.pr || orderKey(a.to).localeCompare(orderKey(b.to)))
  }

  // DFS topological order (reverse post-order). Edges into a node still on the
  // stack are back-edges — the cycle breakers — and are dropped; every other
  // edge is kept and, because subtask edges are explored first, the dropped one
  // is a block/sink edge whenever the cycle contains any.
  const state = new Map<string, 0 | 1 | 2>() // 0 unseen, 1 on-stack, 2 done
  const topo: string[] = []
  const keptParents = new Map<string, string[]>()
  const dfs = (root: string): void => {
    const stack: { id: string; i: number }[] = [{ id: root, i: 0 }]
    state.set(root, 1)
    while (stack.length > 0) {
      const frame = stack[stack.length - 1]
      const out = constraintOut.get(frame.id) ?? []
      if (frame.i < out.length) {
        const { to } = out[frame.i++]
        const s = state.get(to) ?? 0
        if (s === 1) continue // back-edge → drop (breaks the cycle)
        const parents = keptParents.get(to)
        if (parents) parents.push(frame.id)
        else keptParents.set(to, [frame.id])
        if (s === 0) {
          state.set(to, 1)
          stack.push({ id: to, i: 0 })
        }
      } else {
        state.set(frame.id, 2)
        topo.push(frame.id)
        stack.pop()
      }
    }
  }
  for (const id of rootIds) if ((state.get(id) ?? 0) === 0) dfs(id)
  for (const id of depth.keys()) if ((state.get(id) ?? 0) === 0) dfs(id)
  topo.reverse()

  // Longest path over the kept (acyclic) constraints: a node's rank is one below
  // its deepest kept parent. Topological order guarantees parents rank first.
  const rank = new Map<string, number>()
  for (const id of topo) {
    let r = 0
    for (const p of keptParents.get(id) ?? []) r = Math.max(r, (rank.get(p) ?? 0) + 1)
    rank.set(id, r)
  }

  // Compact the used ranks into rows (no empty bands): each row is as tall as
  // its tallest card, stacked with a fixed gap.
  const rowHeightByRank = new Map<number, number>()
  for (const id of depth.keys()) {
    const r = rank.get(id) ?? 0
    rowHeightByRank.set(r, Math.max(rowHeightByRank.get(r) ?? 0, size.get(id)!.height))
  }
  const rankY = new Map<number, number>()
  let accY = 0
  for (const r of [...rowHeightByRank.keys()].sort((a, b) => a - b)) {
    rankY.set(r, accY)
    accY += rowHeightByRank.get(r)! + LEVEL_GAP
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
      y: rankY.get(rank.get(id) ?? 0) ?? 0,
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
