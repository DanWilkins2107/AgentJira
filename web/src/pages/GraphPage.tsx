import { MarkerType, ReactFlow, Panel } from '@xyflow/react'
import type { Edge as FlowEdge, NodeMouseHandler } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Legend } from '../components/Legend'
import { SearchBox } from '../components/SearchBox'
import { TaskNodeView } from '../components/TaskNodeView'
import type { TaskFlowNode } from '../components/TaskNodeView'
import { acyclicLayoutEdges, layoutPositions } from '../lib/graphLayout'
import { effectivelyInvalidated } from '../lib/invalidation'
import { readyToPickupIds } from '../lib/pickup'
import { EDGE_STYLE } from '../lib/statusMeta'
import { supabase } from '../lib/supabase'
import type { NodeEdge, Project, TaskNode } from '../lib/types'

const nodeTypes = { task: TaskNodeView }

/** Per-edge-type rendering: subtask = ubiquitous scaffolding (thinner, faded);
 * blocks = emphasized on top; relates_to = faint context. */
const EDGE_RENDER: Record<NodeEdge['type'], { width: number; opacity: number; zIndex: number }> = {
  subtask: { width: 2, opacity: 0.55, zIndex: 0 },
  firm_block: { width: 2.5, opacity: 1, zIndex: 1 },
  soft_block: { width: 2.5, opacity: 1, zIndex: 1 },
  reassess_after: { width: 2.5, opacity: 1, zIndex: 1 },
  relates_to: { width: 1.5, opacity: 0.45, zIndex: 0 },
}

export function GraphPage() {
  const { projectId } = useParams<{ projectId: string }>()
  const navigate = useNavigate()
  const [project, setProject] = useState<Project | null>(null)
  const [taskNodes, setTaskNodes] = useState<TaskNode[]>([])
  const [taskEdges, setTaskEdges] = useState<NodeEdge[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loaded, setLoaded] = useState(false)

  // Human-view convenience only — agents are always served invalidated
  // context (contract); this never changes what is fetched.
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
    // parallelization frontier). Computed on the FULL sets so blockers are all
    // present, then read per-node below. Mirrors `aj tasks` RECOMMENDED.
    const readySet = readyToPickupIds(taskNodes, taskEdges, invalidSet)

    const visibleNodes = hideInvalidated
      ? taskNodes.filter((n) => !invalidSet.has(n.id))
      : taskNodes
    const visibleIds = new Set(visibleNodes.map((n) => n.id))
    const visibleEdges = hideInvalidated
      ? taskEdges.filter((e) => visibleIds.has(e.source_id) && visibleIds.has(e.target_id))
      : taskEdges

    // Coarse-block demotion: a firm/soft/reassess_after block incident to a
    // broken_down node is superseded by its subtasks' granular blocks, so it's
    // hidden from the graph (and surfaced in `aj context` instead — see
    // cli/src/commands/context.ts). Layout still sees it below as a ranking
    // hint; only the drawn edge is dropped.
    const statusById = new Map(visibleNodes.map((n) => [n.id, n.status]))
    const isCoarseBlock = (e: NodeEdge): boolean =>
      (e.type === 'firm_block' || e.type === 'soft_block' || e.type === 'reassess_after') &&
      (statusById.get(e.source_id) === 'broken_down' ||
        statusById.get(e.target_id) === 'broken_down')
    const renderEdges = visibleEdges.filter((e) => !isCoarseBlock(e))

    // Dagre needs an acyclic graph; cycles are legal data, so de-cycle for
    // layout only — every non-removed edge still informs layout.
    const layoutEdges = acyclicLayoutEdges(visibleNodes, visibleEdges)
    const positions = layoutPositions(visibleNodes, layoutEdges)

    const flowNodes: TaskFlowNode[] = visibleNodes.map((n) => ({
      id: n.id,
      type: 'task',
      position: positions.get(n.id) ?? { x: 0, y: 0 },
      data: {
        task: n,
        stale: invalidSet.has(n.id) && n.status !== 'invalidated',
        ready: readySet.has(n.id),
      },
    }))

    const flowEdges: FlowEdge[] = renderEdges.map((e) => {
      const style = EDGE_STYLE[e.type]
      const render = EDGE_RENDER[e.type]
      return {
        id: e.id,
        source: e.source_id,
        target: e.target_id,
        type: 'default', // bezier — organic curves instead of orthogonal steps
        style: {
          stroke: style.stroke,
          strokeWidth: render.width,
          strokeDasharray: style.dash,
          opacity: render.opacity,
        },
        markerEnd: { type: MarkerType.ArrowClosed, color: style.stroke },
        zIndex: render.zIndex,
      }
    })

    return { flowNodes, flowEdges }
  }, [taskNodes, taskEdges, hideInvalidated])

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
        <SearchBox projectId={projectId} />
      </div>
      {error ? <div className="form-error">{error}</div> : null}
      <div className="graph-canvas">
        {allHidden ? (
          <div className="graph-empty-state">
            All {taskNodes.length} node{taskNodes.length === 1 ? ' is' : 's are'} invalidated or
            stale — hidden by the filter. Untick “Hide invalidated &amp; stale” to see them.
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
    </div>
  )
}
