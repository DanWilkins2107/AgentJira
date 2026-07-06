import { Handle, Position } from '@xyflow/react'
import type { Node, NodeProps } from '@xyflow/react'
import { STATUS_META, cardTreatment } from '../lib/statusMeta'
import type { TaskNode } from '../lib/types'
import { NODE_HEIGHT, NODE_WIDTH } from '../lib/graphLayout'

export type TaskFlowNode = Node<{ task: TaskNode; stale: boolean }, 'task'>

/**
 * Custom graph node. Turn is readable by brightness: human-turn statuses get
 * a light/bright status-colored card, agent-turn a dark card with a status
 * accent, github/none dark-muted. `stale` (derived: an ancestor is currently
 * invalidated — never persisted) renders the invalidated treatment plus the
 * amber STALE badge; the pill keeps the node's own status label (dimmed) so
 * the story isn't lost, and the card springs back when the ancestor is
 * restored.
 */
export function TaskNodeView({ data }: NodeProps<TaskFlowNode>) {
  const task = data.task
  const stale = data.stale && task.status !== 'invalidated'
  const meta = STATUS_META[task.status]
  const treat = cardTreatment(task.status, stale)
  return (
    <div
      className="task-node"
      style={{
        width: NODE_WIDTH,
        minHeight: NODE_HEIGHT,
        backgroundColor: treat.background,
        border: `2px solid ${treat.borderColor}`,
        borderLeft: treat.accentBar
          ? `6px solid ${treat.accentBar}`
          : `2px solid ${treat.borderColor}`,
        color: treat.text,
        boxShadow: treat.glow,
        opacity: treat.dim,
      }}
    >
      <Handle type="target" position={Position.Top} className="task-node-handle" />
      {stale ? <span className="task-node-stale-badge">STALE</span> : null}
      <div className="task-node-title">
        {task.is_vision ? <span className="task-node-vision">★ </span> : null}
        {task.title}
      </div>
      <div className="task-node-meta">
        <span
          className="task-node-status"
          style={{ backgroundColor: treat.pillBackground, color: treat.pillText }}
        >
          {meta.label}
        </span>
      </div>
      {task.claimed_by ? (
        <div className="task-node-claimed" style={{ color: treat.text, opacity: 0.85 }}>
          <span className="claimed-dot" />
          {task.claimed_by}
        </div>
      ) : null}
      <Handle type="source" position={Position.Bottom} className="task-node-handle" />
    </div>
  )
}
