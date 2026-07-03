import { STATUS_META, statusRgba } from '../lib/statusMeta'
import type { NodeStatus } from '../lib/types'

export function StatusPill({ status }: { status: NodeStatus }) {
  const meta = STATUS_META[status]
  return (
    <span
      className="status-pill"
      style={{
        backgroundColor: statusRgba(status, 0.18),
        border: `1.5px solid ${statusRgba(status)}`,
        color: 'inherit',
      }}
      title={`${status} — ${meta.turn === 'none' ? 'settled' : `${meta.turn}'s turn`}`}
    >
      <span className="status-pill-dot" style={{ backgroundColor: statusRgba(status) }} />
      {meta.label}
    </span>
  )
}
