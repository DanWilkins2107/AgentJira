import { MarkerType, ReactFlow, Panel } from '@xyflow/react'
import type { Edge as FlowEdge, NodeMouseHandler } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Legend } from '../components/Legend'
import { SearchBox } from '../components/SearchBox'
import { TaskNodeView } from '../components/TaskNodeView'
import type { TaskFlowNode } from '../components/TaskNodeView'
import { acyclicSubtaskEdges, layoutPositions } from '../lib/graphLayout'
import { EDGE_STYLE } from '../lib/statusMeta'
import { supabase } from '../lib/supabase'
import type { NodeEdge, Project, TaskNode } from '../lib/types'

const nodeTypes = { task: TaskNodeView }

export function GraphPage() {
  const { projectId } = useParams<{ projectId: string }>()
  const navigate = useNavigate()
  const [project, setProject] = useState<Project | null>(null)
  const [taskNodes, setTaskNodes] = useState<TaskNode[]>([])
  const [taskEdges, setTaskEdges] = useState<NodeEdge[]>([])
  const [error, setError] = useState<string | null>(null)

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
  }, [projectId])

  useEffect(() => {
    void load()
    window.addEventListener('focus', load)
    return () => window.removeEventListener('focus', load)
  }, [load])

  const { flowNodes, flowEdges } = useMemo(() => {
    // Dagre needs an acyclic graph; cycles are legal data, so de-cycle for
    // layout only — every non-removed edge is still rendered.
    const layoutEdges = acyclicSubtaskEdges(taskNodes, taskEdges)
    const positions = layoutPositions(taskNodes, layoutEdges)

    const flowNodes: TaskFlowNode[] = taskNodes.map((n) => ({
      id: n.id,
      type: 'task',
      position: positions.get(n.id) ?? { x: 0, y: 0 },
      data: { task: n },
    }))

    const flowEdges: FlowEdge[] = taskEdges.map((e) => {
      const style = EDGE_STYLE[e.type]
      return {
        id: e.id,
        source: e.source_id,
        target: e.target_id,
        type: 'smoothstep',
        style: {
          stroke: style.stroke,
          strokeWidth: 2,
          strokeDasharray: style.dash,
        },
        markerEnd: { type: MarkerType.ArrowClosed, color: style.stroke },
        zIndex: e.type === 'subtask' ? 0 : 1,
      }
    })

    return { flowNodes, flowEdges }
  }, [taskNodes, taskEdges])

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
        <SearchBox projectId={projectId} />
      </div>
      {error ? <div className="form-error">{error}</div> : null}
      <div className="graph-canvas">
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
      </div>
    </div>
  )
}
