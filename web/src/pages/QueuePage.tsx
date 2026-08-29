import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { NewNodeDialog } from '../components/NewNodeDialog'
import { SearchBox } from '../components/SearchBox'
import { primaryParents } from '../lib/graphLayout'
import { effectivelyInvalidated } from '../lib/invalidation'
import { humanQueue } from '../lib/pickup'
import { STATUS_META, TURN_LABEL, cardTreatment } from '../lib/statusMeta'
import { useProjectGraph } from '../lib/useProjectGraph'
import type { GraphNode } from '../lib/types'

/** How long the deck must sit still before we commit the card you landed on
 * (anchor + URL). Short enough to survive a reload mid-swipe, long enough that
 * flicking through five cards writes the URL once. */
const SETTLE_MS = 200

/** Ancestor titles shown in a card's breadcrumb, nearest parent last. More than
 * this and the line is all ellipsis on a phone. */
const CRUMB_DEPTH = 2

/** Breadcrumb up the primary subtask spine: the node's nearest ancestors,
 * outermost first, with a leading marker when the chain was longer. Cycles are
 * legal data, so guard and cap the walk. */
function crumbFor(id: string, parents: Map<string, string>, titles: Map<string, string>): string {
  const chain: string[] = []
  const seen = new Set<string>([id])
  let cur = parents.get(id)
  while (cur !== undefined && !seen.has(cur) && chain.length < 50) {
    seen.add(cur)
    chain.push(titles.get(cur) ?? '')
    cur = parents.get(cur)
  }
  if (chain.length === 0) return ''
  const shown = chain.slice(0, CRUMB_DEPTH).reverse()
  return (chain.length > CRUMB_DEPTH ? '… › ' : '') + shown.join(' › ')
}

/**
 * The phone view of a project: the same board, minus the graph. Every node
 * awaiting a person becomes one full-screen card, in the graph's own reading
 * order, and you swipe (or tap Previous/Next) between them. Tapping a card
 * opens the normal node page, which is where all the actual work happens — this
 * page only replaces the graph as the way IN.
 *
 * Deliberately not a React Flow board at 1/10th scale: the graph mounts a card
 * per node plus an SVG edge layer and re-lays-out the whole board on every
 * refetch, which is what makes it unusable on a phone. Here the view is one
 * horizontal scroller with CSS scroll-snap — native momentum, no transform
 * bookkeeping, no JS touch handling.
 */
export function QueuePage() {
  const { projectId } = useParams<{ projectId: string }>()
  const navigate = useNavigate()
  const { project, nodes, edges, error, loaded } = useProjectGraph(projectId)
  const [showNewNode, setShowNewNode] = useState(false)
  const [index, setIndex] = useState(0)
  const deckRef = useRef<HTMLDivElement>(null)
  const settleTimer = useRef<number | undefined>(undefined)
  const [searchParams, setSearchParams] = useSearchParams()

  // The card we last settled on, by node id. This — not the index — is what
  // survives a refetch: when the deck rebuilds we come back to this node, or to
  // the top of the queue if it has left (you cleared it, or an agent took it).
  // Seeded from the URL once, so a reload mid-queue lands where you were.
  const anchorRef = useRef<string | null>(searchParams.get('card'))

  const { queue, crumbs, withAgents } = useMemo(() => {
    const invalid = effectivelyInvalidated(nodes, edges)
    const q = humanQueue(nodes, edges, invalid)
    const parents = primaryParents(nodes, edges)
    const titles = new Map(nodes.map((n) => [n.id, n.title]))
    return {
      queue: q,
      crumbs: new Map(q.map((n) => [n.id, crumbFor(n.id, parents, titles)])),
      // Empty state only: "nothing for you" reads very differently when twenty
      // nodes are moving than when the board is asleep.
      withAgents: nodes.filter(
        (n) => STATUS_META[n.status].turn === 'agent' && !invalid.has(n.id),
      ).length,
    }
  }, [nodes, edges])

  // Slides are equal width in a symmetrically padded scroller, so the scroll
  // offset of card i is exactly i * slideWidth — see .queue-deck in styles.css,
  // whose left and right padding MUST stay equal for this to hold.
  const scrollToIndex = useCallback((i: number, behavior: ScrollBehavior) => {
    const deck = deckRef.current
    const first = deck?.firstElementChild as HTMLElement | null
    if (!deck || !first || first.clientWidth === 0) return
    deck.scrollTo({ left: i * first.clientWidth, behavior })
  }, [])

  // Deck membership and order, as a value that only changes when they really
  // change — a refetch returning the same queue must not re-scroll you.
  const queueKey = queue.map((n) => n.id).join(',')
  useLayoutEffect(() => {
    const found = queue.findIndex((n) => n.id === anchorRef.current)
    // Anchored card still queued: stay on it, wherever it moved to. Gone: back
    // to the top of the queue, not to whatever slid into its place.
    const next = found >= 0 ? found : 0
    anchorRef.current = queue[next]?.id ?? null
    setIndex(next)
    scrollToIndex(next, 'auto')
    // queueKey is the deck identity; `queue` itself is a fresh array each pass.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queueKey, scrollToIndex])

  useEffect(() => () => window.clearTimeout(settleTimer.current), [])

  const onScroll = () => {
    const deck = deckRef.current
    const first = deck?.firstElementChild as HTMLElement | null
    if (!deck || !first || first.clientWidth === 0 || queue.length === 0) return
    const i = Math.min(queue.length - 1, Math.max(0, Math.round(deck.scrollLeft / first.clientWidth)))
    setIndex((prev) => (prev === i ? prev : i))
    window.clearTimeout(settleTimer.current)
    settleTimer.current = window.setTimeout(() => {
      const id = queue[i]?.id
      if (!id || id === anchorRef.current) return
      anchorRef.current = id
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev)
          next.set('card', id)
          return next
        },
        { replace: true },
      )
    }, SETTLE_MS)
  }

  if (!projectId) return null

  return (
    <div className="queue-page">
      <div className="graph-toolbar queue-toolbar">
        <Link to="/" className="btn-small">
          ← Projects
        </Link>
        <h1>{project?.name ?? '…'}</h1>
        {/* Opt-in only. Nothing here loads React Flow until this is tapped. */}
        <Link to={`/p/${projectId}?view=graph`} className="btn-small">
          Graph
        </Link>
        <button className="btn-approve" onClick={() => setShowNewNode(true)}>
          + New node
        </button>
        <SearchBox projectId={projectId} />
      </div>
      {error ? <div className="form-error">{error}</div> : null}
      {!loaded ? (
        <div className="queue-empty">Loading…</div>
      ) : queue.length === 0 ? (
        <div className="queue-empty">
          <strong>Nothing needs you right now.</strong>
          <span>
            {withAgents > 0
              ? `${withAgents} node${withAgents === 1 ? ' is' : 's are'} with agents.`
              : 'No agent-turn work either — the board is idle.'}
          </span>
        </div>
      ) : (
        <>
          <div className="queue-status">
            <span className="queue-count">
              {index + 1} / {queue.length}
            </span>
            <span className="queue-track">
              <span
                className="queue-track-fill"
                style={{ width: `${((index + 1) / queue.length) * 100}%` }}
              />
            </span>
            <span>awaiting you</span>
          </div>
          <div className="queue-deck" ref={deckRef} onScroll={onScroll}>
            {queue.map((n) => (
              <QueueCard key={n.id} node={n} crumb={crumbs.get(n.id) ?? ''} />
            ))}
          </div>
          <div className="queue-nav">
            <button disabled={index === 0} onClick={() => scrollToIndex(index - 1, 'smooth')}>
              ← Previous
            </button>
            <button
              disabled={index >= queue.length - 1}
              onClick={() => scrollToIndex(index + 1, 'smooth')}
            >
              Next →
            </button>
          </div>
        </>
      )}
      {showNewNode ? (
        <NewNodeDialog
          projectId={projectId}
          onClose={() => setShowNewNode(false)}
          onCreated={(node) => navigate(`/n/${node.id}`)}
        />
      ) : null}
    </div>
  )
}

/** One queued node, styled by the same rules as its graph card (statusMeta's
 * cardTreatment) so a status reads identically on both views. Everything in the
 * queue is human- or github-turn, so every card here is a bright one. */
function QueueCard({ node, crumb }: { node: GraphNode; crumb: string }) {
  const meta = STATUS_META[node.status]
  const treat = cardTreatment(node.status)
  return (
    <div className="queue-slide">
      <Link
        to={`/n/${node.id}`}
        className="queue-card"
        style={{
          background: treat.background,
          borderColor: treat.borderColor,
          color: treat.text,
        }}
      >
        {crumb ? <div className="queue-crumb">{crumb}</div> : null}
        <div className="queue-title">
          {node.is_vision ? <span className="queue-vision">★ </span> : null}
          {node.title}
        </div>
        <div className="queue-card-foot">
          <span
            className="queue-pill"
            style={{ background: treat.pillBackground, color: treat.pillText }}
          >
            {meta.label}
          </span>
          <span className="queue-turn">{TURN_LABEL[meta.turn]}</span>
          <span className="queue-open">Open →</span>
        </div>
      </Link>
    </div>
  )
}
