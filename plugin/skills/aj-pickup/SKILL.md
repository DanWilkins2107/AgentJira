---
name: aj-pickup
description: Procedure for picking up AgentJira work. As orchestrator you do NO board work yourself — you list tasks, choose sensibly, and dispatch one subagent per node; each subagent claims, loads context, and does the stage-appropriate work. Use when asked to "pick up a task", "find something to work on", or start an AgentJira session without a specific node named.
---

# Picking up AgentJira work

Follow the `agentjira-workflow` rulebook throughout.

## You are the orchestrator — delegate every node, do none of the board work yourself

A general "pick up AgentJira work" request (no specific node named) makes you an **orchestrator**. Your entire job is to find candidate nodes and hand each to a **subagent** that does the actual work. You **never** claim, load context, break down, spec, implement, or raise a PR yourself — if you catch yourself running `aj claim` / `aj context` or editing repo files, stop: that's a subagent's job. Listing, choosing, and dispatching is all you do.

> **Already handed one specific node?** If an orchestrator dispatched you to a single node id, you *are* the subagent: skip the orchestrator steps, go straight to **Working a node** below, do it directly, and never spawn a further subagent.

## Orchestrator — step 1: list available work

```
aj tasks [-p <project>]
```

Lists nodes in the agent-turn statuses (`awaiting_agent_breakdown`, `split_approved`, `awaiting_agent_spec`, `ready_for_pickup`, `evaluating_soft_block`, `pr_changes_requested`), annotated with claims and block-family blockers (firm/soft, their `_plan` variants, `reassess_after`) with their statuses. **Stale** nodes — an ancestor is currently `invalidated` (derived, never stored) — do not appear at all: they are dead until the ancestor is restored, and reappear automatically when it is.

## Orchestrator — step 2: choose candidates

- Skip anything in the "not recommended" section (firm-blocked by unfinished work, deferred via `reassess_after`, or claimed by someone else).
- Pick soft-blocked work **only if nothing else is available** and it's not too much of a stretch (see the rulebook).
- A blocker annotated **PLAN LANDED** no longer gates: its decision/plan document has merged, and that's all this node needed from it (the edge was a `_plan` variant). It becomes required reading for whoever works the node.
- Prefer unblocked, unclaimed nodes. A blocker in `invalidated` status is a judgment signal, not a hard stop — read its invalidation reason before deciding.

## Orchestrator — step 3: dispatch one subagent per node

Spawn a subagent (Agent/Task tool) for each chosen node — issue them in parallel when there are several. Give each subagent:

- the **node id**, and the instruction to follow this `aj-pickup` skill's **Working a node** procedure for that one node;
- a reminder that it must do the work **directly** — not spawn any further subagent — and must `aj unclaim` if it stops unfinished *without* a status change.

Never point two subagents at the same node. When they report back, relay a short summary of what each did. If `aj tasks` showed no agent-turn work, say so and stop — don't invent work or do it yourself.

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
| `awaiting_agent_spec` | Write a tiny, concise spec; `aj submit-spec <node> --file <path>` |
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
