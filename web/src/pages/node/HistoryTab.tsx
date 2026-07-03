import type { EventRow } from '../../lib/types'

/** Events timeline: actor role, type, readable data summary, timestamp. */
export function HistoryTab({ events }: { events: EventRow[] }) {
  return (
    <div className="card history-tab">
      <h3>History</h3>
      {events.length === 0 ? <p className="muted">No events.</p> : null}
      {events.map((ev) => (
        <div key={ev.id} className="event-row">
          <span className={`role-badge role-${ev.actor_role}`}>{ev.actor_role}</span>
          <span className="event-type">{ev.type}</span>
          <span className="event-data">{summarize(ev)}</span>
          <span className="muted event-time">{new Date(ev.created_at).toLocaleString()}</span>
        </div>
      ))}
    </div>
  )
}

function summarize(ev: EventRow): string {
  const d = ev.data
  if (ev.type === 'node.status_changed' && typeof d.from === 'string' && typeof d.to === 'string') {
    return `${d.from} → ${d.to}`
  }
  const parts: string[] = []
  for (const [k, v] of Object.entries(d)) {
    if (v === null || v === undefined) continue
    const val = typeof v === 'object' ? JSON.stringify(v) : String(v)
    parts.push(`${k}: ${val.length > 80 ? `${val.slice(0, 80)}…` : val}`)
    if (parts.length >= 4) break
  }
  return parts.join(' · ')
}
