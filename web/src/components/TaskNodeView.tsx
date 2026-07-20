import { Handle, Position } from '@xyflow/react'
import type { Node, NodeProps } from '@xyflow/react'
import { READY_RING, STATUS_META, cardTreatment } from '../lib/statusMeta'
import type { TaskNode } from '../lib/types'
import { NODE_HEIGHT, NODE_WIDTH } from '../lib/graphLayout'

export type TaskFlowNode = Node<
  {
    task: TaskNode
    stale: boolean
    ready: boolean
    blocked: boolean
    // Advisory only: an upstream soft block's shared decision is still open.
    // Independent of `blocked`/`ready` — a node can be either and still soft.
    softBlocked: boolean
    // Present only for broken_down containers: how far its subtree is toward
    // clearing its coarse gates (see lib/pickup.ts), and how many nodes it gates.
    container?: { settled: number; total: number; complete: boolean; gates: number }
  },
  'task'
>

/** Green used for a container whose subtree is fully settled (gates cleared). */
const CONTAINER_DONE_GREEN = '#12b886'
const CONTAINER_DONE_GLOW = '0 0 10px 1px rgba(18, 184, 134, 0.25)'

/**
 * Custom graph node. Turn is readable by brightness: human-turn statuses get
 * a light/bright status-colored card, agent-turn a dark card with a status
 * accent, github/none dark-muted. `stale` (derived: an ancestor is currently
 * invalidated — never persisted) renders the invalidated treatment plus the
 * amber STALE badge; the pill keeps the node's own status label (dimmed) so
 * the story isn't lost, and the card springs back when the ancestor is
 * restored.
 *
 * `ready` (derived: an agent could pick this node up right now — see
 * lib/pickup.ts) draws a subtle green ring, marking the parallelization
 * frontier. Stale nodes are never ready, so the ring never fights the dim.
 *
 * `blocked` (derived: agent-turn, unclaimed, but held back by an unfinished
 * firm-family gate — see lib/pickup.ts) shows a red BLOCKED badge so it's
 * obvious the node is sitting idle on purpose. Ready and blocked are disjoint,
 * and blocked nodes are never stale, so at most one corner badge shows.
 */
export function TaskNodeView({ data }: NodeProps<TaskFlowNode>) {
  const task = data.task
  const stale = data.stale && task.status !== 'invalidated'
  const meta = STATUS_META[task.status]
  const treat = cardTreatment(task.status, stale)
  const container = data.container
  const containerComplete = container?.complete ?? false
  // Ready cards are always agent-turn (dark, no glow), so the ring never
  // collides with treat.glow; a fully-settled container gets a green glow to
  // signal its gates are clear; otherwise fall back to the treatment glow.
  const boxShadow = data.ready
    ? READY_RING
    : containerComplete
      ? CONTAINER_DONE_GLOW
      : treat.glow
  return (
    <div
      className="task-node"
      style={{
        width: NODE_WIDTH,
        minHeight: NODE_HEIGHT,
        backgroundColor: treat.background,
        border: `2px solid ${treat.borderColor}`,
        borderLeft: containerComplete
          ? `6px solid ${CONTAINER_DONE_GREEN}`
          : treat.accentBar
            ? `6px solid ${treat.accentBar}`
            : `2px solid ${treat.borderColor}`,
        color: treat.text,
        boxShadow,
        opacity: treat.dim,
      }}
    >
      <Handle type="target" position={Position.Top} className="task-node-handle" />
      {stale ? (
        <span className="task-node-stale-badge">STALE</span>
      ) : data.blocked ? (
        <span className="task-node-blocked-badge">BLOCKED</span>
      ) : containerComplete ? (
        <span className="task-node-complete-badge">✓ CLEAR</span>
      ) : null}
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
        {data.softBlocked ? (
          <span
            className="task-node-soft-badge"
            title="soft-blocked — a shared decision upstream is still open; pickable, but a stretch"
          >
            soft-blocked
          </span>
        ) : null}
      </div>
      {container && container.total > 0 ? (
        <div className="task-node-container">
          <div className="task-node-progress" title={`${container.settled} of ${container.total} subtasks settled`}>
            <div
              className="task-node-progress-fill"
              style={{
                width: `${(container.settled / container.total) * 100}%`,
                background: CONTAINER_DONE_GREEN,
              }}
            />
          </div>
          <div className="task-node-container-meta">
            <span>
              {container.settled}/{container.total} settled
            </span>
            {container.gates > 0 ? (
              <span className="task-node-gates">
                {containerComplete ? `✓ ${container.gates} cleared` : `gates ${container.gates}`}
              </span>
            ) : null}
          </div>
        </div>
      ) : null}
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
