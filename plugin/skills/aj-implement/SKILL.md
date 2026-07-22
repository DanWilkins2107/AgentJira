---
name: aj-implement
description: Procedure for implementing an AgentJira node — claim, load context, branch, implement per the approved spec, raise a PR with the node marker. Use when working a node whose status is ready_for_pickup.
---

# Implementing a node

Follow the `agentjira-workflow` rulebook throughout. A `ready_for_pickup` node has a human-approved spec — that spec is your contract.

## 1. Claim

```
aj claim <node>
```

## 2. Context

```
aj context <node>
```

Read the spec, the threads (spec-review comments often carry constraints), and **the downloaded canvas PNGs**. Check invalidated/stale ancestors — if the context shows the node is **stale** (an ancestor is currently invalidated; derived, so it never appears in `aj tasks`), it is dead until that ancestor is restored: do not implement it unless a human explicitly directs you to — ask (`aj post <node> --type question --body "..."`) instead of building on a dead premise.

Then invoke the `aj-stage-notes` skill for this node's current status (`ready_for_pickup`, or `pr_changes_requested` on a review round) to load any project-specific instructions for this stage (usually none).

## 3. Branch

Work on a fresh git branch in the project's repo (one repo per project), branched from the default branch.

## 4. Implement per the spec

Build exactly what the spec says — no gold-plating, no scope creep. If the spec turns out to be wrong or ambiguous mid-flight, post a question and pause rather than improvising.

## 5. Raise the PR

**Plan deliverable?** If this node's PR lands a plan/spec document in the repo rather than working code, flag it **before** the PR merges:

```
aj set-breakdown-on-merge <node>
```

On merge the node then returns to `awaiting_agent_breakdown` (instead of `done`) so the planned work gets split into tasks.

Push and open the PR **as the app identity**, not as yourself. The human reviewer
can only approve a PR they didn't author, so authorship must be the app
(`agentjira[bot]`). Mint a short-lived, repo-scoped token and use it for the push
and PR creation:

```
TOKEN=$(aj github-token <node>)
git push "https://x-access-token:$TOKEN@github.com/<owner>/<repo>.git" HEAD
GH_TOKEN=$TOKEN gh pr create --title "[AJ] <node title>" --body "<body below>"
```

- The token lasts ~1h and is scoped to this project's repo with contents +
  pull-requests write only. Never print it into the PR, logs, or the node thread.
- If `aj github-token` reports the app isn't installed on the repo, the operator
  needs to install the GitHub App there (see `docs/architecture.md`).
- Title: `[AJ] <node title>`
- Body must contain the marker, exactly:

  ```
  Implements AgentJira node: <web-app-url>/n/<node-uuid>

  AgentJira-Node: <node-uuid>
  ```

The GHA greps `AgentJira-Node: <uuid>` (last occurrence wins) to link the PR back to the node.

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
2. Check out the PR branch and address every comment. If a comment is wrong or ambiguous, reply on the PR and/or `aj post <node> --type note` rather than guessing.
3. Push the fixes **as the app identity** (mint a fresh `aj github-token <node>` if the earlier one expired):

   ```
   TOKEN=$(aj github-token <node>)
   git push "https://x-access-token:$TOKEN@github.com/<owner>/<repo>.git" HEAD
   ```

4. Hand the turn back to review:

   ```
   aj resubmit <node> --body "What you changed in response to the review"
   ```

   This is the **explicit round-trip** (`pr_changes_requested` → `pr_raised`) — deliberate, so a work-in-progress push never flips the turn on its own. Then re-request the review on GitHub (e.g. `gh pr ready` / re-request reviewers) so the human can approve.

The loop can repeat as many times as the review needs — same as any other agent turn.
