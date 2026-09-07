# agentjira-cli (`aj`)

The agent-facing CLI for AgentJira. It wraps `@supabase/supabase-js` with the dedicated **agent user's** login so Claude Code sessions (or any shell) can work the task graph: list agent-turn tasks, pull full node context (including canvas images), claim nodes, post to threads, propose splits, submit specs, link PRs, and more.

Enum strings (statuses, edge types, message types) match `docs/architecture.md` exactly.

## Setup

```sh
cd cli
npm install
npm run build        # tsc → dist/
node dist/index.js --help

# optional: expose the `aj` bin globally
npm link
aj --help
```

Requires Node 22+.

## The agent login

AgentJira uses **one dedicated agent Supabase user** (e.g. `agent@agentjira.local`). The project owner adds that user as a member of each project from the web UI; RLS then grants the agent access to those projects. Every `aj` invocation acts as that user, and everything it writes is stamped `author_role = 'agent'`.

### Configuration

Resolution order: **environment variables first**, else `~/.agentjira/config.json`. Env vars win per key, so you can keep most values in the file and override one via env.

| Env var | config.json key | Meaning |
|---|---|---|
| `AGENTJIRA_URL` | `url` | Supabase project URL |
| `AGENTJIRA_ANON_KEY` | `anon_key` | Supabase anon key (public by design) |
| `AGENTJIRA_EMAIL` | `email` | Agent user email |
| `AGENTJIRA_PASSWORD` | `password` | Agent user password |

Example `~/.agentjira/config.json`:

```json
{
  "url": "http://127.0.0.1:54321",
  "anon_key": "eyJ...",
  "email": "agent@agentjira.local",
  "password": "agentjira-dev"
}
```

Missing config → a one-line error and exit 1. `--help` always works without config.

### Session caching

The session token is cached in `~/.agentjira/session.json` and reused across invocations (`setSession`, which also refreshes an expired access token). If the cached session is unusable, `aj` transparently re-logs-in with email/password and re-caches. Delete the file to force a fresh login.

## Output conventions

- Every command accepts `--json` for structured, machine-readable output. Default output is compact human/agent-readable text.
- Errors: nonzero exit + a single-line message on stderr (`aj: ...`). Supabase error messages are passed through verbatim.
- Node references: a full uuid, or a **uuid prefix of at least 6 characters** (must be unique; ambiguity is an error listing the candidates). Prefix matching is scoped to `-p <project>` when given, else across all member projects.
- Project references (`-p`): full uuid, id prefix (≥ 6 chars), or the exact project name (case-insensitive).
- Ids in text output are shortened to 8 chars; `--json` always carries full uuids.

## Command reference

### `aj whoami`

Current user + role.

```sh
aj whoami
# agent@agentjira.local  id=6f9c...  role=agent  member of 2 project(s)
```

### `aj projects`

List member projects (never reads `webhook_secret`).

```sh
aj projects
# 8a1b2c3d  My App  repo=dan/my-app  (8a1b2c3d-....)
```

### `aj tasks [-p <project>] [--session <label>]`

Nodes in the agent-turn statuses: `awaiting_agent_breakdown`, `split_approved`, `awaiting_agent_spec`, `ready_for_pickup`, `evaluating_soft_block`, `pr_changes_requested`, `pr_base_moved`. Each task is annotated with its claim and every non-removed `firm_block`/`soft_block`/`reassess_after` edge targeting it (blocker title + status). A `reassess_after` edge from an unfinished source lands the task in "not recommended", exactly like a firm block — it's deferred for re-judgment until the source resolves.

`human_only_action` is a human turn, so those nodes never appear here at all — they are work no agent can do. A firm block *from* one reads as unfinished until the human marks it `done`, which is exactly right: nothing downstream can move.

**Stale** nodes — an ancestor via subtask edges is currently `invalidated` (derived at read time via the `stale_node_ids` RPC, never stored) — are excluded entirely: they are dead until the invalidated ancestor is restored, at which point they reappear automatically. `aj context` still serves them in full.

Two sections — nothing actionable is ever hidden:

- **RECOMMENDED** — pickable now. Soft-blocked tasks stay here but carry a visible soft-block warning (pick up only if nothing better to do).
- **NOT RECOMMENDED** — firm-blocked by a not-`done` blocker, or claimed by someone else; the reason is printed.

`--session <label>`: if you claimed nodes under a stable label, pass it so your own claims aren't classed as "claimed by someone else".

```sh
aj tasks -p "My App"
aj tasks --json
```

### `aj context <node>`

Everything an agent needs before working a node:

- the node's fields, body, spec, PR link — with **loud** `!! STALE` / `!! INVALIDATED: <reason>` warnings (stale is derived server-side: an ancestor is currently invalidated),
- ancestor chain up to the vision node (statuses, derived stale flags, invalidation reasons),
- children, blockers, and all edges (including removed ones),
- **all thread messages grouped by stage**,
- the latest canvas PNG of the node **and each ancestor** that has one, downloaded to `<os-tmpdir>/agentjira/<node-id>/<owner-node-id>.png` — the local file paths are printed prominently. **Read those image files**; canvases are primary context.

```sh
aj context 3f2a1b
```

### `aj claim <node> [--session <label>] [--force]` / `aj unclaim <node>`

Claim before working; unclaim when stopping mid-stage. Default label is `hostname:pid`; pass `--session` for a stable label if you'll run `aj` repeatedly in one working session. Claiming a node already claimed under a *different* label fails unless `--force`. `unclaim` clears both `claimed_by` and `claimed_at`.

You rarely need `unclaim` explicitly: any status change that hands the turn away from the agent (`spec_review`, `split_proposed`, `awaiting_human_response`, `pr_raised`, `broken_down`, `done`, `invalidated`) clears the claim in the database, whether the write came from `aj` or from the `github-sync` webhook. `unclaim` is for abandoning a node *without* moving its status.

```sh
aj claim 3f2a1b --session laptop:feature-x
aj unclaim 3f2a1b
```

### `aj post <node> --type <message_type> --body <text> [--stage <status>]`

Post a message (author_role `agent`). Stage defaults to the node's current status. Types: `note`, `question`, `answer`, `split_proposal`, `split_decision`, `spec_submission`, `review_comment`, `system`.

`--type question` **also flips the node to `awaiting_human_response`** — ask early instead of guessing.

```sh
aj post 3f2a1b --type question --body "Should auth use magic links or passwords?"
aj post 3f2a1b --type note --body "Starting implementation on branch feat/login"
```

### `aj propose-split <node> --body <text>`

Posts a `split_proposal` message and sets the node to `split_proposed` (the human approves/rejects from the UI). The proposal message is staged at `split_proposed` so it sits in the same thread as the human's `split_decision`.

```sh
aj propose-split 3f2a1b --body "1. API schema (firm-blocks 2,3)
2. Login page
3. Session middleware"
```

### `aj create-node -p <project> --title <t> [--body <b>] [--parent <node>] [--status <s>] [--breakdown-on-merge]`

Create a node (default status `awaiting_agent_breakdown`). With `--parent`, also creates a `subtask` edge parent → new node. Used when materializing an approved split — afterwards set the parent to `broken_down`. `--breakdown-on-merge` marks a plan-deliverable node up front (see `aj set-breakdown-on-merge`).

`--status human_only_action` splits out work only a person can do — account signup, payment, a third-party dashboard, anything physical. That node never appears in `aj tasks`; the human does it and marks it `done`. Firm-block whatever it holds up with a `firm_block` edge from it, and carry on with other work rather than waiting.

```sh
aj create-node -p "My App" --title "API schema" --parent 3f2a1b
aj create-node -p "My App" --title "Tiny fix" --status awaiting_agent_spec
aj create-node -p "My App" --title "Create the Stripe account" --status human_only_action
```

### `aj add-edge --type <edge_type> --from <node> --to <node>`

Create an edge; reading is always **source → target**. Types: `subtask`, `firm_block`, `firm_block_plan`, `soft_block`, `soft_block_plan`, `reassess_after`, `relates_to`. Both nodes must be in the same project. The `_plan` variants gate like their base type only until the source's **plan lands** (source `done`, `broken_down`, OR `merge_sha` recorded) — use them when the target depends on the source's decision/plan, not on its full implementation. `broken_down` counts: the approved split *is* the decision, materialized. (A PLAIN block from a `broken_down` source is a coarse block instead — it keeps gating until that source's whole subtree completes.)

```sh
aj add-edge --type firm_block --from 9a8b7c --to 3f2a1b   # 9a8b7c firm-blocks 3f2a1b
```

### `aj submit-spec <node> (--file <path> | --body <text>)`

Set the node's `spec`, move it to `spec_review`, and post a `spec_submission` message containing the spec text. Exactly one of `--file` / `--body`. Keep specs tiny and concise.

```sh
aj submit-spec 3f2a1b --file spec.md
aj submit-spec 3f2a1b --body "Add POST /login. Validate email+password against Supabase auth. Return session JWT."
```

### `aj set-status <node> <status>`

Direct status set, validated against the enum (invalid input lists all valid values). Escape hatch, and the standard way to route a small node from `awaiting_agent_breakdown` to `awaiting_agent_spec`, or a parent to `broken_down` after materializing children.

```sh
aj set-status 3f2a1b awaiting_agent_spec
```

### `aj set-breakdown-on-merge <node> [--off]`

Flag a **plan-deliverable** node — one whose PR lands a spec/plan document in the repo rather than finishing the work. When the flagged node's PR merges, `github-sync` routes it back to `awaiting_agent_breakdown` (still recording `merge_sha`) instead of `done`, so the planned work gets split into tasks with the merged document as the primary input. Set it before the PR merges. `--off` clears the flag.

```sh
aj set-breakdown-on-merge 3f2a1b
aj set-breakdown-on-merge 3f2a1b --off
```

### `aj link-pr <node> --url <u> --number <n>`

Set `pr_url`/`pr_number` and move the node to `pr_raised`. Backup for when the GitHub Action isn't installed in the repo.

```sh
aj link-pr 3f2a1b --url https://github.com/dan/my-app/pull/7 --number 7
```

### `aj invalidate <node> --reason <text>`

Calls the `invalidate_node` RPC: sets `invalidated` + the reason. Subtask descendants become **stale** — derived at read time, nothing is written to them — until this node is restored (restoring un-stales the whole subtree automatically). Firm-block targets are NOT affected; a blocker's status is already visible where blockers are listed. Invalidated nodes are permanent, first-class context.

```sh
aj invalidate 3f2a1b --reason "We switched to magic links; password flow is obsolete"
```

### `aj search -p <project> <query>`

Full-text search over nodes and messages (`search_all` RPC).

```sh
aj search -p "My App" "magic links"
```

## Notes

- Event logging is handled entirely by database triggers — the CLI never writes `events` rows itself.
- The CLI never deletes anything; history is permanent by design.
- `spec_submission` messages are staged at `spec_review`, and `split_proposal` messages at `split_proposed`, so each proposal sits in the same stage thread as the human's decision on it.
