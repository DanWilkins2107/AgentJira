-- AgentJira — pr_base_moved: main moved under an open PR.
--
-- Nodes sit in `pr_raised` (github's turn) until a human reviews. Meanwhile
-- sibling PRs merge, so the base drifts: by approval time the branch is behind,
-- often conflicting, and — worse than conflicting — sometimes silently wrong
-- because main renamed something the branch calls, or already did the work.
-- Textual mergeability does not mean the change is still correct.
--
-- So a merge to main hands every other open PR back to an agent, which reads
-- what landed, merges main in, and decides whether the branch still holds up.
-- Exit is `aj resubmit` -> `pr_raised`, the same explicit round-trip as
-- pr_changes_requested — a push alone never flips the turn back.
--
-- Off-rail side loop, like pr_changes_requested and evaluating_soft_block: it
-- can interrupt the pipeline at pr_raised without being a step in it.
--
-- Postgres note: ALTER TYPE ... ADD VALUE is transaction-safe on PG12+ so long
-- as the new label is not *used* (cast/compared) in the same transaction. The
-- status_turn_owner rewrite below therefore compares `p_status::text` against
-- text literals instead of letting them resolve to node_status. Do NOT "tidy"
-- that cast away — without it this migration fails to apply.

alter type public.node_status add value if not exists 'pr_base_moved' after 'pr_changes_requested';

-- Turn owner of a status (see 0011, 0012). Unchanged except that pr_base_moved
-- joins the agent turn; the ::text cast is a migration-safety requirement, not
-- a style choice — see the note above.
create or replace function public.status_turn_owner(p_status public.node_status)
returns text
language sql
immutable
as $$
  select case p_status::text
    when 'awaiting_agent_breakdown' then 'agent'
    when 'split_approved'           then 'agent'
    when 'awaiting_agent_spec'      then 'agent'
    when 'ready_for_pickup'         then 'agent'
    when 'evaluating_soft_block'    then 'agent'
    when 'pr_changes_requested'     then 'agent'
    when 'pr_base_moved'            then 'agent'
    when 'human_braindump_needed'   then 'human'
    when 'awaiting_human_response'  then 'human'
    when 'split_proposed'           then 'human'
    when 'spec_review'              then 'human'
    when 'human_only_action'        then 'human'
    when 'pr_raised'                then 'github'
    when 'broken_down'              then 'none'
    when 'done'                     then 'none'
    when 'invalidated'              then 'none'
  end;
$$;

grant execute on function public.status_turn_owner(public.node_status) to authenticated, service_role;
