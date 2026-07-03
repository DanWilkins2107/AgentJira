import { Handle, Position } from '@xyflow/react'
import type { Node, NodeProps } from '@xyflow/react'
import { STALE_RING, STATUS_META, statusRgba } from '../lib/statusMeta'
import type { TaskNode } from '../lib/types'
import { NODE_HEIGHT, NODE_WIDTH } from '../lib/graphLayout'

export type TaskFlowNode = Node<{ task: TaskNode }, 'task'>

/** Custom graph node: title + status pill, colored exactly per the status table. */
export function TaskNodeView({ data }: NodeProps<TaskFlowNode>) {
  const task = data.task
  const meta = STATUS_META[task.status]
  return (
    <div
      className="task-node"
      style={{
        width: NODE_WIDTH,
        minHeight: NODE_HEIGHT,
        backgroundColor: statusRgba(task.status, 0.16),
        border: `2px solid ${statusRgba(task.status)}`,
        outline: task.stale ? `3px dashed ${STALE_RING}` : undefined,
        outlineOffset: task.stale ? 3 : undefined,
      }}
    >
      <Handle type="target" position={Position.Top} className="task-node-handle" />
      <div className="task-node-title">
        {task.is_vision ? <span className="task-node-vision">★ </span> : null}
        {task.title}
      </div>
      <div className="task-node-meta">
        <span
          className="task-node-status"
          style={{ backgroundColor: statusRgba(task.status), color: '#fff' }}
        >
          {meta.label}
        </span>
      </div>
      {task.claimed_by ? (
        <div className="task-node-claimed">
          <span className="claimed-dot" />
          {task.claimed_by}
        </div>
      ) : null}
      <Handle type="source" position={Position.Bottom} className="task-node-handle" />
    </div>
  )
}
