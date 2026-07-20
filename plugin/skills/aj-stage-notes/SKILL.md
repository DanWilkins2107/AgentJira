---
name: aj-stage-notes
description: Load project-specific extra instructions for the current node's stage. Invoked by aj-pickup, aj-breakdown, and aj-implement right after loading context and before doing the stage work — reads stages/<status>.md and follows it when the project has filled it in.
---

# Project stage instructions

Optional, project-authored guidance layered on top of the stage skills. One file per agent-turn status lives in `stages/`. Most ship blank; when a project fills one in, its instructions apply to every node worked at that status.

## How to use (while working a node)

1. Take the node's **current status** (from `aj context`).
2. Read the matching file in this skill's `stages/` folder:

   | Status | File |
   |---|---|
   | `awaiting_agent_breakdown` | `stages/awaiting_agent_breakdown.md` |
   | `split_approved` | `stages/split_approved.md` |
   | `awaiting_agent_spec` | `stages/awaiting_agent_spec.md` |
   | `ready_for_pickup` | `stages/ready_for_pickup.md` |
   | `evaluating_soft_block` | `stages/evaluating_soft_block.md` |
   | `pr_changes_requested` | `stages/pr_changes_requested.md` |

3. **Is it blank?** If the file still contains the line `<!-- AJ-STAGE-NOTES:EMPTY -->` and no other prose, there are no project instructions for this stage — proceed with the normal stage skill and move on. Otherwise **follow what it says**, on top of the stage skill.

## Rules

- **Additive only.** These notes refine how a stage is worked in this project; they never override the `agentjira-workflow` rulebook or its hard rules (history is permanent, exact status/edge/message strings, ask-early, brevity). If a note ever conflicts with the rulebook, the rulebook wins.
- Only the six agent-turn statuses have files. Any other status → nothing to load.
