import { useState } from 'react'
import { supabase } from '../../lib/supabase'
import type { TaskNode } from '../../lib/types'

/** Spec text rendered readably + PR link, number, merge SHA, and the
 * plan-deliverable toggle (merged PR routes back to breakdown, not done). */
export function SpecTab({ node, reload }: { node: TaskNode; reload: () => Promise<void> }) {
  const [err, setErr] = useState<string | null>(null)

  async function setBreakdownOnMerge(value: boolean) {
    const { error } = await supabase
      .from('nodes')
      .update({ breakdown_on_merge: value })
      .eq('id', node.id)
    if (error) setErr(error.message)
    else {
      setErr(null)
      await reload()
    }
  }

  return (
    <div className="spec-tab">
      <div className="card">
        <h3>Spec</h3>
        {node.spec ? (
          <pre className="spec-text">{node.spec}</pre>
        ) : (
          <p className="muted">No spec yet.</p>
        )}
      </div>
      <div className="card">
        <h3>Pull request</h3>
        {node.pr_url ? (
          <p>
            <a href={node.pr_url} target="_blank" rel="noreferrer">
              {node.pr_url}
            </a>
            {node.pr_number != null ? <span className="muted"> · #{node.pr_number}</span> : null}
          </p>
        ) : (
          <p className="muted">No PR linked.</p>
        )}
        {node.merge_sha ? (
          <p>
            Merged: <code>{node.merge_sha}</code>
          </p>
        ) : null}
        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={node.breakdown_on_merge}
            onChange={(e) => void setBreakdownOnMerge(e.target.checked)}
          />
          Plan deliverable — merged PR routes back to <code>awaiting_agent_breakdown</code>{' '}
          (the landed document then gets split into tasks) instead of <code>done</code>
        </label>
        {err ? <div className="form-error">{err}</div> : null}
      </div>
    </div>
  )
}
