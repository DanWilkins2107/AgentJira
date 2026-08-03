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
| `awaiting_agent_breakdown` | **agent** | Study context; propose a split, or if PR-sized route to spec — or, for routine non-security work where human guidance on the plan wouldn't help, skip the spec straight to `ready_for_pickup` |
| `awaiting_human_response` | human | Agent asked question(s); human must answer in the thread |
| `split_proposed` | human | Split proposal posted; human must approve/reject |
| `split_approved` | **agent** | Materialize child nodes + `subtask` edges, then set parent to `broken_down` |
| `broken_down` | none | Container node; work continues in children |
| `awaiting_agent_spec` | **agent** | Node is PR-sized; write a tiny, concise spec |
| `spec_review` | human | Human approves (→ `ready_for_pickup`) or rejects (→ `awaiting_agent_spec` with a `review_comment`) |
| `ready_for_pickup` | **agent** | Cleared to build (approved spec, or a spec-less routine node the breakdown agent sent straight here); claim and implement |
| `human_only_action` | human | Work only a person can do (account, payment, external dashboard, physical). Never yours — the human does it and marks it `done`. See "Human-only work" below |
| `evaluating_soft_block` | **agent** | A soft-blocked node handed to the soft-block **judge** (a separate, supervisor-dispatched session) to decide: proceed, ask the human (→ `awaiting_human_response`), or defer (`reassess_after`). A general pickup agent should normally leave this — it's the judge's job |
| `pr_raised` | github | PR open; GitHub review is the approval gate; the GHA merges and reports back |
| `pr_changes_requested` | **agent** | Reviewer requested changes / left inline comments; address them, then `aj resubmit` → `pr_raised` |
| `done` | none | Merged (or completed); `merge_sha` recorded |
| `invalidated` | none | Marked wrong; reason recorded; kept forever as context |

The **agent-turn statuses** — the only ones you may act on — are exactly:
`awaiting_agent_breakdown`, `split_approved`, `awaiting_agent_spec`, `ready_for_pickup`, `evaluating_soft_block`, `pr_changes_requested`.
(`evaluating_soft_block` is dispatched to the soft-block judge by the supervisor — a general pickup agent should skip it.)

Everything else is a human's turn, GitHub's turn, or terminal. Never fake a human's turn (e.g. never approve your own split or spec).

## Blocks — judgment, not constraints

Edges of type `firm_block` and `soft_block` are **information for you, never hard constraints**:

- **Firm-blocked** (blocker not `done`): the target should ideally wait. Don't pick it up while the blocker is unfinished.
- **Soft-blocked**: shared decisions. Only pick up soft-blocked work if you have **nothing else to do**, and only when it's **sensible — not too much of a stretch**. If proceeding requires guessing at decisions the blocker will make, it's a stretch: leave it.
- **Plan variants** (`firm_block_plan` / `soft_block_plan`): same as the base type **until the blocker's plan lands** — blocker `done` OR `merge_sha` recorded — and satisfied from then on (context only, no longer a block), even while the blocker's own follow-up breakdown continues. `aj tasks` marks a satisfied one "PLAN LANDED" and stops gating on it.

**Choosing a block type — every time you create a block edge, ask: what does the target actually need from the blocker?**

| The target needs… | Use |
|---|---|
| the blocker's **implementation** (built, merged, working) | `firm_block` / `soft_block` |
| only the blocker's **decision/plan** (typically a `breakdown_on_merge` node whose PR lands a document) | `firm_block_plan` / `soft_block_plan` |

Getting this wrong in the plan direction over-blocks: a plain block from a plan-deliverable node **re-arms** when the node re-enters breakdown after its plan merges, and stays armed through `broken_down` — gating the target on the entire implementation subtree when it only ever needed the decision.
- **Reassess-after** (`reassess_after` edge, source not `done`): the target was deliberately **deferred for re-judgment** until the source resolves. Treat it **exactly like a firm block** — don't pick it up while the source is unfinished. Once the source is `done` it's re-judged (it will typically re-enter `evaluating_soft_block`).

`aj tasks` annotates every node with its blockers and their statuses, and lists firm-blocked / reassess_after-gated / already-claimed nodes in a "not recommended" section — visible, but respect it.

## Claim etiquette

- **Claim before working**: `aj claim <node>` before touching a node. If it's already claimed, pick something else (don't `--force` unless a human tells you to).
- **Handoffs release the claim for you**: any status change that hands the turn to the human, to GitHub, or to nobody (`spec_review`, `split_proposed`, `awaiting_human_response`, `human_only_action`, `pr_raised`, `broken_down`, `done`, `invalidated`) clears the claim automatically. You do **not** need to unclaim after `aj submit-spec`, `aj propose-split`, `aj post --type question`, or raising a PR.
- **Unclaim when stopping mid-stage**: if you stop without finishing the stage and *without* a status change — for any reason — run `aj unclaim <node>`. That's the one case nothing clears for you, and a stale claim hides the node from other agents until a human clears it.
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

This flips the node to `awaiting_human_response` — regular human intervention is a feature of this system, not a failure. A cheap question now beats an invalidated subtree later. See `examples/question.md` (`aj-examples`) for how the project wants questions framed.

## Human-only work — split it out, never wait on it

Some work is blocked on being a person, not on information: creating an account, entering payment details, clicking through a third-party console, plugging in hardware, signing something. You will never be able to do it, no matter how much context you gather.

**A human-only step is always its own node** in `human_only_action`, and the work it holds up is firm-blocked by that node. Never park your own node hoping a human will act on it and hand it back — that is not what this status is.

**Question vs human-only action** — the two are different tools:

| You need… | Do this | Turn comes back to you? |
|---|---|---|
| information or a decision | `aj post <node> --type question` → `awaiting_human_response` | yes, on the same node |
| a **thing done** that only a person can do | split out a `human_only_action` node | no — that node is the human's, end to end |

**Spot these at breakdown and spec time.** That is where they are cheap to predict, and naming them in the split proposal means the human sees their own queue from the start. Hitting one mid-implementation is the fallback, not the plan.

When you do hit one mid-work:

```
aj create-node -p <project> --title "<the thing the human must do>" \
  --body "<what exactly, and what it unblocks>" \
  --parent <your node's parent> --status human_only_action
aj add-edge --type firm_block --from <new node> --to <your node>
aj post <your node> --type note --body "Blocked on <new node id>: <one line>."
```

Then **go and do something else** — `aj unclaim <your node>` if you're stopping there. Don't sit waiting, and don't work around it by faking credentials or stubbing the thing out unless the node's contract says to. If the *whole* node turns out to be human-only, just move it: `aj set-status <node> human_only_action`.

Write the body so a human with no context can act on it: the exact thing to do, where, and what it unblocks. A `human_only_action` node ends when the human marks it `done`; nothing hands back to you, and your node unblocks by the ordinary firm-block rule.

## Brevity — write the least that works

Every word you put on the board is read by a human. **Shorter is always better.** Cut fluff and over-explanation everywhere you write — specs, split proposals, questions, notes, PR bodies, review replies. Prefer bullets to paragraphs; drop preamble, restated context, and anything the human can already see on the node. Say what to do / what you need / what changed, and stop. When in doubt, cut it.

**Specs especially.** A node at `awaiting_agent_spec` is already PR-sized; the spec is a handful of tight bullets — what to build, where, acceptance criteria — never an essay. Submit with `aj submit-spec <node> --file <path>` (or `--body`), which sets `spec_review`.

**The project may have set the bar for you.** Before writing a spec, split proposal, PR body, or question, invoke the `aj-examples` skill and read `examples/<artifact>.md`. A filled-in file gives you a length budget and a worked example; match it. A blank one (`<!-- AJ-EXAMPLE:EMPTY -->`), or an artifact with no file at all, means this rule is your only guide.

## Plan-deliverable nodes — breakdown on merge

Some nodes deliver a **plan/spec document committed to the repo**, not working code. For those, `done` is wrong after the merge — the planned work still has to be split into tasks. Before raising the PR, flag the node:

```
aj set-breakdown-on-merge <node>
```

When that PR merges, github-sync routes the node back to `awaiting_agent_breakdown` (still recording `merge_sha`) instead of `done`. Whoever picks it up there treats the merged document as the primary input for the split. `--off` clears the flag; humans can also toggle it from the node's Spec/PR tab.

Blocks **from** a plan-deliverable node should almost always be the `_plan` variants (`firm_block_plan` / `soft_block_plan`) — targets usually depend on the decision, which lands with the merge, not on the follow-up implementation subtree. See "Choosing a block type" above.

## PR conventions (exact)

PR title: `[AJ] <node title>`.

PR body must contain, exactly:

```
Implements AgentJira node: <web-app-url>/n/<node-uuid>

AgentJira-Node: <node-uuid>
```

The GHA greps `AgentJira-Node: <uuid>` (last occurrence wins) to link the PR to the node. The marker is fixed; **everything else in the body is yours to keep short** — read `examples/pr-body.md` via the `aj-examples` skill before writing it.

Push and open the PR **as the app identity** (`agentjira[bot]`), never as yourself — a human can't approve their own PR, so the app must be the author. Push with `aj gitpush <node>` (mints and uses the token internally); create the PR with `gh pr create` (exact commands in `aj-implement`). After opening, run `aj link-pr <node> --url <u> --number <n>` as a backup. From `pr_raised` onward, the GHA owns the node's status — do not set it yourself.

**When a review requests changes** (or leaves inline comments), the GHA flips the node to `pr_changes_requested` — an agent turn — and posts the review to the thread as a `review_comment`. It shows up in `aj tasks` like any other agent work. Address the comments on the same branch, push as the app identity, then run `aj resubmit <node>` to hand it back to `pr_raised` and re-request the review on GitHub. This is the one status you set yourself between `pr_raised` and `done` — see `aj-implement`.

## Hard rules

- **Never delete anything** — no nodes, edges, messages, or events. History is permanent by design; use `aj invalidate <node> --reason <text>` instead.
- Any graph traversal reasoning you do (ancestors, descendants, blockers) carries a visited-set and a **depth cap of 50** — cycles are legal data.
- Use the exact status, edge-type, and message-type strings above; never invent variants.
