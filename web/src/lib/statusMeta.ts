// Single source for status colors, turn semantics, and edge styles.
// Mirrors the status color table in docs/architecture.md exactly.
// Rule: brighter colors = human intervention needed.

import type { EdgeType, NodeStatus } from './types'

export type Turn = 'human' | 'agent' | 'github' | 'none'

export interface StatusMeta {
  color: string // base hex
  alpha: number // opacity the contract prescribes for this color (1 unless noted)
  turn: Turn
  label: string
}

export const STATUS_META: Record<NodeStatus, StatusMeta> = {
  human_braindump_needed: { color: '#e91e63', alpha: 1, turn: 'human', label: 'Braindump needed' },
  awaiting_human_response: { color: '#ff9800', alpha: 1, turn: 'human', label: 'Awaiting human response' },
  split_proposed: { color: '#ffc107', alpha: 1, turn: 'human', label: 'Split proposed' },
  spec_review: { color: '#cddc39', alpha: 1, turn: 'human', label: 'Spec review' },
  awaiting_agent_breakdown: { color: '#5c7cfa', alpha: 1, turn: 'agent', label: 'Awaiting agent breakdown' },
  split_approved: { color: '#4263eb', alpha: 1, turn: 'agent', label: 'Split approved' },
  awaiting_agent_spec: { color: '#22b8cf', alpha: 1, turn: 'agent', label: 'Awaiting agent spec' },
  ready_for_pickup: { color: '#12b886', alpha: 1, turn: 'agent', label: 'Ready for pickup' },
  pr_raised: { color: '#9775fa', alpha: 1, turn: 'github', label: 'PR raised' },
  broken_down: { color: '#748ffc', alpha: 0.5, turn: 'none', label: 'Broken down' },
  done: { color: '#40c057', alpha: 0.7, turn: 'none', label: 'Done' },
  invalidated: { color: '#868e96', alpha: 1, turn: 'none', label: 'Invalidated' },
}

export const TURN_LABEL: Record<Turn, string> = {
  human: 'Your turn (human)',
  agent: "Agent's turn",
  github: 'With GitHub (PR review gate)',
  none: 'No one — settled',
}

/** rgba() string for a status color, multiplying in its prescribed alpha. */
export function statusRgba(status: NodeStatus, alpha = 1): string {
  const meta = STATUS_META[status]
  const hex = meta.color.replace('#', '')
  const r = parseInt(hex.slice(0, 2), 16)
  const g = parseInt(hex.slice(2, 4), 16)
  const b = parseInt(hex.slice(4, 6), 16)
  return `rgba(${r}, ${g}, ${b}, ${meta.alpha * alpha})`
}

export const STALE_RING = '#f59f00' // dashed 3px amber ring when stale=true

export interface EdgeStyleMeta {
  stroke: string
  dash?: string // SVG stroke-dasharray; undefined = solid
  label: string
}

export const EDGE_STYLE: Record<EdgeType, EdgeStyleMeta> = {
  subtask: { stroke: '#909296', label: 'subtask (parent → child)' },
  firm_block: { stroke: '#e03131', label: 'firm block' },
  soft_block: { stroke: '#f59f00', dash: '8 5', label: 'soft block' },
  relates_to: { stroke: '#adb5bd', dash: '2 5', label: 'relates to' },
}
