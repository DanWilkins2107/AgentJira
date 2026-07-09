# AgentJira GitHub Action

One workflow, installed into each project repo, that closes the PR loop:

- **report** — tells the AgentJira `github-sync` Edge Function about PR state (`pr_opened`, `pr_approved`, `pr_changes_requested`, `pr_merged`, `pr_closed`), linking the PR to its node via the `AgentJira-Node: <uuid>` marker in the PR body. PRs without the marker are skipped cleanly. A review that **requests changes** or leaves **inline comments** reports `pr_changes_requested` (with the review body + inline comments), which flips the node back to the agent's turn; a bare "Comment" review with no inline notes is skipped. This needs `pull-requests: read` permission to read the review's comments.
- **merge** — when a GitHub review is submitted with state *approved* on a marked PR, waits for checks to pass (~20 min timeout; zero check runs counts as pass), verifies mergeability, squash-merges using the repo's own `GITHUB_TOKEN`, then reports `pr_merged` with the merge SHA.

GitHub PR approval is the final human gate: approve the PR and the node flips to `done` on the board.

## Install

1. Copy [`agentjira.yml`](agentjira.yml) into the project repo as `.github/workflows/agentjira.yml` and commit it to the default branch.
2. Add two repository secrets (Settings → Secrets and variables → Actions):

   | Secret | Value |
   |---|---|
   | `AGENTJIRA_SYNC_URL` | The `github-sync` Edge Function URL, e.g. `https://<ref>.supabase.co/functions/v1/github-sync` |
   | `AGENTJIRA_SECRET` | The project's `webhook_secret` (shown on the project page in the web app) |

3. Link the repo to the project in the AgentJira web app (**one repo per project** — each project's secret only authorizes nodes in that project, so each repo gets its own project's secret).

## Branch protection caveats

- The merge job authenticates as `GITHUB_TOKEN` (the `github-actions` bot). If the branch is protected, that token must be allowed to merge: required reviews are satisfied by the human approval that triggers the job, but rules like "restrict who can push" or required checks that never report will block it. Adjust protection so the bot can complete the squash merge.
- Merges performed with `GITHUB_TOKEN` **do not trigger downstream `on: push` workflows** — this is a GitHub guard against recursive workflows. If something must run on merge to the default branch, trigger it another way (e.g. `workflow_run`, or a PAT — with the usual credential caveats).
- Manual merges still work: the `pull_request: closed` trigger reports `pr_merged` as a backup, and the server side is idempotent (setting `done` twice is harmless).
