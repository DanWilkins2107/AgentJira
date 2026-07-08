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

## 3. Branch

Work on a fresh git branch in the project's repo (one repo per project), branched from the default branch.

## 4. Implement per the spec

Build exactly what the spec says — no gold-plating, no scope creep. If the spec turns out to be wrong or ambiguous mid-flight, post a question and pause rather than improvising.

## 5. Raise the PR

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

From `pr_raised` onward **the GHA owns the node's status**: it reports `pr_opened`, merges on GitHub approval once checks are green, and the report-back flips the node to `done` with the merge SHA. Do not set the status yourself past this point. If the PR gets review comments, address them on the branch; if it's closed unmerged, that's for humans/agents to triage on the node.

You're done — the claim can stand while the PR is open, or unclaim if you're ending the session.
