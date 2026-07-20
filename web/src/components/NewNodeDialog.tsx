import { useState } from 'react'
import { useAuth } from '../lib/auth'
import { supabase } from '../lib/supabase'
import type { TaskNode } from '../lib/types'

/**
 * Human-facing node creation — the UI counterpart to `aj create-node`.
 * Matches the CLI default: new nodes start at `awaiting_agent_breakdown` with
 * no parent, so an agent decides how to break them down. The DB triggers log
 * the insert event; we never write events ourselves.
 */
export function NewNodeDialog({
  projectId,
  onClose,
  onCreated,
}: {
  projectId: string
  onClose: () => void
  onCreated: (node: TaskNode) => void
}) {
  const { session } = useAuth()
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function create() {
    const trimmed = title.trim()
    if (!trimmed) {
      setErr('A title is required.')
      return
    }
    setBusy(true)
    setErr(null)
    const { data, error } = await supabase
      .from('nodes')
      .insert({
        project_id: projectId,
        title: trimmed,
        body: body.trim(),
        status: 'awaiting_agent_breakdown',
        created_by: session?.user.id ?? null,
      })
      .select()
      .single()
    setBusy(false)
    if (error) {
      setErr(error.message)
      return
    }
    onCreated(data as TaskNode)
  }

  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <div className="dialog" onClick={(e) => e.stopPropagation()}>
        <h3>New node</h3>
        <p className="muted">
          Starts at <strong>awaiting_agent_breakdown</strong> — an agent picks it up and decides how
          to break it down. Same as <code>aj create-node</code>.
        </p>
        {err ? <div className="form-error">{err}</div> : null}
        <label>
          Title
          <input
            autoFocus
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void create()
            }}
            placeholder="What needs doing?"
          />
        </label>
        <textarea
          rows={5}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Body (markdown, optional)…"
        />
        <div className="action-buttons">
          <button className="btn-approve" disabled={busy || !title.trim()} onClick={create}>
            Create node
          </button>
          <button className="btn-small" disabled={busy} onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}
