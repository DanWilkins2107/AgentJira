---
name: aj-breakdown
description: Procedure for breaking down AgentJira nodes — propose a split for review, or materialize an approved split into child nodes and edges. Use when working a node whose status is awaiting_agent_breakdown or split_approved.
---

# Breaking down a node

Follow the `agentjira-workflow` rulebook throughout. Claim the node first (`aj claim <node>`).

## Study the context first

```
aj context <node>
```

Read the full dump **and the downloaded canvas PNGs** (the node's and its ancestors') — the human's braindump often lives on the canvas. Check invalidated ancestors: their reasons tell you which directions are already dead (a **stale** node — ancestor currently invalidated — is itself dead until that ancestor is restored). If the direction is unclear, ask now (`aj post <node> --type question --body "..."`) rather than proposing a split built on guesses.

Then invoke the stage-notes skill for this node's current status — `aj-stage-notes-awaiting-agent-breakdown` or `aj-stage-notes-split-approved` — to load this project's instructions for the stage. Do it before you write anything to the board: the notes govern the format and length of what you produce.

## Case A — `awaiting_agent_breakdown`: propose or route

**Re-entry from a merged plan?** If the node has `breakdown_on_merge` set and a merged PR (`merge_sha` set, PR linked), it just landed a plan/spec document in the repo and was routed back here to split that work. Read the merged document in the project repo — it is the primary input; propose the split it implies (and question it if it conflicts with the board context).

**Decide: is this node already PR-sized?** Bias toward breaking down. Route straight
to spec only when the node is *clearly* one coherent change — a title, a short body, and
your own read all agree it's a single PR. If it's a freshly-created node with thin context
(little body, no canvas braindump) or you're unsure of its size, **do not guess small**:
propose a split, or ask a clarifying question first (`aj post <node> --type question …`).
Skipping to spec on a hunch strands the human with no easy way back — prefer the split
proposal, which they can approve or reject.

- **PR-sized** (one coherent change, one PR): don't split. Now decide **whether it needs a spec at all** — the question is *"would the human's guidance on the plan actually be beneficial here?"*, not *"can I get away without one?"*.

  - **Spec worthwhile** — write one and route to review:

    ```
    aj set-status <node> awaiting_agent_spec
    ```

    Then write the tiny, concise spec and `aj submit-spec <node> --file <path>` (→ `spec_review`). Invoke `aj-stage-notes-awaiting-agent-spec` first — it sets the project's length budget and shape. When the spec plans out code, invoke the `code-style-guide` skill and let it shape what you specify.

  - **Spec wouldn't add value** — the change is routine and self-evident, human guidance on the plan wouldn't change what you build → skip the spec and go straight to build:

    ```
    aj set-status <node> ready_for_pickup
    aj post <node> --type note --body "Skipped spec — <one line: why guidance wouldn't help, e.g. routine UI copy change, no security surface>. Building directly; PR review is the gate."
    ```

    The node stays your turn, so your claim carries into implementation (`aj-implement`). The PR is then the human's only gate on this work — the note is their breadcrumb for *why* there was no plan.

  **Hard rule — security always gets a spec.** Anything touching auth, secrets, permissions, RLS, database migrations, or configuration is *never* skipped, no matter how small it looks. When in doubt about whether something is security-relevant, write the spec. This is not a judgment call; it is a floor.

- **Human-only** (no agent could ever do it — account signup, payment, third-party dashboard, physical setup): it is not a spec candidate at all. If the *whole* node is human-only, move it and stop:

  ```
  aj set-status <node> human_only_action
  ```

  More often only *part* of the work is human-only — then it becomes one of the children of your split (below), not a detour on an agent node.

- **Bigger than one PR**: propose a split. Keep it concise — numbered children, **one line of scope each**, plus suggested blocking edges between siblings:

  ```
  aj propose-split <node> --body "1. <child title> — <one-line scope>
  2. <child title> — <one-line scope>
  3. <child title> — <one-line scope> (plan deliverable: decision doc, breakdown_on_merge)
  4. <child title> — <one-line scope> (HUMAN-ONLY: only you can do this)

  Edges: 1 firm-blocks 2 (2 builds on 1's schema); 3 plan-firm-blocks 1 and 2 (they need 3's decision, not its follow-up work); 1 soft-blocks 3 (shared naming decisions); 4 firm-blocks 2 (2 can't run without the account)."
  ```

  **For every proposed block, name the variant and say why** — the human approves the edges too:

  - The target needs the blocker **built and merged** → `firm_block` / `soft_block`.
  - The target only needs the blocker's **decision/plan** → `firm_block_plan` / `soft_block_plan` (satisfied the moment the plan lands — the plan document merges, or the blocker is broken down, since the approved split *is* the decision — even though the blocker's own follow-up work continues).
  - A child whose deliverable **is** a document (decision, design, plan) should be flagged in the proposal as a plan deliverable (`breakdown_on_merge`) — and blocks *from* it should almost always be the `_plan` variants.

  **Name the human-only children.** Splitting is the cheapest place to notice work no agent can do — accounts, payments, third-party dashboards, anything physical. Give each one its own numbered child marked HUMAN-ONLY, and firm-block whatever it holds up. Doing this here means the human sees their own queue up front instead of an agent hitting the wall days later. Err toward flagging: a mis-flagged child costs the human one status change, an un-flagged one strands an agent.

  This posts the `split_proposal` message and sets the node to `split_proposed`. It is now the human's turn — stop here; the handoff releases your claim automatically. Do NOT create children yet.

## Case B — `split_approved`: materialize

The human approved the proposal (read the thread — their `split_decision` message may adjust it). Now:

1. Create each child under the parent:

   ```
   aj create-node -p <project> --title "<child title>" --body "<one-line scope>" --parent <node>
   ```

   This creates the node plus the `subtask` edge from the parent. Default status `awaiting_agent_breakdown` is correct — children that are obviously PR-sized can be created with `--status awaiting_agent_spec` instead. A child the proposal marked as a **plan deliverable** (its PR will land a decision/plan document) gets `--breakdown-on-merge` so its merge routes it back to breakdown instead of `done`. A child the proposal marked **HUMAN-ONLY** is created with `--status human_only_action` — it goes straight to the human's queue and never enters yours.

2. Add the proposed **sibling** blocks — only blocks _between the new children_:

   ```
   aj add-edge --type firm_block --from <blocker-child> --to <blocked-child>
   aj add-edge --type soft_block --from <blocker-child> --to <blocked-child>
   ```

   Use the variant the approved proposal named. Rule of thumb (see the
   rulebook's "Choosing a block type"): target needs the blocker **built** →
   base type; target only needs the blocker's **decision/plan**
   (typical when the blocker is a `breakdown_on_merge` node, but also whenever
   the blocker's own breakdown is the decision) →
   `firm_block_plan` / `soft_block_plan`, which stop gating the moment the plan
   lands — the document merges, or the blocker reaches `broken_down` — rather
   than waiting for the whole implementation subtree.

   **Do NOT replicate the parent's outside blocks onto each child.** If the parent
   blocks some outside node T, that block stays on the parent — once you set the
   parent `broken_down` (step 3) it becomes a *coarse* block: hidden from the graph
   and surfaced in `aj context` as a parent-level note, so the outside dependency
   isn't lost. Fanning "child₁→T, child₂→T, child₃→T" just recreates the hairball the
   coarse-block demotion exists to prevent. Only attach a child→T block when that one
   child _specifically and solely_ carries the dependency (then retire the parent's).

   One exception to "it stays a gate": if the parent's outside block is a `_plan`
   variant, setting the parent `broken_down` **satisfies** it — T only ever needed
   the decision, and the approved split is that decision. If T also turns out to
   need a specific child's implementation, add an explicit block from that child
   to T; don't convert the `_plan` edge back to a plain one.

3. Set the parent to its container status:

   ```
   aj set-status <node> broken_down
   ```

Work now continues in the children. Unclaim the parent if you're stopping, or continue via `aj-pickup` on a child.
