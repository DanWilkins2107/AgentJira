// Hand-written mirror of the schema in docs/architecture.md.
// Exact enum strings — never invent variants.

export type NodeStatus =
  | 'human_braindump_needed'
  | 'awaiting_agent_breakdown'
  | 'awaiting_human_response'
  | 'split_proposed'
  | 'split_approved'
  | 'broken_down'
  | 'awaiting_agent_spec'
  | 'spec_review'
  | 'ready_for_pickup'
  | 'evaluating_soft_block'
  | 'pr_raised'
  | 'pr_changes_requested'
  | 'done'
  | 'invalidated'

export const NODE_STATUSES: NodeStatus[] = [
  'human_braindump_needed',
  'awaiting_agent_breakdown',
  'awaiting_human_response',
  'split_proposed',
  'split_approved',
  'broken_down',
  'awaiting_agent_spec',
  'spec_review',
  'ready_for_pickup',
  'evaluating_soft_block',
  'pr_raised',
  'pr_changes_requested',
  'done',
  'invalidated',
]

export type EdgeType =
  | 'subtask'
  | 'firm_block'
  | 'firm_block_plan'
  | 'soft_block'
  | 'soft_block_plan'
  | 'reassess_after'
  | 'relates_to'

export const EDGE_TYPES: EdgeType[] = [
  'subtask',
  'firm_block',
  'firm_block_plan',
  'soft_block',
  'soft_block_plan',
  'reassess_after',
  'relates_to',
]

export type MessageType =
  | 'note'
  | 'question'
  | 'answer'
  | 'split_proposal'
  | 'split_decision'
  | 'spec_submission'
  | 'review_comment'
  | 'system'

export const MESSAGE_TYPES: MessageType[] = [
  'note',
  'question',
  'answer',
  'split_proposal',
  'split_decision',
  'spec_submission',
  'review_comment',
  'system',
]

export type AuthorRole = 'human' | 'agent' | 'system'

export interface Project {
  id: string
  name: string
  repo_owner: string | null
  repo_name: string | null
  webhook_secret: string
  created_by: string
  created_at: string
  // Soft-archive: null = active, timestamp = archived (reversible, owner-only).
  archived_at: string | null
}

export interface ProjectMember {
  project_id: string
  user_id: string
  role: 'owner' | 'agent'
}

export interface TaskNode {
  id: string
  project_id: string
  title: string
  body: string
  status: NodeStatus
  is_vision: boolean
  spec: string | null
  pr_url: string | null
  pr_number: number | null
  merge_sha: string | null
  // Plan-deliverable: pr_merged routes back to awaiting_agent_breakdown, not done.
  breakdown_on_merge: boolean
  invalidation_reason: string | null
  claimed_by: string | null
  claimed_at: string | null
  tldraw_doc: unknown | null
  canvas_png_path: string | null
  created_by: string
  created_at: string
  updated_at: string
}

export interface NodeEdge {
  id: string
  project_id: string
  source_id: string
  target_id: string
  type: EdgeType
  removed_at: string | null
  created_by: string
  created_at: string
}

export interface Message {
  id: string
  node_id: string
  project_id: string
  stage: NodeStatus
  author_role: AuthorRole
  author_id: string | null
  type: MessageType
  body: string
  created_at: string
}

export interface EventRow {
  id: number
  project_id: string
  node_id: string | null
  actor_id: string | null
  actor_role: AuthorRole
  type: string
  data: Record<string, unknown>
  created_at: string
}

// search_all RPC row
export interface SearchResult {
  kind: 'node' | 'message'
  node_id: string
  title: string
  snippet: string
  rank: number
}

// node_context RPC shape. `stale` here is DERIVED server-side (an ancestor
// via non-removed subtask edges is currently invalidated) — it is not a
// nodes-table column. The JSON field name is part of the contract.
export interface AncestorInfo {
  id: string
  title: string
  status: NodeStatus
  stale: boolean
  invalidation_reason: string | null
  is_vision: boolean
  // Levels above this node: 1 = parent, increasing toward the vision node.
  depth: number
}

export type ContextNode = TaskNode & { stale: boolean }

export interface NodeContext {
  node: ContextNode
  edges: NodeEdge[]
  ancestors: AncestorInfo[]
  children: ContextNode[]
  blockers: ContextNode[]
}
