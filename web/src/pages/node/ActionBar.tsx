import { useState } from 'react'
import type { CSSProperties } from 'react'
import { isNodeStatus } from '../../components/StageFlow'
import { useAuth } from '../../lib/auth'
import { supabase } from '../../lib/supabase'
import { NODE_STATUSES } from '../../lib/types'
import type { EventRow, MessageType, NodeStatus, TaskNode } from '../../lib/types'

/**
 * Contextual actions per the contract:
 * - split_proposed: approve → split_approved / reject → awaiting_agent_breakdown,
 *   both posting a split_decision message with the human's note.
 * - spec_review: approve → ready_for_pickup / reject → awaiting_agent_spec + required review_comment.
 * - invalidate (dialog, required reason) → invalidate_node RPC.
 * - restore (dialog, invalidated nodes only): reverses an invalidation — sets status
 *   back to the pre-invalidation status (from events, human may override) and clears
 *   invalidation_reason. Never deletes anything.
 * - unclaim; manual set-status demoted into a collapsed "Advanced" escape hatch.
 */

// Approve/Reject ARE the "next" buttons when it's the human's decision turn —
// promoted styling so the StageFlow cue ("your decision needed below") lands here.
const promotedStyle: CSSProperties = { fontSize: 15, fontWeight: 700, padding: '10px 20px' }

/** Default restore target: the `from` of the most recent transition into 'invalidated'. */
function defaultRestoreTarget(events: EventRow[]): NodeStatus {
  for (const e of events) {
    // events are newest-first
    if (e.type !== 'node.status_changed') continue
    if (e.data['to'] === 'invalidated') {
      const from = e.data['from']
      if (isNodeStatus(from) && from !== 'invalidated') return from
    }
  }
  return 'awaiting_agent_breakdown'
}

export function ActionBar({
  node,
  events,
  reload,
}: {
  node: TaskNode
  events: EventRow[]
  reload: () => Promise<void>
}) {
  const { session } = useAuth()
  const [note, setNote] = useState('')
  const [showInvalidate, setShowInvalidate] = useState(false)
  const [invalidateReason, setInvalidateReason] = useState('')
  const [showRestore, setShowRestore] = useState(false)
  const [restoreTarget, setRestoreTarget] = useState<NodeStatus>('awaiting_agent_breakdown')
  const [restoreNote, setRestoreNote] = useState('')
  const [manualStatus, setManualStatus] = useState<NodeStatus>(node.status)
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function run(fn: () => Promise<string | null>) {
    setBusy(true)
    setErr(null)
    const e = await fn()
    setBusy(false)
    if (e) setErr(e)
    else {
      setNote('')
      await reload()
    }
  }

  async function postMessage(type: MessageType, body: string, stage: NodeStatus): Promise<string | null> {
    const { error } = await supabase.from('messages').insert({
      node_id: node.id,
      project_id: node.project_id,
      stage,
      author_role: 'human',
      author_id: session?.user.id ?? null,
      type,
      body,
    })
    return error?.message ?? null
  }

  async function setStatus(status: NodeStatus): Promise<string | null> {
    const { error } = await supabase.from('nodes').update({ status }).eq('id', node.id)
    return error?.message ?? null
  }

  async function splitDecision(approve: boolean) {
    await run(async () => {
      const body = note.trim() || (approve ? 'Split approved.' : 'Split rejected.')
      // Post the decision at the stage it was decided in, then transition.
      const msgErr = await postMessage('split_decision', body, node.status)
      if (msgErr) return msgErr
      return setStatus(approve ? 'split_approved' : 'awaiting_agent_breakdown')
    })
  }

  async function specDecision(approve: boolean) {
    if (!approve && !note.trim()) {
      setErr('A review comment is required to reject a spec.')
      return
    }
    await run(async () => {
      if (approve) {
        if (note.trim()) {
          const msgErr = await postMessage('review_comment', note.trim(), node.status)
          if (msgErr) return msgErr
        }
        return setStatus('ready_for_pickup')
      }
      const msgErr = await postMessage('review_comment', note.trim(), node.status)
      if (msgErr) return msgErr
      return setStatus('awaiting_agent_spec')
    })
  }

  async function invalidate() {
    if (!invalidateReason.trim()) return
    await run(async () => {
      const { error } = await supabase.rpc('invalidate_node', {
        p_node: node.id,
        p_reason: invalidateReason.trim(),
      })
      if (error) return error.message
      setShowInvalidate(false)
      setInvalidateReason('')
      return null
    })
  }

  function openRestore() {
    setRestoreTarget(defaultRestoreTarget(events))
    setRestoreNote('')
    setShowRestore(true)
  }

  async function restore() {
    await run(async () => {
      if (restoreNote.trim()) {
        // Explain the restore in the thread at the stage it happened (invalidated).
        const msgErr = await postMessage('note', restoreNote.trim(), node.status)
        if (msgErr) return msgErr
      }
      // The DB trigger logs the status change; we never write events ourselves.
      const { error } = await supabase
        .from('nodes')
        .update({ status: restoreTarget, invalidation_reason: null })
        .eq('id', node.id)
      if (error) return error.message
      setShowRestore(false)
      return null
    })
  }

  async function unclaim() {
    await run(async () => {
      const { error } = await supabase
        .from('nodes')
        .update({ claimed_by: null, claimed_at: null })
        .eq('id', node.id)
      return error?.message ?? null
    })
  }

  async function manualSet() {
    await run(() => setStatus(manualStatus))
  }

  const needsNote = node.status === 'split_proposed' || node.status === 'spec_review'

  return (
    <div className="card action-bar">
      {err ? <div className="form-error">{err}</div> : null}

      {needsNote ? (
        <textarea
          className="action-note"
          placeholder={
            node.status === 'split_proposed'
              ? 'Note on the split decision (posted as a split_decision message)…'
              : 'Review comment (required to reject)…'
          }
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={2}
        />
      ) : null}

      <div className="action-buttons">
        {node.status === 'split_proposed' ? (
          <>
            <button
              disabled={busy}
              className="btn-approve"
              style={promotedStyle}
              onClick={() => splitDecision(true)}
            >
              Approve split
            </button>
            <button
              disabled={busy}
              className="btn-reject"
              style={promotedStyle}
              onClick={() => splitDecision(false)}
            >
              Reject split
            </button>
          </>
        ) : null}

        {node.status === 'spec_review' ? (
          <>
            <button
              disabled={busy}
              className="btn-approve"
              style={promotedStyle}
              onClick={() => specDecision(true)}
            >
              Approve spec
            </button>
            <button
              disabled={busy || !note.trim()}
              className="btn-reject"
              style={promotedStyle}
              onClick={() => specDecision(false)}
            >
              Reject spec
            </button>
          </>
        ) : null}

        {node.claimed_by ? (
          <button disabled={busy} className="btn-small" onClick={unclaim}>
            Unclaim ({node.claimed_by})
          </button>
        ) : null}

        {node.status !== 'invalidated' ? (
          <button disabled={busy} className="btn-danger" onClick={() => setShowInvalidate(true)}>
            Invalidate…
          </button>
        ) : (
          <button disabled={busy} className="btn-approve" onClick={openRestore}>
            Restore node…
          </button>
        )}
      </div>

      <details className="action-manual-details">
        <summary>Advanced: set status manually (escape hatch)</summary>
        <span className="action-manual">
          <select
            value={manualStatus}
            onChange={(e) => setManualStatus(e.target.value as NodeStatus)}
            aria-label="Set status manually"
          >
            {NODE_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <button disabled={busy || manualStatus === node.status} className="btn-small" onClick={manualSet}>
            Set status
          </button>
        </span>
      </details>

      {showRestore ? (
        <div className="dialog-backdrop" onClick={() => setShowRestore(false)}>
          <div className="dialog" onClick={(e) => e.stopPropagation()}>
            <h3>Restore node</h3>
            <p className="muted">
              Reverses the invalidation: sets the status back (default = the status it had before
              being invalidated) and clears the reason. Descendants that were only
              inherited-invalidated come back automatically. <code>stale</code> flags on descendants
              are NOT auto-cleared — their premises still need re-checking. Nothing is deleted.
            </p>
            <label>
              Restore to status
              <select
                value={restoreTarget}
                onChange={(e) => setRestoreTarget(e.target.value as NodeStatus)}
              >
                {NODE_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </label>
            <textarea
              rows={3}
              value={restoreNote}
              onChange={(e) => setRestoreNote(e.target.value)}
              placeholder="Optional note explaining the restore (posted to the thread)…"
            />
            <div className="action-buttons">
              <button className="btn-approve" disabled={busy} onClick={restore}>
                Restore
              </button>
              <button className="btn-small" disabled={busy} onClick={() => setShowRestore(false)}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {showInvalidate ? (
        <div className="dialog-backdrop" onClick={() => setShowInvalidate(false)}>
          <div className="dialog" onClick={(e) => e.stopPropagation()}>
            <h3>Invalidate node</h3>
            <p className="muted">
              The node stays forever as context; descendants and firm-block targets are marked stale.
              A reason is required.
            </p>
            <textarea
              autoFocus
              rows={3}
              value={invalidateReason}
              onChange={(e) => setInvalidateReason(e.target.value)}
              placeholder="Why is this node wrong?"
            />
            <div className="action-buttons">
              <button
                className="btn-danger"
                disabled={busy || !invalidateReason.trim()}
                onClick={invalidate}
              >
                Invalidate
              </button>
              <button className="btn-small" disabled={busy} onClick={() => setShowInvalidate(false)}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
