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

Then invoke the `aj-stage-notes` skill for this node's current status (`awaiting_agent_breakdown` or `split_approved`) to load any project-specific instructions for this stage (usually none).

## Case A — `awaiting_agent_breakdown`: propose or route

**Re-entry from a merged plan?** If the node has `breakdown_on_merge` set and a merged PR (`merge_sha` set, PR linked), it just landed a plan/spec document in the repo and was routed back here to split that work. Read the merged document in the project repo — it is the primary input; propose the split it implies (and question it if it conflicts with the board context).

**Decide: is this node already PR-sized?** Bias toward breaking down. Route straight
to spec only when the node is *clearly* one coherent change — a title, a short body, and
your own read all agree it's a single PR. If it's a freshly-created node with thin context
(little body, no canvas braindump) or you're unsure of its size, **do not guess small**:
propose a split, or ask a clarifying question first (`aj post <node> --type question …`).
Skipping to spec on a hunch strands the human with no easy way back — prefer the split
proposal, which they can approve or reject.

- **PR-sized** (one coherent change, one PR): don't split. Route it to spec:

  ```
  aj set-status <node> awaiting_agent_spec
  ```

  Then write the tiny, concise spec and `aj submit-spec <node> --file <path>` (→ `spec_review`). When the spec plans out code, invoke the `code-style-guide` skill and let it shape what you specify.

- **Bigger than one PR**: propose a split. Keep it concise — numbered children, **one line of scope each**, plus suggested blocking edges between siblings:

  ```
  aj propose-split <node> --body "1. <child title> — <one-line scope>
  2. <child title> — <one-line scope>
  3. <child title> — <one-line scope> (plan deliverable: decision doc, breakdown_on_merge)

  Edges: 1 firm-blocks 2 (2 builds on 1's schema); 3 plan-firm-blocks 1 and 2 (they need 3's decision, not its follow-up work); 1 soft-blocks 3 (shared naming decisions)."
  ```

  **For every proposed block, name the variant and say why** — the human approves the edges too:

  - The target needs the blocker **built and merged** → `firm_block` / `soft_block`.
  - The target only needs the blocker's **decision/plan document** → `firm_block_plan` / `soft_block_plan` (satisfied the moment the plan merges, even though the blocker then re-enters breakdown to split its follow-up work).
  - A child whose deliverable **is** a document (decision, design, plan) should be flagged in the proposal as a plan deliverable (`breakdown_on_merge`) — and blocks *from* it should almost always be the `_plan` variants.

  This posts the `split_proposal` message and sets the node to `split_proposed`. It is now the human's turn — stop here; the handoff releases your claim automatically. Do NOT create children yet.

## Case B — `split_approved`: materialize

The human approved the proposal (read the thread — their `split_decision` message may adjust it). Now:

1. Create each child under the parent:

   ```
   aj create-node -p <project> --title "<child title>" --body "<one-line scope>" --parent <node>
   ```

   This creates the node plus the `subtask` edge from the parent. Default status `awaiting_agent_breakdown` is correct — children that are obviously PR-sized can be created with `--status awaiting_agent_spec` instead. A child the proposal marked as a **plan deliverable** (its PR will land a decision/plan document) gets `--breakdown-on-merge` so its merge routes it back to breakdown instead of `done`.

2. Add the proposed **sibling** blocks — only blocks _between the new children_:

   ```
   aj add-edge --type firm_block --from <blocker-child> --to <blocked-child>
   aj add-edge --type soft_block --from <blocker-child> --to <blocked-child>
   ```

   Use the variant the approved proposal named. Rule of thumb (see the
   rulebook's "Choosing a block type"): target needs the blocker **built** →
   base type; target only needs the blocker's **decision/plan document**
   (typical when the blocker is a `breakdown_on_merge` node) →
   `firm_block_plan` / `soft_block_plan`, which stop gating the moment the
   plan merges rather than waiting for the whole implementation subtree.

   **Do NOT replicate the parent's outside blocks onto each child.** If the parent
   blocks some outside node T, that block stays on the parent — once you set the
   parent `broken_down` (step 3) it becomes a *coarse* block: hidden from the graph
   and surfaced in `aj context` as a parent-level note, so the outside dependency
   isn't lost. Fanning "child₁→T, child₂→T, child₃→T" just recreates the hairball the
   coarse-block demotion exists to prevent. Only attach a child→T block when that one
   child _specifically and solely_ carries the dependency (then retire the parent's).

3. Set the parent to its container status:

   ```
   aj set-status <node> broken_down
   ```

Work now continues in the children. Unclaim the parent if you're stopping, or continue via `aj-pickup` on a child.
