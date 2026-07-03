import { useCallback, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { StatusPill } from '../components/StatusPill'
import { STATUS_META, TURN_LABEL, statusRgba } from '../lib/statusMeta'
import { supabase } from '../lib/supabase'
import type {
  AncestorInfo,
  EventRow,
  Message,
  NodeContext,
  NodeEdge,
  TaskNode,
} from '../lib/types'
import { ActionBar } from './node/ActionBar'
import { CanvasTab } from './node/CanvasTab'
import { EdgesTab } from './node/EdgesTab'
import { HistoryTab } from './node/HistoryTab'
import { SpecTab } from './node/SpecTab'
import { ThreadsTab } from './node/ThreadsTab'

type Tab = 'canvas' | 'threads' | 'history' | 'edges' | 'spec'

export interface NodeSummary {
  id: string
  title: string
  status: TaskNode['status']
}

export function NodePage() {
  const { nodeId } = useParams<{ nodeId: string }>()
  const [node, setNode] = useState<TaskNode | null>(null)
  const [context, setContext] = useState<NodeContext | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [events, setEvents] = useState<EventRow[]>([])
  const [edges, setEdges] = useState<NodeEdge[]>([])
  const [projectNodes, setProjectNodes] = useState<NodeSummary[]>([])
  const [error, setError] = useState<string | null>(null)
  const [tab, setTab] = useState<Tab>('threads')
  const [bodyDraft, setBodyDraft] = useState<string>('')
  const [bodyLoaded, setBodyLoaded] = useState(false)

  const load = useCallback(async () => {
    if (!nodeId) return
    const { data: nodeData, error: nodeErr } = await supabase
      .from('nodes')
      .select('*')
      .eq('id', nodeId)
      .single()
    if (nodeErr) {
      setError(nodeErr.message)
      return
    }
    const n = nodeData as TaskNode
    setNode(n)
    setError(null)

    const [ctxRes, msgRes, evRes, edgeRes, pnRes] = await Promise.all([
      supabase.rpc('node_context', { p_node: nodeId }),
      supabase.from('messages').select('*').eq('node_id', nodeId).order('created_at', { ascending: true }),
      supabase.from('events').select('*').eq('node_id', nodeId).order('created_at', { ascending: false }),
      supabase.from('edges').select('*').or(`source_id.eq.${nodeId},target_id.eq.${nodeId}`),
      supabase.from('nodes').select('id, title, status').eq('project_id', n.project_id),
    ])
    if (ctxRes.error) setContext(null)
    else setContext(ctxRes.data as NodeContext)
    if (!msgRes.error) setMessages((msgRes.data ?? []) as Message[])
    if (!evRes.error) setEvents((evRes.data ?? []) as EventRow[])
    if (!edgeRes.error) setEdges((edgeRes.data ?? []) as NodeEdge[])
    if (!pnRes.error) setProjectNodes((pnRes.data ?? []) as NodeSummary[])
  }, [nodeId])

  useEffect(() => {
    setBodyLoaded(false)
    void load()
    window.addEventListener('focus', load)
    return () => window.removeEventListener('focus', load)
  }, [load])

  useEffect(() => {
    if (node && !bodyLoaded) {
      setBodyDraft(node.body)
      setBodyLoaded(true)
    }
  }, [node, bodyLoaded])

  async function saveBody() {
    if (!node) return
    const { error: err } = await supabase.from('nodes').update({ body: bodyDraft }).eq('id', node.id)
    if (err) setError(err.message)
    else await load()
  }

  if (error && !node) return <div className="page form-error">{error}</div>
  if (!node) return <div className="page-loading">Loading…</div>

  const meta = STATUS_META[node.status]
  const ancestors = context?.ancestors ?? []
  const troubledAncestors = ancestors.filter((a) => a.status === 'invalidated' || a.stale)

  return (
    <div className="page node-page">
      <Breadcrumb ancestors={ancestors} node={node} />

      {troubledAncestors.map((a) => (
        <div key={a.id} className="banner banner-danger">
          {a.status === 'invalidated' ? (
            <>
              ⚠ Ancestor <Link to={`/n/${a.id}`}>{a.title}</Link> was <strong>invalidated</strong>
              {a.invalidation_reason ? <>: “{a.invalidation_reason}”</> : null} — this node descends
              from a dead premise.
            </>
          ) : (
            <>
              ⚠ Ancestor <Link to={`/n/${a.id}`}>{a.title}</Link> is <strong>stale</strong> — its
              premise needs re-checking.
            </>
          )}
        </div>
      ))}
      {node.stale ? (
        <div className="banner banner-warn">
          ⚠ This node is <strong>stale</strong>: an ancestor was invalidated; re-check the premise.
        </div>
      ) : null}
      {node.status === 'invalidated' ? (
        <div className="banner banner-danger">
          ✕ Invalidated{node.invalidation_reason ? <>: “{node.invalidation_reason}”</> : null}
        </div>
      ) : null}

      <div className="node-head">
        <h1>
          {node.is_vision ? <span className="task-node-vision">★ </span> : null}
          {node.title}
        </h1>
        <div className="node-head-status">
          <StatusPill status={node.status} />
          <span className="turn-indicator" style={{ color: statusRgba(node.status) }}>
            {TURN_LABEL[meta.turn]}
          </span>
          {node.claimed_by ? (
            <span className="claimed-badge">
              <span className="claimed-dot" /> claimed by {node.claimed_by}
            </span>
          ) : null}
        </div>
      </div>

      {error ? <div className="form-error">{error}</div> : null}

      <ActionBar node={node} reload={load} />

      <div className="card body-editor">
        <h3>Body</h3>
        <textarea
          value={bodyDraft}
          onChange={(e) => setBodyDraft(e.target.value)}
          rows={6}
          placeholder="Markdown body…"
        />
        <button className="btn-small" onClick={saveBody} disabled={bodyDraft === node.body}>
          Save body
        </button>
      </div>

      <div className="tabs">
        {(['threads', 'canvas', 'edges', 'spec', 'history'] as Tab[]).map((t) => (
          <button
            key={t}
            className={`tab-btn${tab === t ? ' tab-btn-active' : ''}`}
            onClick={() => setTab(t)}
          >
            {t === 'spec' ? 'Spec / PR' : t[0].toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>

      {tab === 'threads' ? <ThreadsTab node={node} messages={messages} reload={load} /> : null}
      {tab === 'canvas' ? <CanvasTab key={node.id} node={node} reload={load} /> : null}
      {tab === 'edges' ? (
        <EdgesTab node={node} edges={edges} projectNodes={projectNodes} reload={load} />
      ) : null}
      {tab === 'spec' ? <SpecTab node={node} /> : null}
      {tab === 'history' ? <HistoryTab events={events} /> : null}
    </div>
  )
}

/**
 * Ancestor breadcrumb via node_context. Assumes the chain is ordered vision-first;
 * links are status-colored and stale/invalidated ancestors get a loud flag.
 */
function Breadcrumb({ ancestors, node }: { ancestors: AncestorInfo[]; node: TaskNode }) {
  return (
    <nav className="breadcrumb">
      <Link to={`/p/${node.project_id}`}>Graph</Link>
      {ancestors.map((a) => (
        <span key={a.id} className="crumb">
          <span className="crumb-sep">›</span>
          <Link
            to={`/n/${a.id}`}
            style={{ color: statusRgba(a.status), fontWeight: 600 }}
            title={`${a.status}${a.stale ? ' · STALE' : ''}`}
          >
            {a.title}
          </Link>
          {a.status === 'invalidated' ? <span className="crumb-flag crumb-flag-invalid">INVALIDATED</span> : null}
          {a.stale ? <span className="crumb-flag crumb-flag-stale">STALE</span> : null}
        </span>
      ))}
      <span className="crumb">
        <span className="crumb-sep">›</span>
        <span className="crumb-current">{node.title}</span>
      </span>
    </nav>
  )
}
