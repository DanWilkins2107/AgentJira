import { MarkerType, ReactFlow, Panel } from '@xyflow/react'
import type { Edge as FlowEdge, NodeMouseHandler } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Legend } from '../components/Legend'
import { NewNodeDialog } from '../components/NewNodeDialog'
import { SearchBox } from '../components/SearchBox'
import { TaskNodeView } from '../components/TaskNodeView'
import type { TaskFlowNode } from '../components/TaskNodeView'
import { NODE_HEIGHT, NODE_WIDTH, treeLayout } from '../lib/graphLayout'
import { effectivelyInvalidated } from '../lib/invalidation'
import {
  blockedFromPickupIds,
  directChildrenSettled,
  planLanded,
  readyToPickupIds,
  softBlockedIds,
  subtreeCompleteIds,
} from '../lib/pickup'
import { EDGE_STYLE } from '../lib/statusMeta'
import { supabase } from '../lib/supabase'
import type { NodeEdge, Project, TaskNode } from '../lib/types'

const nodeTypes = { task: TaskNodeView }

/** Per-edge-type rendering: subtask = ubiquitous scaffolding (thinner, faded);
 * blocks = emphasized on top; relates_to = faint context. */
const EDGE_RENDER: Record<NodeEdge['type'], { width: number; opacity: number; zIndex: number }> = {
  subtask: { width: 2, opacity: 0.55, zIndex: 0 },
  firm_block: { width: 2.5, opacity: 1, zIndex: 1 },
  firm_block_plan: { width: 2.5, opacity: 1, zIndex: 1 },
  soft_block: { width: 2.5, opacity: 1, zIndex: 1 },
  soft_block_plan: { width: 2.5, opacity: 1, zIndex: 1 },
  reassess_after: { width: 2.5, opacity: 1, zIndex: 1 },
  relates_to: { width: 1.5, opacity: 0.45, zIndex: 0 },
}

/** Block-family edge types (base + plan variants + reassess_after). */
const BLOCK_FAMILY: ReadonlySet<NodeEdge['type']> = new Set([
  'firm_block',
  'soft_block',
  'firm_block_plan',
  'soft_block_plan',
  'reassess_after',
])

export function GraphPage() {
  const { projectId } = useParams<{ projectId: string }>()
  const navigate = useNavigate()
  const [project, setProject] = useState<Project | null>(null)
  const [taskNodes, setTaskNodes] = useState<TaskNode[]>([])
  const [taskEdges, setTaskEdges] = useState<NodeEdge[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [showNewNode, setShowNewNode] = useState(false)

  // Human-view convenience only — agents are always served invalidated
  // context (contract); these never change what is fetched.
  const storageKey = `aj:hideInvalidated:${projectId ?? ''}`
  const [hideInvalidated, setHideInvalidated] = useState<boolean>(
    () => localStorage.getItem(storageKey) === '1',
  )
  useEffect(() => {
    setHideInvalidated(localStorage.getItem(storageKey) === '1')
  }, [storageKey])
  const onToggleHideInvalidated = useCallback(
    (checked: boolean) => {
      setHideInvalidated(checked)
      localStorage.setItem(storageKey, checked ? '1' : '0')
    },
    [storageKey],
  )

  // Hide done (terminal) nodes to declutter the graph down to live work.
  // View-only, same as the invalidated toggle.
  const doneKey = `aj:hideDone:${projectId ?? ''}`
  const [hideDone, setHideDone] = useState<boolean>(() => localStorage.getItem(doneKey) === '1')
  useEffect(() => {
    setHideDone(localStorage.getItem(doneKey) === '1')
  }, [doneKey])
  const onToggleHideDone = useCallback(
    (checked: boolean) => {
      setHideDone(checked)
      localStorage.setItem(doneKey, checked ? '1' : '0')
    },
    [doneKey],
  )

  const load = useCallback(async () => {
    if (!projectId) return
    const [projRes, nodesRes, edgesRes] = await Promise.all([
      supabase.from('projects').select('*').eq('id', projectId).single(),
      supabase.from('nodes').select('*').eq('project_id', projectId),
      supabase.from('edges').select('*').eq('project_id', projectId).is('removed_at', null),
    ])
    const err = projRes.error ?? nodesRes.error ?? edgesRes.error
    if (err) {
      setError(err.message)
      return
    }
    setError(null)
    setProject(projRes.data as Project)
    setTaskNodes((nodesRes.data ?? []) as TaskNode[])
    setTaskEdges((edgesRes.data ?? []) as NodeEdge[])
    setLoaded(true)
  }, [projectId])

  useEffect(() => {
    void load()
    window.addEventListener('focus', load)
    return () => window.removeEventListener('focus', load)
  }, [load])

  const { flowNodes, flowEdges } = useMemo(() => {
    // Derived, never persisted: subtask descendants of an invalidated node are
    // STALE — they render dimmed with a badge and come back automatically when
    // the ancestor is restored.
    const invalidSet = effectivelyInvalidated(taskNodes, taskEdges)

    // Derived, never persisted: the nodes an agent could pick up right now (the
    // parallelization frontier) and, disjointly, those held back purely by an
    // unfinished firm-family gate — the blocked set also covers human-turn
    // nodes, which `aj tasks` never lists. Both computed on the FULL sets so
    // blockers are all present, then read per-node below.
    const readySet = readyToPickupIds(taskNodes, taskEdges, invalidSet)
    const blockedSet = blockedFromPickupIds(taskNodes, taskEdges, invalidSet)
    // Advisory soft-block tag — orthogonal to ready/blocked (mirrors aj tasks).
    const softSet = softBlockedIds(taskNodes, taskEdges, invalidSet)

    // Which broken_down containers have a fully-settled subtree (their coarse
    // gates no longer hold anyone back), and how many nodes each one gates.
    const completeIds = subtreeCompleteIds(taskNodes, taskEdges)
    const gatesBySource = new Map<string, number>()
    for (const e of taskEdges) {
      if (e.removed_at !== null || !BLOCK_FAMILY.has(e.type)) continue
      gatesBySource.set(e.source_id, (gatesBySource.get(e.source_id) ?? 0) + 1)
    }

    // View-only declutter filters (agents always see the full graph). Derived
    // sets above already ran on the full data, so hiding here can't change them.
    const visibleNodes = taskNodes.filter((n) => {
      if (hideInvalidated && invalidSet.has(n.id)) return false
      // "Done" for hiding means terminal, OR a broken_down container whose whole
      // subtree has settled (completeIds) — such a parent can never itself reach
      // `done`, but every leaf under it has, so it reads as done and should hide.
      // Restrict the completeIds branch to broken_down: it also flags invalidated
      // nodes, which are hideInvalidated's job, not hideDone's.
      if (hideDone && (n.status === 'done' || (n.status === 'broken_down' && completeIds.has(n.id))))
        return false
      return true
    })
    const visibleIds = new Set(visibleNodes.map((n) => n.id))
    const visibleEdges = hideInvalidated
      ? taskEdges.filter((e) => visibleIds.has(e.source_id) && visibleIds.has(e.target_id))
      : taskEdges

    // A coarse GATE is a block whose SOURCE is a broken_down parent — the
    // operative gate holding its target back. We draw it (quietly) and fade it
    // once the parent's subtree completes, so a BLOCKED node has a visible,
    // self-resolving cause. A block pointing INTO a broken_down node (target
    // broken_down, source not) is the noisy direction the demotion existed to
    // hide — keep that one dropped.
    const nodeById = new Map(visibleNodes.map((n) => [n.id, n]))
    const isCoarseGate = (e: NodeEdge): boolean =>
      BLOCK_FAMILY.has(e.type) && nodeById.get(e.source_id)?.status === 'broken_down'
    const isBlockIntoContainer = (e: NodeEdge): boolean =>
      BLOCK_FAMILY.has(e.type) &&
      nodeById.get(e.source_id)?.status !== 'broken_down' &&
      nodeById.get(e.target_id)?.status === 'broken_down'
    const renderEdges = visibleEdges.filter((e) => !isBlockIntoContainer(e))

    // A satisfied plan-variant block (source's plan landed) no longer gates —
    // render it faded so the graph reads "context", not "wait".
    const isSatisfiedPlanBlock = (e: NodeEdge): boolean => {
      if (e.type !== 'firm_block_plan' && e.type !== 'soft_block_plan') return false
      const source = nodeById.get(e.source_id)
      return source !== undefined && planLanded(source)
    }

    // Territorial tidy-tree over the subtask spine: every parent owns a
    // contiguous column no foreign node can enter, and cards taper by depth so
    // parentage reads at a glance. Blocks don't move columns, but they DO push
    // their target to a lower row (rank) so block arrows always point down — see
    // lib/graphLayout.ts. Pass renderEdges so ranking honors exactly the blocks
    // we draw (block-into-container edges are already dropped). Positions carry
    // each card's own size.
    const boxes = treeLayout(visibleNodes, renderEdges)

    const flowNodes: TaskFlowNode[] = visibleNodes.map((n) => {
      // Broken_down containers carry subtree progress + how many nodes they gate,
      // so the card can show how close it is to clearing them. Computed on the
      // FULL sets so the count is true regardless of the view filters.
      const container =
        n.status === 'broken_down'
          ? {
              ...directChildrenSettled(n.id, taskNodes, taskEdges, completeIds),
              complete: completeIds.has(n.id),
              gates: gatesBySource.get(n.id) ?? 0,
            }
          : undefined
      const box = boxes.get(n.id)
      return {
        id: n.id,
        type: 'task' as const,
        position: box ? { x: box.x, y: box.y } : { x: 0, y: 0 },
        data: {
          task: n,
          stale: invalidSet.has(n.id) && n.status !== 'invalidated',
          ready: readySet.has(n.id),
          blocked: blockedSet.has(n.id),
          softBlocked: softSet.has(n.id),
          container,
          size: { width: box?.width ?? NODE_WIDTH, height: box?.height ?? NODE_HEIGHT },
        },
      }
    })

    const flowEdges: FlowEdge[] = renderEdges.map((e) => {
      const style = EDGE_STYLE[e.type]
      const render = EDGE_RENDER[e.type]
      const coarse = isCoarseGate(e)
      // Satisfied = no longer gating: a plan block whose plan landed, or a coarse
      // gate whose parent's subtree is complete. Rendered faded either way.
      const satisfied = isSatisfiedPlanBlock(e) || (coarse && completeIds.has(e.source_id))
      return {
        id: e.id,
        source: e.source_id,
        target: e.target_id,
        // The subtask spine reads as structure — orthogonal elbows tracing the
        // columns; blocks/relates stay bezier so dependencies look distinct.
        type: e.type === 'subtask' ? 'smoothstep' : 'default',
        style: {
          stroke: style.stroke,
          // Coarse gates read quieter than a direct block: thinner and dashed.
          strokeWidth: coarse ? 2 : render.width,
          strokeDasharray: coarse ? '4 4' : style.dash,
          opacity: satisfied ? 0.3 : coarse ? 0.55 : render.opacity,
        },
        markerEnd: { type: MarkerType.ArrowClosed, color: style.stroke },
        zIndex: satisfied ? 0 : render.zIndex,
      }
    })

    return { flowNodes, flowEdges }
  }, [taskNodes, taskEdges, hideInvalidated, hideDone])

  // The toggle can hide every node; say so instead of showing a blank canvas.
  const allHidden = taskNodes.length > 0 && flowNodes.length === 0

  const onNodeClick: NodeMouseHandler = useCallback(
    (_event, node) => navigate(`/n/${node.id}`),
    [navigate],
  )

  if (!projectId) return null

  return (
    <div className="graph-page">
      <div className="graph-toolbar">
        <Link to="/" className="btn-small">
          ← Projects
        </Link>
        <h1>{project?.name ?? '…'}</h1>
        <label className="graph-toggle">
          <input
            type="checkbox"
            checked={hideInvalidated}
            onChange={(e) => onToggleHideInvalidated(e.target.checked)}
          />
          Hide invalidated &amp; stale
          <span className="graph-toggle-hint">(stale = an ancestor is invalidated)</span>
        </label>
        <label className="graph-toggle">
          <input
            type="checkbox"
            checked={hideDone}
            onChange={(e) => onToggleHideDone(e.target.checked)}
          />
          Hide done
        </label>
        <SearchBox projectId={projectId} />
        <button className="btn-approve" onClick={() => setShowNewNode(true)}>
          + New node
        </button>
      </div>
      {error ? <div className="form-error">{error}</div> : null}
      <div className="graph-canvas">
        {allHidden ? (
          <div className="graph-empty-state">
            All {taskNodes.length} node{taskNodes.length === 1 ? ' is' : 's are'} hidden by the
            active filters. Untick a “Hide…” box above to see them.
          </div>
        ) : null}
        {/* Mount ReactFlow only once the first load resolves so `fitView` runs its
            once-only init fit against the real nodes. Mounting it while nodes are
            still empty (e.g. remounting after navigating back from a node) fits to
            nothing and leaves the graph panned off-screen — looking empty. */}
        {loaded ? (
          <ReactFlow
            nodes={flowNodes}
            edges={flowEdges}
            nodeTypes={nodeTypes}
            onNodeClick={onNodeClick}
            fitView
            minZoom={0.1}
            nodesDraggable
            nodesConnectable={false}
            proOptions={{ hideAttribution: true }}
          >
            <Panel position="top-right">
              <Legend />
            </Panel>
          </ReactFlow>
        ) : (
          <div className="graph-empty-state">Loading graph…</div>
        )}
      </div>
      {showNewNode ? (
        <NewNodeDialog
          projectId={projectId}
          onClose={() => setShowNewNode(false)}
          onCreated={(node) => navigate(`/n/${node.id}`)}
        />
      ) : null}
    </div>
  )
}
