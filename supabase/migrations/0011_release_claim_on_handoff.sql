-- AgentJira — a claim is released automatically when the turn leaves the agent.
--
-- Design gap being closed: `claimed_by`/`claimed_at` were deliberately kept
-- orthogonal to `status` (docs/architecture.md: "Separate from status"), and so
-- NOTHING ever cleared a claim. Every status-writing path (aj set-status,
-- submit-spec, propose-split, post --type question, link-pr, resubmit, and the
-- github-sync merge handler) writes `status` alone and leaves the claim behind.
-- The only releases were manual: `aj unclaim`, the web Unclaim button, or
-- `aj claim --force` to steal.
--
-- That made correctness depend on an agent remembering to unclaim — a
-- prompt-level instruction (agentjira-workflow/SKILL.md: "Unclaim when
-- stopping"). An agent that exhausts its context, crashes, or simply forgets
-- strands the claim forever, and `aj tasks` then hides the node from every
-- other agent until a human clears it. Worse, the default claim label is
-- `hostname:pid` — once the session exits, that PID is dead and the label is
-- actively misleading about who holds the node.
--
-- The fix belongs in the database, not the CLI: github-sync writes status
-- directly via supabase-js on PR merge, so a CLI-side release would miss the
-- single most common handoff in the system.
--
-- Rule: when `status` transitions to a status whose turn owner is NOT the
-- agent, the claim is cleared. Agent-turn statuses keep the claim, so an agent
-- moving through its own stages (awaiting_agent_spec -> ... ) holds the node.
--
-- Turn owners are defined in docs/architecture.md's status table:
--
--   agent turn (claim SURVIVES)   human_braindump_needed is NOT one of these
--     awaiting_agent_breakdown, split_approved, awaiting_agent_spec,
--     ready_for_pickup, evaluating_soft_block, pr_changes_requested
--
--   not the agent's turn (claim RELEASED)
--     human   human_braindump_needed, awaiting_human_response,
--             split_proposed, spec_review
--     github  pr_raised
--     none    broken_down, done, invalidated
--
-- `pr_raised` releases: the turn belongs to GitHub review, which runs for hours
-- or days, long after the claiming session's PID has exited. If the PR bounces
-- back to `pr_changes_requested`, an agent re-claims it fresh.

-- Turn owner of a status. Kept as its own function so the mapping lives in one
-- place and callers/tests can read it back; mirrors the docs table exactly.
create or replace function public.status_turn_owner(p_status public.node_status)
returns text
language sql
immutable
as $$
  select case p_status
    when 'awaiting_agent_breakdown' then 'agent'
    when 'split_approved'           then 'agent'
    when 'awaiting_agent_spec'      then 'agent'
    when 'ready_for_pickup'         then 'agent'
    when 'evaluating_soft_block'    then 'agent'
    when 'pr_changes_requested'     then 'agent'
    when 'human_braindump_needed'   then 'human'
    when 'awaiting_human_response'  then 'human'
    when 'split_proposed'           then 'human'
    when 'spec_review'              then 'human'
    when 'pr_raised'                then 'github'
    when 'broken_down'              then 'none'
    when 'done'                     then 'none'
    when 'invalidated'              then 'none'
  end;
$$;

create or replace function public.release_claim_on_handoff()
returns trigger
language plpgsql
as $$
begin
  -- Only on a real status transition, and only when the caller is not itself
  -- setting the claim in this same UPDATE. An explicit claim/unclaim written
  -- alongside a status change is the caller's intent and always wins.
  if new.status is distinct from old.status
     and new.claimed_by is not distinct from old.claimed_by
     and new.claimed_by is not null
     and public.status_turn_owner(new.status) <> 'agent'
  then
    new.claimed_by := null;
    new.claimed_at := null;
  end if;

  return new;
end;
$$;

-- BEFORE UPDATE, so the nulled claim is part of the row the AFTER trigger
-- nodes_log_update sees — that trigger then emits the usual node.unclaimed
-- event (with was_claimed_by) for free, alongside node.status_changed.
create trigger nodes_release_claim_on_handoff
  before update of status on public.nodes
  for each row execute function public.release_claim_on_handoff();

grant execute on function public.status_turn_owner(public.node_status) to authenticated, service_role;

-- Backfill: clear claims already stranded on non-agent-turn statuses. Goes
-- through UPDATE (not a direct column write) so nodes_log_update emits a
-- node.unclaimed event for each one — history stays complete.
update public.nodes
   set claimed_by = null,
       claimed_at = null
 where claimed_by is not null
   and public.status_turn_owner(status) <> 'agent';
