---
name: agentjira-workflow
description: The AgentJira rulebook — status machine, whose turn it is, block judgment, claim etiquette, and PR conventions. Use whenever doing ANY AgentJira work (any aj command, any node on the board), before and alongside the task-specific skills (aj-pickup, aj-breakdown, aj-implement).
---

# AgentJira workflow rulebook

AgentJira is a graph of task nodes shared between humans and agents. Humans and agents alternate turns; the node's status says whose turn it is. You interact through the `aj` CLI. These rules apply to everything you do on the board.

## Status machine — whose turn is it?

| Status | Turn | Meaning |
|---|---|---|
| `human_braindump_needed` | human | Human must provide direction/context (vision nodes start here) |
| `awaiting_agent_breakdown` | **agent** | Study context; propose a split, or route to spec if PR-sized |
| `awaiting_human_response` | human | Agent asked question(s); human must answer in the thread |
| `split_proposed` | human | Split proposal posted; human must approve/reject |
| `split_approved` | **agent** | Materialize child nodes + `subtask` edges, then set parent to `broken_down` |
| `broken_down` | none | Container node; work continues in children |
| `awaiting_agent_spec` | **agent** | Node is PR-sized; write a tiny, concise spec |
| `spec_review` | human | Human approves (→ `ready_for_pickup`) or rejects (→ `awaiting_agent_spec` with a `review_comment`) |
| `ready_for_pickup` | **agent** | Approved spec; claim and implement |
| `pr_raised` | github | PR open; GitHub review is the approval gate; the GHA merges and reports back |
| `pr_changes_requested` | **agent** | Reviewer requested changes / left inline comments; address them, then `aj resubmit` → `pr_raised` |
| `done` | none | Merged (or completed); `merge_sha` recorded |
| `invalidated` | none | Marked wrong; reason recorded; kept forever as context |

The **agent-turn statuses** — the only ones you may act on — are exactly:
`awaiting_agent_breakdown`, `split_approved`, `awaiting_agent_spec`, `ready_for_pickup`, `pr_changes_requested`.

Everything else is a human's turn, GitHub's turn, or terminal. Never fake a human's turn (e.g. never approve your own split or spec).

## Blocks — judgment, not constraints

Edges of type `firm_block` and `soft_block` are **information for you, never hard constraints**:

- **Firm-blocked** (blocker not `done`): the target should ideally wait. Don't pick it up while the blocker is unfinished.
- **Soft-blocked**: shared decisions. Only pick up soft-blocked work if you have **nothing else to do**, and only when it's **sensible — not too much of a stretch**. If proceeding requires guessing at decisions the blocker will make, it's a stretch: leave it.

`aj tasks` annotates every node with its blockers and their statuses, and lists firm-blocked / already-claimed nodes in a "not recommended" section — visible, but respect it.

## Claim etiquette

- **Claim before working**: `aj claim <node>` before touching a node. If it's already claimed, pick something else (don't `--force` unless a human tells you to).
- **Unclaim when stopping**: if you stop without finishing the stage — for any reason — run `aj unclaim <node>`. A stale claim blocks other agents until a human clears it.
- The claim is a flag, not a lock. Behave accordingly.

## Context is mandatory

**ALWAYS run `aj context <node>` before working a node** — no exceptions. It dumps the node, spec, ancestor chain, children, edges, blockers, and all thread messages, and it downloads the latest canvas PNGs of the node **and its ancestors** to a temp dir, printing the file paths. **Read those PNG files** (with the Read tool) — canvases carry human intent that the text does not.

- **Invalidated and stale ancestors are vital context, never noise.** An `invalidated` ancestor's `invalidation_reason` tells you what was tried and why it was wrong. **Stale** is derived, never stored: it means an ancestor is *currently* invalidated, and the node is dead until that ancestor is restored — stale nodes never appear in `aj tasks`, and restoring the ancestor un-stales them automatically. Do not work a stale node unless a human explicitly directs you to. Blockers don't cause staleness — a blocker's status (including `invalidated`) is information to weigh, shown in the blockers list.
- Use `aj search -p <project> <query>` to pull related history from elsewhere in the graph; everything ever written (including invalidated nodes) is searchable on purpose.

## Ask early, don't guess

If direction is ambiguous, ask **early** via:

```
aj post <node> --type question --body "..."
```

This flips the node to `awaiting_human_response` — regular human intervention is a feature of this system, not a failure. A cheap question now beats an invalidated subtree later.

## Spec style

Specs are **tiny and concise**. A node at `awaiting_agent_spec` is already PR-sized; the spec is a few tight paragraphs or bullets: what to build, where, acceptance criteria. Submit with `aj submit-spec <node> --file <path>` (or `--body`), which sets `spec_review`.

## PR conventions (exact)

PR title: `[AJ] <node title>`.

PR body must contain, exactly:

```
Implements AgentJira node: <web-app-url>/n/<node-uuid>

AgentJira-Node: <node-uuid>
```

The GHA greps `AgentJira-Node: <uuid>` (last occurrence wins) to link the PR to the node.

Push and open the PR **as the app identity** (`agentjira[bot]`), never as yourself — a human can't approve their own PR, so the app must be the author. Get a token with `aj github-token <node>` and use it for `git push` + `gh pr create` (exact commands in `aj-implement`). After opening, run `aj link-pr <node> --url <u> --number <n>` as a backup. From `pr_raised` onward, the GHA owns the node's status — do not set it yourself.

**When a review requests changes** (or leaves inline comments), the GHA flips the node to `pr_changes_requested` — an agent turn — and posts the review to the thread as a `review_comment`. It shows up in `aj tasks` like any other agent work. Address the comments on the same branch, push as the app identity, then run `aj resubmit <node>` to hand it back to `pr_raised` and re-request the review on GitHub. This is the one status you set yourself between `pr_raised` and `done` — see `aj-implement`.

## Hard rules

- **Never delete anything** — no nodes, edges, messages, or events. History is permanent by design; use `aj invalidate <node> --reason <text>` instead.
- Any graph traversal reasoning you do (ancestors, descendants, blockers) carries a visited-set and a **depth cap of 50** — cycles are legal data.
- Use the exact status, edge-type, and message-type strings above; never invent variants.
