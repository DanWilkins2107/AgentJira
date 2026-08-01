import { Handle, Position } from '@xyflow/react'
import type { Node, NodeProps } from '@xyflow/react'
import { NOT_PICKABLE_DIM, STATUS_META, cardTreatment } from '../lib/statusMeta'
import type { TaskNode } from '../lib/types'
import { NODE_HEIGHT, NODE_WIDTH } from '../lib/graphLayout'

/** Depth-tapered card size, supplied by the tidy-tree layout (graphLayout.ts). */
interface NodeSize {
  width: number
  height: number
}

export type TaskFlowNode = Node<
  {
    task: TaskNode
    stale: boolean
    ready: boolean
    blocked: boolean
    // Advisory only: an upstream soft block's shared decision is still open.
    // Derived independently of `blocked`/`ready`, but only *shown* when the node
    // isn't firm-blocked — the hard gate is the thing worth reading.
    softBlocked: boolean
    // Present only for broken_down containers: how far its subtree is toward
    // clearing its coarse gates (see lib/pickup.ts), and how many nodes it gates.
    container?: { settled: number; total: number; complete: boolean; gates: number }
    // Card size from the layout — parents are bigger, tapering down the spine.
    size?: NodeSize
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
 * lib/pickup.ts) marks the parallelization frontier. Rather than accent the few
 * pickable cards, we fade the ones nobody can act on now: firm-blocked cards
 * waiting on a gate, and settled cards (done / broken_down / invalidated).
 * Everything actionable stays at full opacity — pickable (`ready`), in progress
 * (`claimed_by`), or awaiting a person (human- and github-turn, incl. PR raised).
 * Invalidated/stale cards keep their own, deeper fade (the `Math.min` below
 * never brightens them).
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
  // A fully-settled container gets a green glow to signal its gates are clear;
  // otherwise fall back to the treatment glow (light human-turn cards only).
  const boxShadow = containerComplete ? CONTAINER_DONE_GLOW : treat.glow
  // Solid = actionable now: pickable, in progress (claimed), or awaiting a
  // person (human- or github-turn, e.g. PR raised). Everything else is parked —
  // firm-blocked or settled (done/broken_down/invalidated) — so it recedes.
  const actionable =
    data.ready ||
    task.claimed_by !== null ||
    meta.turn === 'human' ||
    meta.turn === 'github'
  return (
    <div
      className="task-node"
      style={{
        width: data.size?.width ?? NODE_WIDTH,
        minHeight: data.size?.height ?? NODE_HEIGHT,
        backgroundColor: treat.background,
        border: `2px solid ${treat.borderColor}`,
        borderLeft: containerComplete
          ? `6px solid ${CONTAINER_DONE_GREEN}`
          : treat.accentBar
            ? `6px solid ${treat.accentBar}`
            : `2px solid ${treat.borderColor}`,
        color: treat.text,
        boxShadow,
        // Actionable cards keep their natural opacity; parked cards recede so the
        // actionable set reads at a glance. Invalidated/stale keep their own
        // deeper dim either way (via treat.dim / Math.min).
        opacity: actionable ? treat.dim ?? 1 : Math.min(treat.dim ?? 1, NOT_PICKABLE_DIM),
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
        {/* Advisory only, and only worth saying when nothing harder is already
            stopping the node: a firm BLOCKED badge supersedes it — "pickable,
            but a stretch" is misleading on a card that isn't pickable at all. */}
        {data.softBlocked && !data.blocked ? (
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
