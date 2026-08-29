---
name: aj-pickup
description: Procedure for picking up AgentJira work. As orchestrator you do NO board work yourself — you list tasks, choose sensibly, and dispatch one subagent per node; each subagent claims, loads context, and does the stage-appropriate work. Use when asked to "pick up a task", "find something to work on", or start an AgentJira session without a specific node named.
---

# Picking up AgentJira work

Follow the `agentjira-workflow` rulebook throughout.

## You are the orchestrator — delegate every node, do none of the board work yourself

A general "pick up AgentJira work" request (no specific node named) makes you an **orchestrator**. Your entire job is to find candidate nodes and hand each to a **subagent** that does the actual work. You **never** claim, load context, break down, spec, implement, or raise a PR yourself — if you catch yourself running `aj claim` / `aj context` or editing repo files, stop: that's a subagent's job. Listing, choosing, and dispatching is all you do.

**Pick up everything you can, in parallel.** Default is one subagent per actionable node, all dispatched at once — not one node at a time. Don't cherry-pick a single "best" task and leave the rest sitting; if six nodes are actionable, spawn six subagents. Only leave a node alone when it's genuinely not pickable (see step 2). Then keep watching the board (step 4) and dispatch again as work appears.

> **Already handed one specific node?** If you were dispatched to a single node id — by an orchestrator or by the human directly — you *are* the subagent: skip the orchestrator steps, go straight to **Working a node** below, do it directly, and never spawn a further subagent.
>
> Before you write anything to the board, invoke **`agentjira-workflow`** and the **`aj-stage-notes-<status>`** skill for the node's status. Being handed a node id is not a shortcut past them: the rulebook is what stops you faking a human's turn, and the stage notes carry this project's length budget for whatever you're about to write. Both are cheap; neither is optional.

## Orchestrator — step 1: list available work

```
aj tasks [-p <project>]
```

Lists nodes in the agent-turn statuses (`awaiting_agent_breakdown`, `split_approved`, `awaiting_agent_spec`, `ready_for_pickup`, `evaluating_soft_block`, `pr_changes_requested`, `pr_base_moved`), annotated with claims and block-family blockers (firm/soft, their `_plan` variants, `reassess_after`) with their statuses. **Stale** nodes — an ancestor is currently `invalidated` (derived, never stored) — do not appear at all: they are dead until the ancestor is restored, and reappear automatically when it is.

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
- a reminder that it must do the work **directly** — not spawn any further subagent — and must `aj unclaim` if it stops unfinished *without* a status change;
- the instruction to finish with **one line** — node id, what stage it reached, and anything genuinely blocked. No summary of the work; the board carries that;
- the instruction to invoke **`agentjira-workflow`** and its **`aj-stage-notes-<status>`** skill before writing anything to the board. Name them in the dispatch; a subagent that never loads them writes to no budget at all, and long is the default failure.

Never point two subagents at the same node. If `aj tasks` showed no agent-turn work, don't invent work or do it yourself — go to step 4 and wait for the board to change.

**Every dispatch is a fresh subagent — never reuse one.** A node that comes back to your queue is a new dispatch: a rejected spec returning to `awaiting_agent_spec`, a `pr_changes_requested` or `pr_base_moved` round-trip, a re-judged `evaluating_soft_block`. Spawn a **new** subagent for it. Do not resume the agent that worked it before, and do not keep one alive waiting for the human's decision — a subagent's job ends when it hands the turn over.

The old agent is carrying its entire first pass in context, and almost none of that is what the revision needs. The review comment says what to change, and `aj context` reprints the node, its spec, and the full thread — so a fresh agent reads the board's *current* state cheaply, where a resumed one is remembering a stale version of it at the cost of everything it did to get there.

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

When it fires: re-run `aj tasks`, apply step 2's judgment, and dispatch subagents for whatever is now pickable.

**Never stop the monitor yourself.** An empty board is not a reason to shut down — it just means the human's turn is in progress and agent-turn work will reappear. Leave the monitor armed indefinitely and keep dispatching as nodes become actionable; only the human ends the session, by stopping the monitor or telling you to.

## Orchestrator — reporting

The human is not reading this conversation unless something goes wrong. Report in small checkpoints, not narratives:

- One short line when you dispatch (`dispatched 4: <ids>`), one short line when a node lands (`<id> — PR raised` / `<id> — split proposed`).
- No full descriptions of what was implemented, no restating specs, no per-node walkthroughs.
- Don't ask subagents for a summary of their work, and don't relay one. The board is the record — status changes and node threads say what happened.
- Speak up properly only when something needs the human: a blocker you can't clear, a failure, a judgment call.

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

First invoke the stage-notes skill for this node's current status — `aj-stage-notes-<status>`, with the status kebab-cased (`awaiting_agent_spec` → `aj-stage-notes-awaiting-agent-spec`). It loads this project's instructions for the stage, including the length budget for whatever you're about to write. Then:

| Status | What to do |
|---|---|
| `awaiting_agent_breakdown` | Follow the `aj-breakdown` skill: propose a split, or route to spec if PR-sized |
| `split_approved` | Follow the `aj-breakdown` skill: materialize the approved children |
| `awaiting_agent_spec` | Write a tiny, concise spec; `aj submit-spec <node> --file <path>`. If it plans out code, invoke `code-style-guide` and follow it |
| `ready_for_pickup` | Follow the `aj-implement` skill: implement and raise the PR |
| `pr_changes_requested` / `pr_base_moved` | Follow the `aj-implement` skill, final sections: address the review, or reconcile the branch with main |

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

## 6. Stop

Handing the turn over is the end of your job — not a pause in it. Report your one line to the orchestrator and stop. Don't wait around for the human to approve your spec or review your PR: whatever comes back is a fresh dispatch to a fresh subagent, and it will load what it needs from the board.
