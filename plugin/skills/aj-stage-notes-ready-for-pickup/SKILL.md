---
name: aj-stage-notes-ready-for-pickup
description: Stage notes for ready_for_pickup. Load before starting any ready_for_pickup node.
---

# ready_for_pickup — project stage instructions

When writing a PR description, be concise. No more than maybe 5 bullet points. I need a quick summary of any decisions made, not an in depth discussion on evey aspect of the code

## Examples:
**Instead of:**
```
One string literal in terraform/iam/main.tf.

data.aws_iam_policy_document.ci_apply_assume OIDC trust sub:
repo:${var.repo_owner}/${var.repo_name}:environment:prod -> :environment:deploy

Human picked the name deploy (split_decision on parent a48b75bd).

Scope notes:

Trust policy only. data.aws_iam_policy_document.ci_apply (permission policy) untouched — sibling node owns widening it.
README needs nothing: 0f941aa already removed every mention of the environment.
deploy is lowercase; IAM StringEquals is exact-match. repo_name unchanged (GitHub emits LoopCLIHarness).
No apply. terraform/iam is local-state and never applied; first apply is human-only node a2d624bd, which this firm-blocks.
Verified:

terraform fmt -check -recursive — exit 0
terraform validate — Success! The configuration is valid.
grep environment:prod — 0 hits repo-wide; environment:deploy — 1 hit, terraform/iam/main.tf:57
Implements AgentJira node: https://agentjira.app/n/a0e2cedd-7709-44cf-b3d2-fcf23aeaca91

AgentJira-Node: a0e2cedd-7709-44cf-b3d2-fcf23aeaca91
```
**Do something like:**
```
Updated OIDC trust sub to match human picked naming of "prod". Changed from the original "deploy".

Implements AgentJira node: https://agentjira.app/n/a0e2cedd-7709-44cf-b3d2-fcf23aeaca91
```
