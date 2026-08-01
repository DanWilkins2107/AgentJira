-- AgentJira — human_only_action: work an agent structurally cannot do.
--
-- Some work is not blocked on judgment or information — it is blocked on being
-- a person. Creating an account, entering card details, clicking a button in a
-- third-party dashboard, plugging in hardware, signing something. No amount of
-- agent context unblocks it.
--
-- The rule is that such work is a WHOLE NODE, never a detour on an existing
-- one. An agent that discovers a human-only step does not park its own node
-- and wait for a hand-back; it splits the human-only part out as its own node
-- in `human_only_action` and, where the remaining work genuinely depends on it,
-- adds a block edge from the new node to the one it holds up. Ideally the split
-- happens earlier still — at breakdown or spec time, where these steps are
-- usually predictable — so the human's work is visible on the graph from the
-- start rather than surfacing when an agent runs into a wall.
--
-- That is why there is no return path in the state machine. A `human_only_action`
-- node is the human's from creation to completion: they do the thing and mark it
-- `done` (or `invalidated` if it turns out to be unnecessary). It never hands a
-- turn back to an agent, because the agent never held it. Any dependent work
-- resumes on its own node the moment the block is satisfied — the ordinary
-- firm_block rule, no new machinery.
--
-- Consequences that fall out of the existing model for free:
--   * turn = human, so `aj tasks` (agent-turn statuses only) never offers it to
--     an agent, and the claim-release trigger from 0011 drops any claim on a
--     node moved into it.
--   * bright card in the graph (brighter = human needed), and a firm_block from
--     one reads as UNFINISHED everywhere until the human marks it done — which
--     is exactly the truth.
--
-- Postgres note: ALTER TYPE ... ADD VALUE is transaction-safe on PG12+ so long
-- as the new label is not *used* (cast/compared) in the same transaction. The
-- status_turn_owner rewrite below therefore compares `p_status::text` against
-- text literals instead of letting them resolve to node_status. Do NOT "tidy"
-- that cast away — without it this migration fails to apply.

alter type public.node_status add value if not exists 'human_only_action' after 'ready_for_pickup';

-- Turn owner of a status (see 0011). Unchanged except that human_only_action
-- joins the human turn; the ::text cast is a migration-safety requirement, not
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
