import { EDGE_STYLE, STATUS_META, cardTreatment } from '../lib/statusMeta'
import { EDGE_TYPES, NODE_STATUSES } from '../lib/types'
import type { NodeStatus } from '../lib/types'

/** Mini card swatch that teaches the light/dark turn treatment. */
function StatusSwatch({ status, inherited = false }: { status: NodeStatus; inherited?: boolean }) {
  const treat = cardTreatment(status, inherited)
  return (
    <span
      className="legend-swatch"
      style={{
        backgroundColor: treat.background,
        border: `1.5px solid ${treat.borderColor}`,
        borderLeft: treat.accentBar
          ? `4px solid ${treat.accentBar}`
          : `1.5px solid ${treat.borderColor}`,
        boxShadow: treat.glow,
        opacity: treat.dim,
      }}
    />
  )
}

/** Always-visible legend: status cards, edge styles, badges. */
export function Legend() {
  return (
    <div className="legend">
      <div className="legend-title">Statuses</div>
      <div className="legend-note">Light/bright card = your turn · dark card = agent's</div>
      {NODE_STATUSES.map((s) => (
        <div key={s} className="legend-row">
          <StatusSwatch status={s} />
          <span className="legend-label">
            {STATUS_META[s].label}
            <span className="legend-turn"> · {STATUS_META[s].turn}</span>
          </span>
        </div>
      ))}
      <div className="legend-row">
        <StatusSwatch status="broken_down" inherited />
        <span className="legend-label">invalidated (inherited from ancestor)</span>
      </div>
      <div className="legend-title" style={{ marginTop: 8 }}>
        Edges
      </div>
      {EDGE_TYPES.map((t) => {
        const style = EDGE_STYLE[t]
        const opacity = t === 'subtask' ? 0.55 : t === 'relates_to' ? 0.5 : 1
        return (
          <div key={t} className="legend-row">
            <svg width="28" height="8" className="legend-edge-sample">
              <line
                x1="0"
                y1="4"
                x2="28"
                y2="4"
                stroke={style.stroke}
                strokeWidth={t === 'subtask' ? 2 : 2.5}
                strokeDasharray={style.dash}
                opacity={opacity}
              />
            </svg>
            <span className="legend-label">{style.label}</span>
          </div>
        )
      })}
      <div className="legend-row">
        <span className="legend-stale-badge-sample">STALE</span>
        <span className="legend-label">stale (ancestor invalidated)</span>
      </div>
      <div className="legend-row">
        <span className="legend-swatch-claimed" />
        <span className="legend-label">claimed by an agent</span>
      </div>
    </div>
  )
}
