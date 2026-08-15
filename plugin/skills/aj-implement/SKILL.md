---
name: aj-implement
description: Procedure for implementing an AgentJira node — claim, load context, branch, implement per the node's contract (its approved spec, or its title/body/thread when the spec was skipped), raise a PR with the node marker. Use when working a node whose status is ready_for_pickup.
---

# Implementing a node

Follow the `agentjira-workflow` rulebook throughout. A `ready_for_pickup` node was cleared to build in one of two ways: it has a **human-approved spec** (that spec is your contract), or the breakdown agent judged it routine enough to **skip the spec** and build directly (look for a `note` message explaining why). A spec-less node's contract is its title, body, and thread context — build what those describe. If that context is too thin to build confidently, don't guess: post a question (`aj post <node> --type question …`) or route it back to spec (`aj set-status <node> awaiting_agent_spec`).

## 1. Claim

```
aj claim <node>
```

## 2. Context

```
aj context <node>
```

Read the spec **if there is one** (a spec-less node carries its contract in the title, body, and thread instead), the threads (spec-review comments often carry constraints), and **the downloaded canvas PNGs**. Check invalidated/stale ancestors — if the context shows the node is **stale** (an ancestor is currently invalidated; derived, so it never appears in `aj tasks`), it is dead until that ancestor is restored: do not implement it unless a human explicitly directs you to — ask (`aj post <node> --type question --body "..."`) instead of building on a dead premise.

Then invoke the stage-notes skill for this node's current status — `aj-stage-notes-ready-for-pickup`, or `aj-stage-notes-pr-changes-requested` / `aj-stage-notes-pr-base-moved` on a round-trip — to load this project's instructions for the stage, including how long the PR body should be.

## 3. Branch

Work on a fresh git branch in the project's repo (one repo per project), branched from the **remote** default branch — a local `main` may be days behind, and starting there means your PR is born stale:

```
git fetch origin && git switch -c <branch> origin/main
```

## 4. Implement per the contract

Invoke the `code-style-guide` skill and follow it while writing the code.

Build exactly what the contract says — the spec, or (for a spec-less node) its title/body/thread — no gold-plating, no scope creep. If it turns out to be wrong or ambiguous mid-flight, post a question and pause rather than improvising. **If a node routed as spec-less turns out to touch security** (auth, secrets, permissions, RLS, migrations, config), stop and route it back to spec (`aj set-status <node> awaiting_agent_spec`) — that work always warrants the human's eyes on the plan.

### Hit something only a human can do?

Account signup, payment details, a click in a third-party console, physical setup — you cannot do it and no amount of asking changes that. **Do not park this node waiting for the human.** Split the human step out as its own node and firm-block yourself on it:

```
aj create-node -p <project> --title "<the thing the human must do>" \
  --body "<exactly what to do, and what it unblocks>" \
  --parent <this node's parent> --status human_only_action
aj add-edge --type firm_block --from <new node> --to <this node>
aj post <node> --type note --body "Blocked on <new node id>: <one line>."
```

Then finish whatever parts of your node **don't** depend on it and get them into the PR, or `aj unclaim <node>` and pick up other work. Never fake credentials or stub the thing out to keep going unless the contract explicitly says to.

## 5. Raise the PR

**Plan deliverable?** If this node's PR lands a plan/spec document in the repo rather than working code, flag it **before** the PR merges:

```
aj set-breakdown-on-merge <node>
```

On merge the node then returns to `awaiting_agent_breakdown` (instead of `done`) so the planned work gets split into tasks.

Push and open the PR **as the app identity**, not as yourself. The human reviewer
can only approve a PR they didn't author, so authorship must be the app
(`agentjira[bot]`). Push with `aj gitpush`, which mints a short-lived,
repo-scoped token internally and hands it straight to `git push` — the token
never lands on your command line:

```
aj gitpush <node>
GH_TOKEN=$(aj github-token <node>) gh pr create --title "[AJ] <node title>" --body "<body below>"
```

- `aj gitpush <node>` pushes the current branch (`HEAD`) to `origin`'s GitHub
  repo as `agentjira[bot]`. Use `-u` on the first push of a new branch, and
  `--force-with-lease` after a rebase; pass an explicit refspec as the second
  argument if you need one other than `HEAD`.
- The minted token lasts ~1h and is scoped to this project's repo with contents +
  pull-requests write only. `aj gitpush` never prints it; when you must mint one
  for `gh` yourself, never print it into the PR, logs, or the node thread.
- If `aj gitpush`/`aj github-token` reports the app isn't installed on the repo,
  the operator needs to install the GitHub App there (see `docs/architecture.md`).
- Title: `[AJ] <node title>`
- Body must contain the marker, exactly:

  ```
  Implements AgentJira node: <web-app-url>/n/<node-uuid>

  AgentJira-Node: <node-uuid>
  ```

The GHA greps `AgentJira-Node: <uuid>` (last occurrence wins) to link the PR back to the node.

The marker block is fixed. **The rest of the body is yours, and it's what the reviewer actually reads** — keep it to the budget set by `aj-stage-notes-ready-for-pickup` (loaded in step 2).

## 6. Link as backup

```
aj link-pr <node> --url <pr-url> --number <pr-number>
```

This sets the PR fields and status `pr_raised`, covering repos where the GHA isn't installed yet.

## 7. Hands off

From `pr_raised` onward **the GHA owns the node's status**: it reports `pr_opened`, merges on GitHub approval once checks are green, and the report-back flips the node to `done` with the merge SHA (or back to `awaiting_agent_breakdown` for a plan-deliverable node flagged with `breakdown_on_merge`). Do not set the status yourself past this point — with one exception, below. If the PR is closed unmerged, that's for humans/agents to triage on the node.

Reaching `pr_raised` releases your claim automatically — the turn is GitHub's now, and the node shouldn't look held by a session that's about to exit. Nothing to do here.

## 8. If the review requests changes

When a reviewer requests changes or leaves inline comments, the GHA flips the node to **`pr_changes_requested`** (an agent turn) and posts the review to the thread as a `review_comment`. The node reappears in `aj tasks`, so a fresh session can pick it up — you don't have to be the original author.

1. `aj claim <node>` (if not still claimed), then `aj context <node>` — **read the `review_comment`**; it carries the reviewer's summary and inline comments verbatim, so you work from the board, not GitHub.
2. Check out the PR branch and address every comment (invoke the `code-style-guide` skill and follow it for any code you write). If a comment is wrong or ambiguous, reply on the PR and/or `aj post <node> --type note` rather than guessing.
3. Push the fixes **as the app identity** — `aj gitpush` mints a fresh token each run, so an expired earlier one doesn't matter:

   ```
   aj gitpush <node>
   ```

4. Hand the turn back to review:

   ```
   aj resubmit <node> --body "What you changed in response to the review"
   ```

   This is the **explicit round-trip** (`pr_changes_requested` → `pr_raised`) — deliberate, so a work-in-progress push never flips the turn on its own. Then re-request the review on GitHub (e.g. `gh pr ready` / re-request reviewers) so the human can approve.

The loop can repeat as many times as the review needs — same as any other agent turn.

## 9. If main moves under the PR

Any merge in the project flips every other open PR's node to **`pr_base_moved`** (an agent turn). The branch is now behind main, and the point of this stage is that a *clean* merge proves nothing: main may have renamed something the branch calls, changed a contract it relies on, or already done the work.

1. `aj claim <node>`, then `aj context <node>` — the `system` message says which PR merged.
2. Check out the PR branch, then read what landed before merging anything:

   ```
   git fetch origin && git log --oneline --stat HEAD..origin/main
   ```

   Look for renamed or moved symbols the branch calls, changed signatures, migrations that now collide, and contract changes in `docs/architecture.md`.
3. Merge it in and prove the result, since git being happy is not the same as the change still being right:

   ```
   git merge origin/main
   ```

   Then build and test.
4. Three outcomes:
   - **Nothing to do** — resolve any conflicts, push, resubmit.
   - **Branch needs work** — fix it here (invoke `code-style-guide`), push, resubmit.
   - **Node is now redundant** — main already did it. Don't resubmit; `aj post <node> --type question --body "..."` and let the human decide whether to invalidate.
5. Push and hand back:

   ```
   aj gitpush <node>
   aj resubmit <node> --body "What changed, or that main didn't affect this branch"
   ```

Same explicit round-trip as a review round: pushing alone never returns the turn.
