import { Fragment, useMemo, useState } from 'react'
import type { CSSProperties } from 'react'
import { STATUS_META, statusRgba } from '../lib/statusMeta'
import { NODE_STATUSES } from '../lib/types'
import type { EventRow, NodeStatus, TaskNode } from '../lib/types'
import './StageFlow.css'

/**
 * StageFlow — horizontal stepper visualizing the whole canonical pipeline:
 *
 *   human_braindump_needed → awaiting_agent_breakdown → fork:
 *     split path:      split_proposed → split_approved → broken_down
 *     spec path:       awaiting_agent_spec → spec_review → ready_for_pickup → pr_raised → done
 *     human-only path: human_only_action → done
 *
 * awaiting_human_response is a side-loop (off-rail chip anchored at the last
 * on-rail status); invalidated is off-rail too (dims the whole rail).
 * The visited sequence is derived from node.status_changed events, so skipped
 * steps (never visited but earlier than the furthest progress) are obvious.
 * Below the rail sits the single primary "next" action for the current status.
 */

const COMMON_STEPS: NodeStatus[] = ['human_braindump_needed', 'awaiting_agent_breakdown']
const SPLIT_STEPS: NodeStatus[] = ['split_proposed', 'split_approved', 'broken_down']
const SPEC_STEPS: NodeStatus[] = [
  'awaiting_agent_spec',
  'spec_review',
  'ready_for_pickup',
  'pr_raised',
  'done',
]
// A third branch off the same fork, and the shortest one: work only a person
// can do goes straight from the human to done. No agent stage, so no spec, no
// PR, and no hand-back — the node is the human's for its whole life.
const HUMAN_ONLY_STEPS: NodeStatus[] = ['human_only_action', 'done']

export function isNodeStatus(v: unknown): v is NodeStatus {
  return typeof v === 'string' && (NODE_STATUSES as readonly string[]).includes(v)
}

/**
 * Visited status sequence, oldest → newest, derived from node.status_changed
 * events (passed newest-first, as NodePage loads them). Seeded with the initial
 * status inferred from the first transition's `from`; always ends with the
 * node's current status.
 */
export function visitedSequence(node: TaskNode, events: EventRow[]): NodeStatus[] {
  const changes = events.filter((e) => e.type === 'node.status_changed').slice().reverse()
  const seq: NodeStatus[] = []
  for (const e of changes) {
    const from = e.data['from']
    const to = e.data['to']
    if (seq.length === 0 && isNodeStatus(from)) seq.push(from)
    if (isNodeStatus(to)) seq.push(to)
  }
  if (seq.length === 0 || seq[seq.length - 1] !== node.status) seq.push(node.status)
  return seq
}

/**
 * Where to return when the human has answered an awaiting_human_response
 * question: the `from` of the most recent transition INTO awaiting_human_response.
 */
export function questionReturnTarget(events: EventRow[]): NodeStatus {
  for (const e of events) {
    // events are newest-first
    if (e.type !== 'node.status_changed') continue
    if (e.data['to'] === 'awaiting_human_response') {
      const from = e.data['from']
      if (isNodeStatus(from) && from !== 'awaiting_human_response') return from
    }
  }
  return 'awaiting_agent_breakdown'
}

type StepState = 'visited' | 'current' | 'skipped' | 'future'
type OffRailChip =
  | 'awaiting_human_response'
  | 'pr_changes_requested'
  | 'evaluating_soft_block'
  | 'invalidated'
  | null

/** Rail index the off-rail chip anchors to: last on-rail status in the visited sequence. */
function anchorIndex(rail: NodeStatus[], visited: NodeStatus[]): number {
  for (let i = visited.length - 1; i >= 0; i--) {
    const idx = rail.indexOf(visited[i])
    if (idx >= 0) return idx
  }
  return rail.indexOf('awaiting_agent_breakdown')
}

export function StageFlow({
  node,
  events,
  onSetStatus,
}: {
  node: TaskNode
  events: EventRow[]
  onSetStatus: (status: NodeStatus) => Promise<void>
}) {
  const [busy, setBusy] = useState(false)

  const visited = useMemo(() => visitedSequence(node, events), [node, events])
  const visitedSet = useMemo(() => new Set<NodeStatus>(visited), [visited])

  const splitTouched = SPLIT_STEPS.some((s) => visitedSet.has(s))
  const specTouched = SPEC_STEPS.some((s) => visitedSet.has(s))
  const humanOnlyTouched = visitedSet.has('human_only_action')
  // Back at the fork: a spec-stage node was sent back to breakdown, so the
  // branch choice is open again regardless of history — re-show both futures.
  const atOpenFork = node.status === 'awaiting_agent_breakdown'
  const undecided = atOpenFork || (!splitTouched && !specTouched && !humanOnlyTouched)

  // The rendered rail. Both branches touched (split then spec — legal): only the
  // split steps actually visited stay on the rail, then the spec branch.
  const rail: NodeStatus[] = useMemo(() => {
    if (atOpenFork) return COMMON_STEPS // fork reopened: render both branches as futures
    // Human-only wins the branch: this node ends at done by a person's hand, so
    // whatever agent stages it passed through first are history on the way there.
    // Usually the node was CREATED human_only_action and the rail is just the two
    // steps; the filter only has anything to add when it arrived here later.
    if (humanOnlyTouched) {
      const priorVisited = [...COMMON_STEPS, ...SPLIT_STEPS, ...SPEC_STEPS].filter(
        (s) => s !== 'done' && visitedSet.has(s),
      )
      return [...priorVisited, ...HUMAN_ONLY_STEPS]
    }
    if (splitTouched && specTouched)
      return [...COMMON_STEPS, ...SPLIT_STEPS.filter((s) => visitedSet.has(s)), ...SPEC_STEPS]
    if (splitTouched) return [...COMMON_STEPS, ...SPLIT_STEPS]
    if (specTouched) return [...COMMON_STEPS, ...SPEC_STEPS]
    return COMMON_STEPS // undecided: all branches rendered separately as dimmed futures
  }, [atOpenFork, humanOnlyTouched, splitTouched, specTouched, visitedSet])

  const offRail =
    node.status === 'awaiting_human_response' ||
    node.status === 'pr_changes_requested' ||
    node.status === 'evaluating_soft_block' ||
    node.status === 'invalidated'
  const currentIdx = offRail ? anchorIndex(rail, visited) : rail.indexOf(node.status)

  // Furthest progress along the rendered rail (visited or current) — anything
  // earlier that was never visited is a skipped step.
  let furthestIdx = currentIdx
  for (const s of visitedSet) {
    const i = rail.indexOf(s)
    if (i > furthestIdx) furthestIdx = i
  }

  function stepState(status: NodeStatus, i: number): StepState {
    if (!offRail && status === node.status) return 'current'
    if (visitedSet.has(status)) return 'visited'
    if (i < furthestIdx) return 'skipped'
    return 'future'
  }

  const chip: OffRailChip =
    node.status === 'awaiting_human_response' ||
    node.status === 'pr_changes_requested' ||
    node.status === 'evaluating_soft_block' ||
    node.status === 'invalidated'
      ? node.status
      : null

  async function go(target: NodeStatus) {
    setBusy(true)
    try {
      await onSetStatus(target)
    } finally {
      setBusy(false)
    }
  }

  function renderNext() {
    const color = statusRgba(node.status)
    switch (node.status) {
      case 'human_braindump_needed':
        return (
          <button
            className="sf-next-btn"
            style={{ background: color }}
            disabled={busy}
            onClick={() => void go('awaiting_agent_breakdown')}
          >
            Braindump done — send to agent →
          </button>
        )
      case 'awaiting_human_response':
        return (
          <button
            className="sf-next-btn"
            style={{ background: color }}
            disabled={busy}
            onClick={() => void go(questionReturnTarget(events))}
          >
            Answered — return to agent →
          </button>
        )
      case 'human_only_action':
        // No hand-back: the node was never an agent's, so finishing it IS the
        // transition. Anything downstream unblocks off the block edge, as usual.
        return (
          <button
            className="sf-next-btn"
            style={{ background: color }}
            disabled={busy}
            onClick={() => void go('done')}
          >
            I've done it — mark done →
          </button>
        )
      case 'split_proposed':
      case 'spec_review':
        return (
          <span
            className="sf-cue"
            style={{ background: statusRgba(node.status, 0.25), borderColor: color }}
          >
            Your decision needed below ↓
          </span>
        )
      case 'awaiting_agent_breakdown':
      case 'split_approved':
      case 'awaiting_agent_spec':
      case 'ready_for_pickup':
        return (
          <span className="sf-hint" style={{ color }}>
            Waiting on agent
          </span>
        )
      case 'evaluating_soft_block':
        return (
          <span className="sf-hint" style={{ color }}>
            Soft-block judge deciding — will proceed, ask you a question, or defer for reassessment
          </span>
        )
      case 'pr_changes_requested':
        return (
          <span className="sf-hint" style={{ color }}>
            Reviewer requested changes — agent addresses them, then re-requests review
            {node.pr_url ? (
              <>
                {' · '}
                <a href={node.pr_url} target="_blank" rel="noreferrer">
                  PR{node.pr_number != null ? ` #${node.pr_number}` : ''} ↗
                </a>
              </>
            ) : null}
          </span>
        )
      case 'pr_raised':
        // Awaiting the human's review on GitHub — the merge is automatic on
        // approval, so the pending action is the human's. Prompt it like a cue.
        return (
          <span className="sf-cue" style={{ background: statusRgba(node.status, 0.25), borderColor: color }}>
            Your review needed — approve the PR on GitHub
            {node.pr_url ? (
              <>
                {' · '}
                <a href={node.pr_url} target="_blank" rel="noreferrer">
                  PR{node.pr_number != null ? ` #${node.pr_number}` : ''} ↗
                </a>
              </>
            ) : (
              ' ↗'
            )}
          </span>
        )
      case 'broken_down':
        return (
          <span className="sf-hint" style={{ color }}>
            Broken down — work continues in the child nodes
          </span>
        )
      case 'done':
        return (
          <span className="sf-hint" style={{ color }}>
            Done — settled
          </span>
        )
      case 'invalidated':
        return (
          <span className="sf-hint" style={{ color }}>
            Invalidated — use “Restore node…” in the actions below to bring it back
          </span>
        )
    }
  }

  return (
    <div className="stage-flow">
      <div className={`stage-flow-rail${node.status === 'invalidated' ? ' sf-rail-dimmed' : ''}`}>
        {rail.map((s, i) => (
          <Fragment key={s}>
            {i > 0 ? (
              <div className={`sf-conn ${i <= currentIdx ? 'sf-conn-done' : 'sf-conn-future'}`} />
            ) : null}
            <Step
              status={s}
              state={stepState(s, i)}
              chip={offRail && i === currentIdx ? chip : null}
            />
          </Fragment>
        ))}
        {undecided ? (
          <>
            <div className="sf-conn sf-conn-future" />
            <div className="sf-fork">
              <ForkBranch caption="split path" steps={SPLIT_STEPS} />
              <ForkBranch caption="spec path" steps={SPEC_STEPS} />
              <ForkBranch caption="human-only path" steps={HUMAN_ONLY_STEPS} />
            </div>
          </>
        ) : null}
      </div>
      <div className="stage-flow-next">{renderNext()}</div>
    </div>
  )
}

function ForkBranch({ caption, steps }: { caption: string; steps: NodeStatus[] }) {
  return (
    <div className="sf-fork-branch">
      <div className="sf-fork-caption">{caption}</div>
      {steps.map((s, i) => (
        <Fragment key={s}>
          {i > 0 ? <div className="sf-conn sf-conn-future" /> : null}
          <Step status={s} state="future" chip={null} />
        </Fragment>
      ))}
    </div>
  )
}

function Step({ status, state, chip }: { status: NodeStatus; state: StepState; chip: OffRailChip }) {
  const color = statusRgba(status)
  const dotStyle: CSSProperties =
    state === 'visited'
      ? { background: color, borderColor: color }
      : state === 'current'
        ? { background: color, borderColor: color, boxShadow: `0 0 0 4px ${statusRgba(status, 0.28)}` }
        : state === 'skipped'
          ? { background: 'transparent', border: `2px dashed ${statusRgba(status, 0.65)}` }
          : { background: 'transparent', borderColor: statusRgba(status, 0.4) }
  return (
    <div className={`sf-step sf-${state}`} title={`${status} — ${state}`}>
      <div className="sf-dotwrap">
        <span className="sf-dot" style={dotStyle} />
      </div>
      <div className="sf-label">{STATUS_META[status].label}</div>
      {state === 'skipped' ? <div className="sf-caption">skipped</div> : null}
      {chip === 'awaiting_human_response' ? (
        <div
          className="sf-offrail"
          style={{
            borderColor: statusRgba('awaiting_human_response'),
            color: statusRgba('awaiting_human_response'),
          }}
        >
          ⤴ side loop: agent asked a question
        </div>
      ) : chip === 'pr_changes_requested' ? (
        <div
          className="sf-offrail"
          style={{
            borderColor: statusRgba('pr_changes_requested'),
            color: statusRgba('pr_changes_requested'),
          }}
        >
          ⤴ side loop: reviewer requested changes
        </div>
      ) : chip === 'evaluating_soft_block' ? (
        <div
          className="sf-offrail"
          style={{
            borderColor: statusRgba('evaluating_soft_block'),
            color: statusRgba('evaluating_soft_block'),
          }}
        >
          ⤴ side loop: soft-block judge deciding
        </div>
      ) : chip === 'invalidated' ? (
        <div
          className="sf-offrail"
          style={{ borderColor: statusRgba('invalidated'), color: statusRgba('invalidated') }}
        >
          ✕ invalidated — off the rail
        </div>
      ) : null}
    </div>
  )
}
