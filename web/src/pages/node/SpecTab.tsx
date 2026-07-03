import type { TaskNode } from '../../lib/types'

/** Spec text rendered readably + PR link, number and merge SHA. */
export function SpecTab({ node }: { node: TaskNode }) {
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
      </div>
    </div>
  )
}
