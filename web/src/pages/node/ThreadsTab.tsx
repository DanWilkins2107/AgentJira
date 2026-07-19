import { useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import { StatusPill } from '../../components/StatusPill'
import { useAuth } from '../../lib/auth'
import { supabase } from '../../lib/supabase'
import { MESSAGE_TYPES } from '../../lib/types'
import type { Message, MessageType, NodeStatus, TaskNode } from '../../lib/types'

/** Messages grouped by stage (newest stage group first, newest message first within each); composer posts as human. */
export function ThreadsTab({
  node,
  messages,
  reload,
}: {
  node: TaskNode
  messages: Message[]
  reload: () => Promise<void>
}) {
  const { session } = useAuth()
  const [type, setType] = useState<MessageType>('note')
  const [body, setBody] = useState('')
  const [handBack, setHandBack] = useState(true)
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const groups = useMemo(() => {
    const byStage = new Map<NodeStatus, Message[]>()
    for (const m of messages) {
      const list = byStage.get(m.stage)
      if (list) list.push(m)
      else byStage.set(m.stage, [m])
    }
    // Newest stage group first, by the latest message in each group.
    return [...byStage.entries()].sort((a, b) => {
      const lastA = a[1][a[1].length - 1].created_at
      const lastB = b[1][b[1].length - 1].created_at
      return lastB.localeCompare(lastA)
    })
  }, [messages])

  const offerHandBack = node.status === 'awaiting_human_response' && type === 'answer'

  async function post(e: FormEvent) {
    e.preventDefault()
    if (!body.trim()) return
    setBusy(true)
    setErr(null)
    const { error } = await supabase.from('messages').insert({
      node_id: node.id,
      project_id: node.project_id,
      stage: node.status,
      author_role: 'human',
      author_id: session?.user.id ?? null,
      type,
      body: body.trim(),
    })
    if (error) {
      setErr(error.message)
      setBusy(false)
      return
    }
    if (offerHandBack && handBack) {
      const { error: statusErr } = await supabase
        .from('nodes')
        .update({ status: 'awaiting_agent_breakdown' })
        .eq('id', node.id)
      if (statusErr) setErr(statusErr.message)
    }
    setBody('')
    setType('note')
    setBusy(false)
    await reload()
  }

  return (
    <div className="threads-tab">
      <form className="card composer" onSubmit={post}>
        <div className="composer-row">
          <label>
            Type
            <select value={type} onChange={(e) => setType(e.target.value as MessageType)}>
              {MESSAGE_TYPES.filter((t) => t !== 'system').map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </label>
          <span className="muted">
            posts to stage <code>{node.status}</code>
          </span>
        </div>
        <textarea
          rows={3}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Write a message…"
        />
        {offerHandBack ? (
          <label className="checkbox-label">
            <input type="checkbox" checked={handBack} onChange={(e) => setHandBack(e.target.checked)} />
            Hand back to agent (status → <code>awaiting_agent_breakdown</code>)
          </label>
        ) : null}
        {err ? <div className="form-error">{err}</div> : null}
        <button type="submit" disabled={busy || !body.trim()}>
          Post
        </button>
      </form>

      {groups.length === 0 ? <p className="muted">No messages yet.</p> : null}
      {groups.map(([stage, msgs]) => (
        <div key={stage} className="stage-group card">
          <div className="stage-group-head">
            <StatusPill status={stage} />
            <span className="muted">{msgs.length} message{msgs.length === 1 ? '' : 's'}</span>
          </div>
          {[...msgs].reverse().map((m) => (
            <div key={m.id} className={`message message-${m.author_role}`}>
              <div className="message-meta">
                <span className={`role-badge role-${m.author_role}`}>{m.author_role}</span>
                <span className={`msg-type msg-type-${m.type}`}>{m.type}</span>
                <span className="muted">{new Date(m.created_at).toLocaleString()}</span>
              </div>
              <div className="message-body">{m.body}</div>
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}
