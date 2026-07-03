import { useState } from 'react'
import type { FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../../lib/auth'
import { EDGE_STYLE, statusRgba } from '../../lib/statusMeta'
import { supabase } from '../../lib/supabase'
import { EDGE_TYPES } from '../../lib/types'
import type { EdgeType, NodeEdge, TaskNode } from '../../lib/types'
import type { NodeSummary } from '../NodePage'

/** Both-direction edge list incl. removed (dimmed); add form; remove sets removed_at — never deletes. */
export function EdgesTab({
  node,
  edges,
  projectNodes,
  reload,
}: {
  node: TaskNode
  edges: NodeEdge[]
  projectNodes: NodeSummary[]
  reload: () => Promise<void>
}) {
  const { session } = useAuth()
  const [newType, setNewType] = useState<EdgeType>('relates_to')
  const [targetId, setTargetId] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const byId = new Map(projectNodes.map((n) => [n.id, n]))
  const candidates = projectNodes.filter((n) => n.id !== node.id)

  async function addEdge(e: FormEvent) {
    e.preventDefault()
    if (!targetId) return
    setBusy(true)
    setErr(null)
    const { error } = await supabase.from('edges').insert({
      project_id: node.project_id,
      source_id: node.id,
      target_id: targetId,
      type: newType,
      created_by: session?.user.id,
    })
    setBusy(false)
    if (error) setErr(error.message)
    else {
      setTargetId('')
      await reload()
    }
  }

  async function removeEdge(edge: NodeEdge) {
    setBusy(true)
    setErr(null)
    // Never delete — flag removed_at.
    const { error } = await supabase
      .from('edges')
      .update({ removed_at: new Date().toISOString() })
      .eq('id', edge.id)
    setBusy(false)
    if (error) setErr(error.message)
    else await reload()
  }

  const sorted = [...edges].sort((a, b) => {
    if ((a.removed_at === null) !== (b.removed_at === null)) return a.removed_at === null ? -1 : 1
    return a.created_at.localeCompare(b.created_at)
  })

  return (
    <div className="edges-tab">
      <form className="card add-edge-form" onSubmit={addEdge}>
        <h3>Add edge (this node → target)</h3>
        {err ? <div className="form-error">{err}</div> : null}
        <div className="form-row">
          <label>
            Type
            <select value={newType} onChange={(e) => setNewType(e.target.value as EdgeType)}>
              {EDGE_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </label>
          <label>
            Target node
            <select value={targetId} onChange={(e) => setTargetId(e.target.value)} required>
              <option value="">— pick a node —</option>
              {candidates.map((n) => (
                <option key={n.id} value={n.id}>
                  {n.title} ({n.status})
                </option>
              ))}
            </select>
          </label>
          <button type="submit" disabled={busy || !targetId}>
            Add edge
          </button>
        </div>
      </form>

      <div className="card edge-list">
        <h3>Edges (both directions, removed ones dimmed)</h3>
        {sorted.length === 0 ? <p className="muted">No edges.</p> : null}
        {sorted.map((e) => {
          const outgoing = e.source_id === node.id
          const otherId = outgoing ? e.target_id : e.source_id
          const other = byId.get(otherId)
          const style = EDGE_STYLE[e.type]
          return (
            <div key={e.id} className={`edge-row${e.removed_at ? ' edge-row-removed' : ''}`}>
              <span className="edge-dir">{outgoing ? 'this →' : '← this'}</span>
              <span className="edge-type-badge" style={{ borderColor: style.stroke, color: style.stroke }}>
                {e.type}
              </span>
              {other ? (
                <Link to={`/n/${other.id}`} style={{ color: statusRgba(other.status), fontWeight: 600 }}>
                  {other.title}
                </Link>
              ) : (
                <span className="muted">{otherId}</span>
              )}
              {e.removed_at ? (
                <span className="muted">removed {new Date(e.removed_at).toLocaleString()}</span>
              ) : (
                <button className="btn-small" disabled={busy} onClick={() => removeEdge(e)}>
                  Remove
                </button>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
