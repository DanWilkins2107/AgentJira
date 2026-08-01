---
name: aj-pickup
description: Procedure for picking up AgentJira work. As orchestrator you do NO board work yourself — you list tasks, choose sensibly, and dispatch one subagent per node; each subagent claims, loads context, and does the stage-appropriate work. Use when asked to "pick up a task", "find something to work on", or start an AgentJira session without a specific node named.
---

# Picking up AgentJira work

Follow the `agentjira-workflow` rulebook throughout.

## You are the orchestrator — delegate every node, do none of the board work yourself

A general "pick up AgentJira work" request (no specific node named) makes you an **orchestrator**. Your entire job is to find candidate nodes and hand each to a **subagent** that does the actual work. You **never** claim, load context, break down, spec, implement, or raise a PR yourself — if you catch yourself running `aj claim` / `aj context` or editing repo files, stop: that's a subagent's job. Listing, choosing, and dispatching is all you do.

**Pick up everything you can, in parallel.** Default is one subagent per actionable node, all dispatched at once — not one node at a time. Don't cherry-pick a single "best" task and leave the rest sitting; if six nodes are actionable, spawn six subagents. Only leave a node alone when it's genuinely not pickable (see step 2). Then keep watching the board (step 4) and dispatch again as work appears.

> **Already handed one specific node?** If an orchestrator dispatched you to a single node id, you *are* the subagent: skip the orchestrator steps, go straight to **Working a node** below, do it directly, and never spawn a further subagent.

## Orchestrator — step 1: list available work

```
aj tasks [-p <project>]
```

Lists nodes in the agent-turn statuses (`awaiting_agent_breakdown`, `split_approved`, `awaiting_agent_spec`, `ready_for_pickup`, `evaluating_soft_block`, `pr_changes_requested`), annotated with claims and block-family blockers (firm/soft, their `_plan` variants, `reassess_after`) with their statuses. **Stale** nodes — an ancestor is currently `invalidated` (derived, never stored) — do not appear at all: they are dead until the ancestor is restored, and reappear automatically when it is.

Aj tasks is the source of truth. I may have picked up work and done reviews in the meantime, trust this over conversation history. 

## Orchestrator — step 2: choose candidates

- Skip anything in the "not recommended" section (firm-blocked by unfinished work, deferred via `reassess_after`, or claimed by someone else).
- A blocker annotated **PLAN LANDED** no longer gates: its decision/plan document has merged, and that's all this node needed from it (the edge was a `_plan` variant). It becomes required reading for whoever works the node.
- Prefer unblocked, unclaimed nodes. A blocker in `invalidated` status is a judgment signal, not a hard stop — read its invalidation reason before deciding.
- A blocker in `human_only_action` is waiting on the human and nothing else — you cannot clear it, work around it, or do it yourself. Leave the node and pick something else; the human's queue is theirs.

For soft-blocked work, try to evaluate whether it should have a hard block. Ideally we'll remove the soft block and either pick up the work or put a hard block on something else - give this task to a subagent also. 

## Orchestrator — step 3: dispatch one subagent per node

Spawn a subagent (Agent/Task tool) for each chosen node — issue them in parallel when there are several. Give each subagent:

- the **node id**, and the instruction to follow this `aj-pickup` skill's **Working a node** procedure for that one node;
- a reminder that it must do the work **directly** — not spawn any further subagent — and must `aj unclaim` if it stops unfinished *without* a status change.

Never point two subagents at the same node. When they report back, relay a short summary of what each did. If `aj tasks` showed no agent-turn work, say so and stop — don't invent work or do it yourself.

## Orchestrator — step 4: monitor the board

Subagents keep running for a while, and their status changes unblock other nodes. Arm a persistent Monitor right after dispatching so new agent-turn work reaches you instead of waiting for the next manual `aj tasks`:

```bash
prev=""
while true; do
  cur=$(aj tasks 2>/dev/null | awk '/^RECOMMENDED/{r=1;next} /^NOT RECOMMENDED/{r=0} r && /^  [^ ]/ && !/\(none\)/{print "NEW" $0}' | sort)
  [ -n "$prev" ] && comm -13 <(echo "$prev") <(echo "$cur")
  prev="$cur"
  sleep 60
done
```

Run it with `persistent: true` and a description like `AgentJira board — new actionable nodes`. First pass seeds the baseline silently; after that each line is a node that became actionable.

When it fires: re-run `aj tasks`, apply step 2's judgment, and dispatch subagents for whatever is now pickable. Keep doing this until the board has no agent-turn work left and no subagent is still running, then `TaskStop` the monitor and report.

---

# Working a node (subagent)

You've been handed one node. Claim it, load context, do the stage-appropriate work, hand the turn over. Do the work yourself — never delegate onward.

## 1. Claim it

```
aj claim <node>
```

If the claim is refused because someone else holds it, don't `--force` — report back to the orchestrator that the node is already taken and stop.

## 2. Load context

```
aj context <node>
```

Read everything it prints, and **Read the downloaded canvas PNG file paths** it lists (the node's and its ancestors'). Pay particular attention to invalidated/stale ancestors and their reasons.

## 3. Do the stage-appropriate work

First invoke the `aj-stage-notes` skill for this node's current status — it loads any project-specific instructions for this stage (usually none). Then:

| Status | What to do |
|---|---|
| `awaiting_agent_breakdown` | Follow the `aj-breakdown` skill: propose a split, or route to spec if PR-sized |
| `split_approved` | Follow the `aj-breakdown` skill: materialize the approved children |
| `awaiting_agent_spec` | Write a tiny, concise spec; `aj submit-spec <node> --file <path>`. If it plans out code, invoke `code-style-guide` and follow it |
| `ready_for_pickup` | Follow the `aj-implement` skill: implement and raise the PR |

If anything is ambiguous, ask early: `aj post <node> --type question --body "..."` (this hands the turn to the human, which releases your claim automatically) — then move on.

## 4. Post results and hand over

When your stage's work is done, the status change (via `aj propose-split`, `aj submit-spec`, `aj set-status`, or the PR/GHA) hands the turn over — and releases your claim with it. Post a short `note` if there's context worth recording:

```
aj post <node> --type note --body "..."
```

## 5. Unclaim if stopping unfinished

Handing the turn over releases the claim for you. The one case it doesn't cover is stopping mid-stage with the status unchanged — then run:

```
aj unclaim <node>
```

Never leave a claim dangling on work you're not actively doing.
