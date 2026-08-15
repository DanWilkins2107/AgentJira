// Contract enums — exact strings from docs/architecture.md. Never invent variants.

export const NODE_STATUSES = [
  'human_braindump_needed',
  'awaiting_agent_breakdown',
  'awaiting_human_response',
  'split_proposed',
  'split_approved',
  'broken_down',
  'awaiting_agent_spec',
  'spec_review',
  'ready_for_pickup',
  'human_only_action',
  'evaluating_soft_block',
  'pr_raised',
  'pr_changes_requested',
  'pr_base_moved',
  'done',
  'invalidated',
] as const;
export type NodeStatus = (typeof NODE_STATUSES)[number];

/** Statuses where it is the agent's turn to act. `human_only_action` is
 * deliberately absent: that node is work only a person can do, so it must never
 * be offered to an agent by `aj tasks`. */
export const AGENT_TURN_STATUSES: readonly NodeStatus[] = [
  'awaiting_agent_breakdown',
  'split_approved',
  'awaiting_agent_spec',
  'ready_for_pickup',
  'evaluating_soft_block',
  'pr_changes_requested',
  'pr_base_moved',
];

export const EDGE_TYPES = [
  'subtask',
  'firm_block',
  'firm_block_plan',
  'soft_block',
  'soft_block_plan',
  'reassess_after',
  'relates_to',
] as const;
export type EdgeType = (typeof EDGE_TYPES)[number];

export const MESSAGE_TYPES = [
  'note',
  'question',
  'answer',
  'split_proposal',
  'split_decision',
  'spec_submission',
  'review_comment',
  'system',
] as const;
export type MessageType = (typeof MESSAGE_TYPES)[number];

export type AuthorRole = 'human' | 'agent' | 'system';

// Row shapes (JSON boundary with PostgREST).

export interface ProjectRow {
  id: string;
  name: string;
  repo_owner: string | null;
  repo_name: string | null;
  created_at: string;
}

export interface NodeRow {
  id: string;
  project_id: string;
  title: string;
  body: string;
  status: NodeStatus;
  is_vision: boolean;
  spec: string | null;
  pr_url: string | null;
  pr_number: number | null;
  merge_sha: string | null;
  breakdown_on_merge: boolean;
  invalidation_reason: string | null;
  claimed_by: string | null;
  claimed_at: string | null;
  canvas_png_path: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface EdgeRow {
  id: string;
  project_id: string;
  source_id: string;
  target_id: string;
  type: EdgeType;
  removed_at: string | null;
  created_by: string;
  created_at: string;
}

export interface MessageRow {
  id: string;
  node_id: string;
  project_id: string;
  stage: NodeStatus;
  author_role: AuthorRole;
  author_id: string | null;
  type: MessageType;
  body: string;
  created_at: string;
}
