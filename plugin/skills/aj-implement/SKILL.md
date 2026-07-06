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
