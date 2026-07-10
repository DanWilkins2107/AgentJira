---
name: aj-pickup
description: Step-by-step procedure for picking up AgentJira work — list tasks, choose one sensibly, claim it, load context, do the stage-appropriate work. Use when asked to "pick up a task", "find something to work on", or start an AgentJira session without a specific node named.
---

# Picking up AgentJira work

Follow the `agentjira-workflow` rulebook throughout. The pickup procedure:

## 1. List available work

```
aj tasks [-p <project>]
```

Lists nodes in the agent-turn statuses (`awaiting_agent_breakdown`, `split_approved`, `awaiting_agent_spec`, `ready_for_pickup`, `evaluating_soft_block`, `pr_changes_requested`), annotated with claims and block-family blockers (firm/soft, their `_plan` variants, `reassess_after`) with their statuses. **Stale** nodes — an ancestor is currently `invalidated` (derived, never stored) — do not appear at all: they are dead until the ancestor is restored, and reappear automatically when it is.

## 2. Choose sensibly

- Skip anything in the "not recommended" section (firm-blocked by unfinished work, deferred via `reassess_after`, or claimed by someone else).
- Pick soft-blocked work **only if nothing else is available** and it's not too much of a stretch (see the rulebook).
- A blocker annotated **PLAN LANDED** no longer gates: its decision/plan document has merged, and that's all this node needed from it (the edge was a `_plan` variant). Treat the merged document as required reading when you work the node.
- Prefer unblocked, unclaimed nodes. A blocker in `invalidated` status is a judgment signal, not a hard stop — read its invalidation reason before deciding.

## 3. Claim it

```
aj claim <node>
```

If the claim is refused because someone else holds it, go back to step 2.

## 4. Load context

```
aj context <node>
```

Read everything it prints, and **Read the downloaded canvas PNG file paths** it lists (the node's and its ancestors'). Pay particular attention to invalidated/stale ancestors and their reasons.

## 5. Do the stage-appropriate work

| Status | What to do |
|---|---|
| `awaiting_agent_breakdown` | Follow the `aj-breakdown` skill: propose a split, or route to spec if PR-sized |
| `split_approved` | Follow the `aj-breakdown` skill: materialize the approved children |
| `awaiting_agent_spec` | Write a tiny, concise spec; `aj submit-spec <node> --file <path>` |
| `ready_for_pickup` | Follow the `aj-implement` skill: implement and raise the PR |

If anything is ambiguous, ask early: `aj post <node> --type question --body "..."` (this hands the turn to the human) — then unclaim and move on.

## 6. Post results and hand over

When your stage's work is done, the status change (via `aj propose-split`, `aj submit-spec`, `aj set-status`, or the PR/GHA) hands the turn over. Post a short `note` if there's context worth recording:

```
aj post <node> --type note --body "..."
```

## 7. Unclaim if stopping unfinished

If you stop for any reason without completing the stage:

```
aj unclaim <node>
```

Never leave a claim dangling on work you're not actively doing.
