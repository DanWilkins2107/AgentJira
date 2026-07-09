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

/** Amber for the solid "STALE" corner badge (stale = derived: an ancestor is
 * currently invalidated — never persisted). */
export const STALE_BADGE = '#f59f00'

/**
 * Subtle green ring for cards an agent could pick up right now (see
 * lib/pickup.ts) — the parallelization frontier. Uses the ready_for_pickup
 * green (#12b886) as the semantic "go" color regardless of the node's own
 * agent-turn status. A crisp inner ring plus a soft outer glow, kept low-alpha
 * so it reads as an accent, not an alarm. */
export const READY_RING =
  '0 0 0 2px rgba(18, 184, 134, 0.6), 0 0 12px 2px rgba(18, 184, 134, 0.25)'

const DARK_CARD_BG = '#1f2226'
const DARK_MUTED_CARD_BG = '#232529'
const DARK_TEXT = '#1a1b1e'
const LIGHT_TEXT = '#f1f3f5'

/**
 * How a graph card (and its legend swatch) renders a status. Encodes the
 * turn split by brightness: human-turn = light/bright status-colored card;
 * agent-turn = dark card with the status color as border + left accent bar;
 * github/none = dark and muted; invalidated = gray, heavily dimmed.
 */
export interface CardTreatment {
  background: string
  borderColor: string
  text: string
  /** Left accent bar color (dark cards only). */
  accentBar?: string
  /** Outer glow (light human-turn cards only). */
  glow?: string
  /** Whole-card opacity for heavily dimmed states (invalidated). */
  dim?: number
  pillBackground: string
  pillText: string
}

/**
 * Card treatment for a status. Pass `stale` when the node's own status isn't
 * `invalidated` but an ancestor's currently is — the node renders with the
 * invalidated treatment (derived, never persisted; it springs back when the
 * ancestor is restored).
 */
export function cardTreatment(status: NodeStatus, stale = false): CardTreatment {
  if (status === 'invalidated' || stale) {
    return {
      background: DARK_MUTED_CARD_BG,
      borderColor: statusRgba('invalidated', 0.6),
      text: '#8d939a',
      dim: 0.55,
      pillBackground: statusRgba('invalidated', 0.35),
      pillText: '#ced4da',
    }
  }
  const turn = STATUS_META[status].turn
  if (turn === 'human') {
    // Light/bright: near-solid status background, dark text, subtle glow.
    return {
      background: statusRgba(status, 0.88),
      borderColor: statusRgba(status),
      text: DARK_TEXT,
      glow: `0 0 12px 2px ${statusRgba(status, 0.45)}`,
      pillBackground: 'rgba(26, 27, 30, 0.82)',
      pillText: statusRgba(status),
    }
  }
  if (turn === 'agent') {
    // Dark: neutral dark background, status color as border + accent bar.
    return {
      background: DARK_CARD_BG,
      borderColor: statusRgba(status),
      text: LIGHT_TEXT,
      accentBar: statusRgba(status),
      pillBackground: statusRgba(status),
      pillText: '#fff',
    }
  }
  // github / none: dark and muted; done/broken_down keep their contract
  // alphas (via statusRgba), which visibly fades their border and pill.
  return {
    background: DARK_MUTED_CARD_BG,
    borderColor: statusRgba(status, 0.75),
    text: '#c4c9ce',
    pillBackground: statusRgba(status, 0.85),
    pillText: '#fff',
  }
}

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
