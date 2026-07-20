import { EDGE_STYLE, READY_RING, STATUS_META, cardTreatment } from '../lib/statusMeta'
import { EDGE_TYPES, NODE_STATUSES } from '../lib/types'
import type { NodeStatus } from '../lib/types'

/** Mini card swatch that teaches the light/dark turn treatment. */
function StatusSwatch({
  status,
  stale = false,
  ready = false,
}: {
  status: NodeStatus
  stale?: boolean
  ready?: boolean
}) {
  const treat = cardTreatment(status, stale)
  return (
    <span
      className="legend-swatch"
      style={{
        backgroundColor: treat.background,
        border: `1.5px solid ${treat.borderColor}`,
        borderLeft: treat.accentBar
          ? `4px solid ${treat.accentBar}`
          : `1.5px solid ${treat.borderColor}`,
        boxShadow: ready ? READY_RING : treat.glow,
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
        <StatusSwatch status="broken_down" stale />
        <span className="legend-stale-badge-sample">STALE</span>
        <span className="legend-label">stale (ancestor invalidated) — dead until restored</span>
      </div>
      <div className="legend-row">
        <StatusSwatch status="ready_for_pickup" ready />
        <span className="legend-label">green ring — an agent could pick this up now</span>
      </div>
      <div className="legend-row">
        <span className="legend-blocked-badge-sample">BLOCKED</span>
        <span className="legend-label">
          firm-blocked — waits until the blocker is done (or a broken-down parent's whole subtree
          completes)
        </span>
      </div>
      <div className="legend-row">
        <span className="legend-complete-badge-sample">✓ CLEAR</span>
        <span className="legend-label">
          broken-down container whose subtree is fully settled — its gates are cleared
        </span>
      </div>
      <div className="legend-row">
        <span className="legend-soft-badge-sample">soft-blocked</span>
        <span className="legend-label">
          shared decision still open upstream — pickable, but a stretch (advisory, not a gate)
        </span>
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
        <svg width="28" height="8" className="legend-edge-sample">
          <line
            x1="0"
            y1="4"
            x2="28"
            y2="4"
            stroke={EDGE_STYLE.firm_block.stroke}
            strokeWidth={2}
            strokeDasharray="4 4"
            opacity={0.55}
          />
        </svg>
        <span className="legend-label">
          coarse gate (via a broken-down parent) — fades when its subtree completes
        </span>
      </div>
      <div className="legend-row">
        <span className="legend-swatch-claimed" />
        <span className="legend-label">claimed by an agent</span>
      </div>
    </div>
  )
}
