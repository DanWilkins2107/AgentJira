import { EDGE_STYLE, STATUS_META, statusRgba } from '../lib/statusMeta'
import { EDGE_TYPES, NODE_STATUSES } from '../lib/types'

/** Always-visible legend: status colors + edge styles. */
export function Legend() {
  return (
    <div className="legend">
      <div className="legend-title">Statuses</div>
      <div className="legend-note">Brighter = human needed</div>
      {NODE_STATUSES.map((s) => (
        <div key={s} className="legend-row">
          <span className="legend-swatch" style={{ backgroundColor: statusRgba(s) }} />
          <span className="legend-label">
            {STATUS_META[s].label}
            <span className="legend-turn"> · {STATUS_META[s].turn}</span>
          </span>
        </div>
      ))}
      <div className="legend-title" style={{ marginTop: 8 }}>
        Edges
      </div>
      {EDGE_TYPES.map((t) => {
        const style = EDGE_STYLE[t]
        return (
          <div key={t} className="legend-row">
            <svg width="28" height="8" className="legend-edge-sample">
              <line
                x1="0"
                y1="4"
                x2="28"
                y2="4"
                stroke={style.stroke}
                strokeWidth="2.5"
                strokeDasharray={style.dash}
              />
            </svg>
            <span className="legend-label">{style.label}</span>
          </div>
        )
      })}
      <div className="legend-row">
        <span className="legend-swatch legend-swatch-stale" />
        <span className="legend-label">stale (ancestor invalidated)</span>
      </div>
      <div className="legend-row">
        <span className="legend-swatch-claimed" />
        <span className="legend-label">claimed by an agent</span>
      </div>
    </div>
  )
}
