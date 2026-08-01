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

  // Group into *contiguous* runs of the same stage, not one bucket per stage: a
  // node revisits stages (awaiting_human_response → agent → awaiting_human_response
  // → …), and keying by stage alone would collapse every visit into a single block,
  // stacking all the human notes together with the agent replies torn out from
  // between them. Messages arrive oldest-first; we render newest run first.
  const groups = useMemo(() => {
    const runs: { stage: NodeStatus; msgs: Message[] }[] = []
    for (const m of messages) {
      const current = runs[runs.length - 1]
      if (current && current.stage === m.stage) current.msgs.push(m)
      else runs.push({ stage: m.stage, msgs: [m] })
    }
    return runs.reverse()
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
      {groups.map(({ stage, msgs }) => (
        // Keyed by first message: the same stage can appear in several runs.
        <div key={msgs[0].id} className="stage-group card">
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
