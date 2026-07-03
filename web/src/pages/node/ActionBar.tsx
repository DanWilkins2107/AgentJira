import { useState } from 'react'
import { useAuth } from '../../lib/auth'
import { supabase } from '../../lib/supabase'
import { NODE_STATUSES } from '../../lib/types'
import type { MessageType, NodeStatus, TaskNode } from '../../lib/types'

/**
 * Contextual actions per the contract:
 * - split_proposed: approve → split_approved / reject → awaiting_agent_breakdown,
 *   both posting a split_decision message with the human's note.
 * - spec_review: approve → ready_for_pickup / reject → awaiting_agent_spec + required review_comment.
 * - invalidate (dialog, required reason) → invalidate_node RPC.
 * - unclaim; manual set-status escape hatch.
 */
export function ActionBar({ node, reload }: { node: TaskNode; reload: () => Promise<void> }) {
  const { session } = useAuth()
  const [note, setNote] = useState('')
  const [showInvalidate, setShowInvalidate] = useState(false)
  const [invalidateReason, setInvalidateReason] = useState('')
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
            <button disabled={busy} className="btn-approve" onClick={() => splitDecision(true)}>
              Approve split
            </button>
            <button disabled={busy} className="btn-reject" onClick={() => splitDecision(false)}>
              Reject split
            </button>
          </>
        ) : null}

        {node.status === 'spec_review' ? (
          <>
            <button disabled={busy} className="btn-approve" onClick={() => specDecision(true)}>
              Approve spec
            </button>
            <button disabled={busy || !note.trim()} className="btn-reject" onClick={() => specDecision(false)}>
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
        ) : null}

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
      </div>

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
