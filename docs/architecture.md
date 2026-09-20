# AgentJira — Architecture Contract

This document is the single source of truth for names, enums, schemas, and API shapes shared across `supabase/`, `web/`, `cli/`, `plugin/`, and `gha/`. If you need a status, type, or column, it is defined here — do not invent variants. Product decisions behind all of this: `brief/decisions.md`.

## System shape

- **Supabase** is the entire backend: Postgres (+ RLS), Auth (email/password), Storage (canvas PNGs), one Edge Function (`github-sync`). No other server.
- **Agents are external**: Claude Code sessions use the `aj` CLI (which wraps supabase-js with the dedicated agent user's login). The board never calls an LLM.
- **Humans** use the Vite SPA, authenticated as the owner user.
- **GitHub**: a workflow template (`gha/agentjira.yml`) installed in each project repo reports PR state to `github-sync` (shared secret) and performs the merge on GitHub approval using the repo's own `GITHUB_TOKEN`.

## Core enums (exact strings, everywhere)

### `node_status`

| Status | Turn | Meaning |
|---|---|---|
| `human_braindump_needed` | human | Human must provide direction/context (vision nodes start here) |
| `awaiting_agent_breakdown` | agent | Agent should study context and either propose a split or route to spec |
| `awaiting_human_response` | human | Agent asked question(s); human must answer in the thread |
| `split_proposed` | human | Agent posted a `split_proposal` message; human must approve/reject |
| `split_approved` | agent | Human approved; agent must materialize child nodes + `subtask` edges, then set parent to `broken_down` |
| `broken_down` | none | Container node; work continues in children |
| `awaiting_agent_spec` | agent | Node is PR-sized; agent must write a tiny, concise spec |
| `spec_review` | human | Spec submitted; human approves (→ `ready_for_pickup`) or rejects (→ `awaiting_agent_spec` with a `review_comment`) |
| `ready_for_pickup` | agent | Cleared to build; an agent may claim and implement. Reached either via an approved spec (`spec_review` → here) **or** directly from `awaiting_agent_breakdown` when the breakdown agent judged the change routine enough to skip the spec (see routing note below). A spec-less node's `spec` is null; its contract is its title/body/thread |
| `human_only_action` | human | Work only a person can do — create an account, enter payment details, click through a third-party dashboard, plug something in, sign something. **Always a whole node, never a detour on another node.** The human does it and marks it `done` (or `invalidated`); there is no hand-back path, because no agent ever held it |
| `evaluating_soft_block` | agent | A soft-blocked node queued for the soft-block **judge** to decide: proceed, escalate to the human (→ `awaiting_human_response`), or defer for reassessment (a `reassess_after` edge). The board never calls an LLM — an external supervisor watches for this agent-turn status and dispatches a fresh, throwaway headless judge session; the supervisor stays deterministic and never reads the verdict. Off-rail side-loop, like `pr_changes_requested` |
| `pr_raised` | github | PR open; GitHub review is the approval gate; GHA merges and reports back |
| `pr_changes_requested` | agent | Reviewer requested changes / left inline comments; agent addresses them, then `aj resubmit` → `pr_raised`. Mirror of `awaiting_human_response` (human asked the agent, not the other way) |
| `pr_base_moved` | agent | Another PR in the project merged, so this node's open PR is behind main. The agent merges main in and checks what landed against the branch — a clean merge can still leave the change wrong or already done — then `aj resubmit` → `pr_raised`. Off-rail side loop, like `pr_changes_requested` |
| `done` | none | Merged (or completed); `merge_sha` recorded |
| `invalidated` | none | Marked wrong; `invalidation_reason` recorded; kept forever as context |

Separate from status: **stale** and `claimed_by`/`claimed_at` (an agent session is actively working the node — simple flag, human unsticks from UI).

**Claims are released automatically on handoff.** A `before update of status` trigger on `nodes` clears `claimed_by`/`claimed_at` whenever the status moves to one whose turn owner (column 2 above) is not `agent` — so a claim survives an agent moving through its own stages, and drops the moment the node becomes the human's, GitHub's, or nobody's. `pr_raised` releases: review runs for hours or days, long after the claiming session's PID has exited. The mapping is `status_turn_owner(node_status)`, the single source of truth in SQL for the table above. A claim written explicitly in the *same* `UPDATE` as a status change always wins — the trigger only clears claims the caller didn't touch. `aj unclaim` remains for stopping mid-stage, when the status doesn't change.

**Stale is derived-only, never persisted.** A node is **stale** iff its own status is NOT `invalidated` AND at least one ancestor via non-removed `subtask` edges (edge source = parent, target = child) has status `invalidated`. It is computed at read time everywhere (server-side: `stale_node_ids` / `node_context`; web graph derives the same set client-side). Stale nodes are dead until restored: they render with the invalidated treatment plus an amber STALE badge, are hidden by the graph's hide-toggle, and are excluded from the agent pickup list (`aj tasks`). Restoring the invalidated ancestor automatically un-stales the whole subtree — zero writes. "Invalidated" is reserved for nodes explicitly invalidated (persisted status + reason); stale is the one and only derived concept. **Blocks never affect staleness** — no block edge, whatever its type or its source's status, can ever make a node stale; staleness propagates only DOWN non-removed `subtask` edges. The reverse direction is a different rule and does exist: a blocker that is itself `invalidated` or stale is a **dead blocker** and stops gating its target (see the edge-type table below). Dead-ness travels from blocker to target; staleness never does.

Routing from `awaiting_agent_breakdown` is agent judgment: big → propose split; PR-sized → decide whether a spec is worthwhile ("would human guidance on the plan help here?") — if yes, `aj set-status <id> awaiting_agent_spec` and write the spec; if the change is routine and self-evident, skip straight to `ready_for_pickup` and build (the PR review is then the only human gate). **Security-relevant work — auth, secrets, permissions, RLS, migrations, config — always gets a spec and is never skipped.** The `awaiting_agent_breakdown → ready_for_pickup` skip is a legal transition (there is no DB transition whitelist); because `ready_for_pickup` is an agent turn, the claim-release trigger keeps the agent's claim across it.

**Human-only work is split out, never waited on** (`human_only_action`). Some steps are blocked on being a person, not on judgment or information: registering an account, paying for something, clicking through a third-party console, physical setup. The rule is that such a step becomes **its own node** in `human_only_action`, and the work it holds up is blocked on it with a `firm_block` edge (source = the human node) — exactly like any other dependency. An agent never parks its own node to wait for a human to act; that node either continues (if the human step isn't actually in its way) or sits firm-blocked with the reason visible on the graph. Because the status is a human turn, `aj tasks` never offers it to an agent and the 0011 claim-release trigger drops any claim on entry.

These nodes should be **predicted, not discovered**: breakdown and spec are where they are cheap to spot, so a split proposal names the human-only children up front and the human sees their own queue from the start. Hitting one mid-implementation is the fallback, not the plan — the agent then splits it out, blocks its own node on it, and moves to other work rather than stalling. Terminal by hand: the human marks it `done` when the thing is done (or `invalidated` if it turns out to be unnecessary); nothing auto-advances, and dependents unblock via the ordinary edge rule.

**Plan-deliverable nodes** (`nodes.breakdown_on_merge = true`): the node's PR lands a spec/plan **document** in the repo rather than finishing the work. On `pr_merged`, `github-sync` routes the node back to `awaiting_agent_breakdown` (still recording `merge_sha`) instead of `done`, so the planned work gets split into tasks with the merged document as the primary input. Not a new status — the node re-enters the existing breakdown stage. The flag is set before the merge: agent via `aj set-breakdown-on-merge <node>` (or `aj create-node --breakdown-on-merge`), human via the toggle on the node's Spec/PR tab. Nodes that depend only on a node's **decision** (not the follow-up implementation) should be blocked with the `_plan` edge variants (`firm_block_plan`/`soft_block_plan`), which stop gating once the plan lands — a plain block would re-arm when the node re-enters breakdown and stay armed through `broken_down` until the whole subtree completed. The `_plan` variants are not exclusive to `breakdown_on_merge` nodes: reaching `broken_down` also lands the decision (the approved split *is* it), so a `_plan` edge from any node that gets broken down is satisfied at that point.

### `edge_type` — reading is always **source → target**

| Type | source → target reads |
|---|---|
| `subtask` | target is a subtask (child) of source |
| `firm_block` | source firm-blocks target (target ideally waits for source) |
| `firm_block_plan` | source firm-blocks target **until source's plan lands** — satisfied once source is `done`, `broken_down`, OR has a `merge_sha` recorded; from then on it is context, not a gate. `broken_down` satisfies it because the approved split **is** the decision, materialized: a source broken down without a plan-document PR reaches neither `done` nor a `merge_sha`, so the edge would otherwise gate its target permanently. (Contrast the plain variants, which from a `broken_down` source are *coarse* blocks and keep gating until the whole subtree completes.) Use when the target depends on the source's decision/plan, not its full implementation (companion to `breakdown_on_merge`, whose re-entry to breakdown would otherwise re-arm a plain block forever). If the target also needs a particular child's implementation, that is a new explicit block edge on that child |
| `soft_block` | source soft-blocks target (shared decisions; pick up target only if sensible and nothing else to do) |
| `soft_block_plan` | soft variant of the same: soft-blocks target until source's plan lands (same satisfaction rule — `done` / `broken_down` / `merge_sha`), then context only |
| `reassess_after` | target should be **reassessed after** source resolves. Behaves exactly like a `firm_block` while source is not `done` (target held back from pickup / graph frontier), then the target should be re-judged (typically re-entering `evaluating_soft_block`). A firm block that means "come back to this", not "wait forever" |
| `relates_to` | contextual link |

**Dead blockers never gate.** A blocker is **dead** iff its own status is `invalidated`, OR it is **stale** (the definition above: reachable from an invalidated node via non-removed `subtask` edges — server-side `stale_node_ids`, web-side `effectivelyInvalidated`). **A dead blocker no longer gates its target**, for every block-family edge type: `firm_block`, `soft_block`, `firm_block_plan`, `soft_block_plan`, `reassess_after`. The reason is that a dead node can never reach `done` — `invalidated` is terminal, and a stale node is dead until its ancestor is restored — so the plain "satisfied when the source is `done`" rule would park the target forever, with no release short of hand-removing the edge.

Evaluate **dead first**, before the plan-variant and coarse/`broken_down` rules: a stale `broken_down` blocker then needs no `subtree_complete` lookup, and a `merge_sha` on an invalidated node is moot. Like staleness, this is **derived at read time — nothing is written**: `invalidate_node` still touches only the node itself, the edge is never removed or re-typed, and restoring the invalidated node instantly re-arms every block it was carrying. A dead blocker's edge **renders normally** (no fading, no hiding, no new styling — that treatment is reserved for satisfied plan blocks) and the blocker stays listed in every blockers list with its status visible, because a dead dependency and its invalidation reason are exactly the context the next reader needs.

No cycle enforcement anywhere. All graph traversals MUST carry a visited-set and a depth cap of 50. Blocks are information for agents, never hard DB constraints.

### `message_type`

`note` · `question` · `answer` · `split_proposal` · `split_decision` · `spec_submission` · `review_comment` · `system`

### `author_role` / actor role: `human` · `agent` · `system`

## Database schema (Postgres, migrations in `supabase/migrations/`)

All tables have RLS enabled. Extensions: `pgcrypto`.

```sql
-- helper: is the current user a member of this project? (security definer)
create function is_project_member(p uuid) returns boolean ...

projects (
  id uuid pk default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 200),
  repo_owner text,            -- one repo per project, nullable until linked
  repo_name text,
  webhook_secret text not null default encode(gen_random_bytes(32), 'hex'),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  archived_at timestamptz            -- soft-archive; null = active. "Delete" = archive (reversible); history kept, hard delete forbidden
)

project_members (
  project_id uuid not null references projects(id),
  user_id uuid not null references auth.users(id),
  role text not null check (role in ('owner','agent')),
  primary key (project_id, user_id)
)

nodes (
  id uuid pk default gen_random_uuid(),
  project_id uuid not null references projects(id),
  title text not null check (char_length(title) between 1 and 300),
  body text not null default '',
  status node_status not null default 'human_braindump_needed',
  is_vision boolean not null default false,
  spec text,
  pr_url text, pr_number integer, merge_sha text,
  breakdown_on_merge boolean not null default false,  -- plan-deliverable: pr_merged → awaiting_agent_breakdown, not done
  invalidation_reason text,
  claimed_by text, claimed_at timestamptz,
  tldraw_doc jsonb,
  canvas_png_path text,       -- storage path of latest snapshot
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  fts tsvector generated always as (to_tsvector('english',
    coalesce(title,'') || ' ' || coalesce(body,'') || ' ' ||
    coalesce(spec,'') || ' ' || coalesce(invalidation_reason,''))) stored
)  -- GIN index on fts; index on (project_id, status)

edges (
  id uuid pk default gen_random_uuid(),
  project_id uuid not null references projects(id),
  source_id uuid not null references nodes(id),
  target_id uuid not null references nodes(id),
  type edge_type not null,
  removed_at timestamptz,     -- edges are never deleted, only flagged removed
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  check (source_id <> target_id)
)

messages (
  id uuid pk default gen_random_uuid(),
  node_id uuid not null references nodes(id),
  project_id uuid not null references projects(id),
  stage node_status not null,          -- thread scope = node + stage when posted
  author_role text not null check (author_role in ('human','agent','system')),
  author_id uuid references auth.users(id),
  type message_type not null,
  body text not null,
  created_at timestamptz not null default now(),
  fts tsvector generated always as (to_tsvector('english', coalesce(body,''))) stored
)

events (  -- append-only audit log
  id bigint generated always as identity pk,
  project_id uuid not null,
  node_id uuid,
  actor_id uuid,
  actor_role text not null check (actor_role in ('human','agent','system')),
  type text not null,        -- e.g. node.created, node.status_changed, node.claimed,
                              --      node.invalidated, edge.created, message.posted,
                              --      pr.opened, pr.merged, canvas.snapshot,
                              --      project.archived, project.unarchived (node_id null).
                              --      node.marked_stale is HISTORICAL: no longer emitted
                              --      since staleness became derived-only; old rows remain
                              --      forever (history is sacred)
  data jsonb not null default '{}',
  created_at timestamptz not null default now()
)
```

### Triggers & rules

- `BEFORE DELETE` triggers on `nodes`, `edges`, `messages`, `events` **raise an exception** — history is permanent.
- `BEFORE UPDATE` on `events` raises — append-only.
- `nodes` `BEFORE UPDATE`: maintain `updated_at`.
- `AFTER INSERT/UPDATE` on `nodes`, `AFTER INSERT` on `edges`/`messages`: write an `events` row (on node update, log changed fields; always log status transitions as `node.status_changed` with `{from, to}`).
- `AFTER INSERT` on `projects`: add creator to `project_members` as `owner`, and create the **vision node** (`is_vision = true`, title = project name, status `human_braindump_needed`).
- `AFTER UPDATE` on `projects`: when `archived_at` changes, log a `project.archived` / `project.unarchived` event (`node_id` null).

### RPCs (security invoker unless noted)

- `invalidate_node(p_node uuid, p_reason text)` — sets `status='invalidated'`, `invalidation_reason`, and logs a `node.invalidated` event. That is all: nothing is marked or written on any other node (staleness is derived at read time), and no `node.marked_stale` event is emitted (that event type is historical). **No edge is touched either** — yet every node this one blocks stops being gated, because the block-family edges out of it now read as **dead blockers** (see the edge-type table). That release is derived at read time exactly like staleness, so restoring the node re-arms those blocks with no further write.
  - **Stale semantics**: see the definition under the status table — descendants via non-removed `subtask` edges of an invalidated node read as **stale** (derived), full stop.
  - **Restore** (reverse an invalidation): update the node to its pre-invalidation status — default the `from` of the latest `node.status_changed` event with `to = 'invalidated'`, human may override — and set `invalidation_reason = null`. The update trigger logs the change; nothing is deleted.
  - Restoring the node automatically un-stales every descendant that was stale because of it, and re-arms every block edge out of it (it stops being a **dead blocker**) — both are derived, so the restore itself is the only write.
- `stale_node_ids(p_project uuid) returns setof uuid` — the project's derived stale set: BFS down from every node with status `invalidated` via non-removed `subtask` edges (visited-set, depth ≤ 50); returns reachable node ids whose own status is not `invalidated`. Security invoker (RLS applies), `stable`.
- `search_all(p_project uuid, p_query text)` — FTS (`websearch_to_tsquery`) over `nodes.fts` and `messages.fts`, returns unified rows `(kind, node_id, title, snippet, rank)`.
- `node_context(p_node uuid)` — returns JSON: the node, its edges (both directions, incl. removed), ancestor chain via subtask edges up to the vision node (id, title, status, stale, invalidation_reason), children, and blockers with their statuses (sources of non-removed `firm_block`/`soft_block`/`firm_block_plan`/`soft_block_plan`/`reassess_after` edges, each carrying its `block_type` and `merge_sha` so plan-variant satisfaction — "plan landed" — is computable by callers). Every `stale` field in the response is the DERIVED value (membership in `stale_node_ids`); the JSON field name `stale` is part of the contract. Depth-capped, cycle-safe.

### RLS policy pattern

- `projects`: select where member **or creator** (`created_by = auth.uid()` — needed because `INSERT ... RETURNING` checks the select policy before the AFTER-INSERT bootstrap trigger has written the owner-membership row); insert where `created_by = auth.uid()`; update where member role `owner`. **Archiving** ("delete a project") is just the owner setting `archived_at` via that update policy — reversible (`archived_at = null` unarchives), no new policy; archived projects stay SELECT-able so the owner can list/unarchive them, and the web UI filters them out of the default list. **`webhook_secret` is never exposed to the agent role** — simplest: a view or column privilege revoke for non-owners is overkill for v1; instead the web UI (owner) reads it, and the CLI never selects it.
- All child tables (`nodes`, `edges`, `messages`): select/insert/update where `is_project_member(project_id)`. No delete policies (plus the raise-trigger belt-and-braces).
- `events`: select/insert where member; no update/delete.
- `project_members`: select where member; insert/update only by project owner (so the owner adds the agent user to each project by email/id from the web UI).
- Storage bucket `canvases`: private; read/write for authenticated users who are members of the node's project (enforce via storage policy on path prefix `project_id/`). Path convention: `{project_id}/{node_id}/{ISO-timestamp}.png`.

### Seed (`supabase/seed.sql`)

Local-dev convenience: create `dan@agentjira.local` (owner) and `agent@agentjira.local` (agent), password `agentjira-dev`, one sample project (trigger creates its vision node), agent added as member.

## Edge Function: `github-sync`

`POST /functions/v1/github-sync` — called only by the GHA. Auth: header `x-agentjira-secret` must equal the project's `webhook_secret` (looked up via the node's project; function uses the service-role key internally, bypassing RLS).

```jsonc
{
  "node_id": "<uuid>",          // extracted from the PR body marker
  "action": "pr_opened" | "pr_approved" | "pr_changes_requested" | "pr_merged" | "pr_closed",
  "pr_url": "https://github.com/o/r/pull/7",
  "pr_number": 7,
  "repo": "owner/name",
  "merge_sha": "<sha>",         // pr_merged only
  "actor": "github-login",
  "review_body": "...",         // pr_changes_requested only — reviewer's summary
  "review_comments": "...",     // pr_changes_requested only — formatted inline comments
  "review_url": "https://github.com/o/r/pull/7#pullrequestreview-1"  // pr_changes_requested only
}
```

Effects: `pr_opened` → set `pr_url`/`pr_number`, status `pr_raised`. `pr_changes_requested` → status `pr_changes_requested`, and the review lands on the thread as a **`review_comment`** message (verbatim summary + inline comments + link) so agents work it from the board without leaving for GitHub — this hands the turn back to the agent. `pr_merged` → set `merge_sha`; status `done`, **unless the node has `breakdown_on_merge`** — then status `awaiting_agent_breakdown` (plan-deliverable: the merged document gets split into tasks), applied only while the node is still `pr_raised`/`pr_changes_requested` so a duplicate merge report never clobbers post-merge progress (re-setting `done` stays idempotent as before). `pr_merged` additionally **sweeps the project**: every other node still in `pr_raised` moves to `pr_base_moved` with a `system` message, because main just moved under their open PRs. `pr_approved`/`pr_closed` → event + system message only (no status change; a closed-unmerged PR is for humans/agents to triage). Every call logs an `events` row and posts a message to the node at its (new) stage (`system` type, except `pr_changes_requested` which posts `review_comment`). Unknown node or bad secret → 401/404, no detail leaked.

## Agent PR identity (`github-token` Edge Function)

Agents must open PRs as a **GitHub App** (`agentjira[bot]`), never as the operator — GitHub forbids approving your own PR, so the PR author must differ from the human reviewer. (A GitHub App can open and comment on PRs but **cannot submit an approving review**; that is fine because the human approves. An agent-approver would need a separate bot *user* account, out of scope.)

`POST /functions/v1/github-token` — called by the CLI (`aj github-token`). Auth: the caller's Supabase JWT (the agent user); the function runs every query under that token so **RLS enforces project membership** (a non-member sees no node → 404). Body: `{ "node_id": "<uuid>" }`.

The app's private key lives only in this function, as Function secrets:

- `GITHUB_APP_ID` — the app's numeric ID (or client id), used as the JWT `iss`.
- `GITHUB_APP_PRIVATE_KEY` — the app private key, **PKCS#8 PEM** (`BEGIN PRIVATE KEY`; WebCrypto rejects the PKCS#1 `BEGIN RSA PRIVATE KEY` GitHub hands out — convert with `openssl pkcs8 -topk8 -inform PEM -nocrypt -in app.pem`).

Flow: sign a short-lived (~10 min) app JWT (RS256) → `GET /repos/{owner}/{repo}/installation` to resolve the installation for the node's project repo (no DB column needed) → `POST /app/installations/{id}/access_tokens` scoped to that one repo with `contents: write` + `pull_requests: write`. Response: `{ token, expires_at }` — a ~1h token the agent uses for `git push` and PR creation. Errors: repo not linked → 400; app not installed on the repo → 400; GitHub failures → 502; the token is never logged.

**Per-repo setup:** install the GitHub App on each project repo, and enable branch protection requiring **1 approving review** so the human review is the enforced merge gate (the GHA's merge-on-approval job is unchanged).

## PR body convention (agents MUST follow)

```
Implements AgentJira node: <web-app-url>/n/<node-uuid>

AgentJira-Node: <node-uuid>
```

The GHA greps `AgentJira-Node: <uuid>` (last occurrence wins). PR titles: `[AJ] <node title>`.

## GHA template (`gha/agentjira.yml`)

Installed in each project repo. Repo secrets: `AGENTJIRA_SYNC_URL` (edge function URL), `AGENTJIRA_SECRET` (the project's `webhook_secret`). Jobs:

1. **report** — on `pull_request` (opened, reopened, ready_for_review) and `pull_request_review` (submitted) and `pull_request` closed: extract marker; POST the matching action (`pr_opened` / `pr_approved` / `pr_merged` when `merged == true` / `pr_closed`). On a non-approving review it reads the review's inline comments via `gh api` (needs `pull-requests: read`) and POSTs `pr_changes_requested` — carrying the review body, formatted inline comments, and review URL — when the review **requested changes** OR left **any inline comment**. A bare "Comment" review with no inline notes is informational and skipped.
2. **merge** — on `pull_request_review` submitted+approved: if marker present and PR is mergeable, wait for check suites to succeed (poll via `gh api`, timeout ~20 min), then `gh pr merge --squash` using `GITHUB_TOKEN`, then POST `pr_merged` with the merge SHA. (The `pull_request.closed` report job also fires as backup when merges happen manually — dedupe is server-side idempotent: setting `done` twice is harmless.)

## CLI: `aj` (package `agentjira-cli`, bin `aj`)

Node 22 + TypeScript + commander + `@supabase/supabase-js`. Config resolution: env vars `AGENTJIRA_URL`, `AGENTJIRA_ANON_KEY`, `AGENTJIRA_EMAIL`, `AGENTJIRA_PASSWORD` first, else `~/.agentjira/config.json` (same keys, lowercase). Session token cached in `~/.agentjira/session.json`. Every command supports `--json` for machine-readable output; default output is compact human/agent-readable text. Node ids may be given as full uuid or unique prefix (≥ 6 chars; resolve via `like`).

| Command | Behavior |
|---|---|
| `aj whoami` | Current user + role |
| `aj projects` | List member projects |
| `aj tasks [-p <project>]` | Nodes in agent-turn statuses (`awaiting_agent_breakdown`, `split_approved`, `awaiting_agent_spec`, `ready_for_pickup`, `evaluating_soft_block`, `pr_changes_requested`), each annotated: claimed_by, block-family blockers (firm/soft, their `_plan` variants, reassess_after) and blocker statuses. **Stale nodes are excluded** (derived via `stale_node_ids` — dead until the invalidated ancestor is restored). Firm-blocked-by-not-done, reassess_after-gated-by-not-done, and claimed-by-someone-else shown in a separate "not recommended" section, never hidden (a `reassess_after` gate is treated exactly like a firm block). A **dead** blocker (own status `invalidated`, or stale) stops gating outright — checked FIRST, annotated "DEAD", carried in `--json` as `dead: true` so a dead blocker is distinguishable from a finished one. Otherwise: plan-variant blocks stop gating once the blocker's plan lands (blocker `done`, `broken_down`, OR `merge_sha` recorded) — annotated "PLAN LANDED" instead of unfinished; a PLAIN block on a `broken_down` blocker is a coarse block instead, gating until that blocker's subtree is complete (`subtree_complete`) |
| `aj context <node>` | Full context dump: node fields, spec, ancestor chain (statuses, derived stale, invalidation reasons), children, edges, all thread messages grouped by stage, blockers (each annotated: a **dead** blocker — invalidated or stale — as no longer gating, checked first; a `_plan` blocker as PLAN LANDED or still gating; a plain block on a `broken_down` blocker as a coarse block, gating until its subtree completes); downloads latest canvas PNGs of the node **and its ancestors** to a temp dir and prints the file paths (agents then Read the images). Serves everything, including stale/invalidated nodes — that contract never changes |
| `aj claim <node> [--session <label>]` / `aj unclaim <node>` | Set/clear `claimed_by` (default label `hostname:pid`); claim refuses (without `--force`) if already claimed |
| `aj post <node> --type <message_type> --body <text> [--stage <status>]` | Post a message (stage defaults to node's current status). `--type question` also flips status → `awaiting_human_response` |
| `aj propose-split <node> --body <text>` | Posts `split_proposal` message + status → `split_proposed` |
| `aj create-node -p <project> --title <t> [--body <b>] [--parent <node>] [--status <s>] [--breakdown-on-merge]` | Create node (+ `subtask` edge from parent). Default status `awaiting_agent_breakdown`; `--status human_only_action` is how an agent splits out work only a person can do (then `aj add-edge --type firm_block` from it to whatever it holds up) |
| `aj add-edge --type <edge_type> --from <node> --to <node>` | Create edge |
| `aj submit-spec <node> (--file <path> \| --body <text>)` | Set `spec` + status → `spec_review`, post `spec_submission` message |
| `aj set-status <node> <status>` | Direct status set (validated against enum) |
| `aj set-breakdown-on-merge <node> [--off]` | Set/clear `breakdown_on_merge` — flag a plan-deliverable node so `pr_merged` routes it back to `awaiting_agent_breakdown` instead of `done`. Set it before the PR merges |
| `aj link-pr <node> --url <u> --number <n>` | Set PR fields + status → `pr_raised` (backup for when the GHA isn't installed) |
| `aj resubmit <node> [--body <text>]` | After addressing PR review comments or reconciling with main, hand back to review: `pr_changes_requested` / `pr_base_moved` → `pr_raised`, posting a `note`. Refuses on any other status (`--force` overrides). The explicit round-trip so a WIP push never flips the turn |
| `aj github-token <node>` | Mint a short-lived (~1h), repo-scoped GitHub App installation token (contents+PR write) via the `github-token` function, so branches/PRs are authored by `agentjira[bot]` and the human can approve. Token → stdout, expiry → stderr |
| `aj invalidate <node> --reason <text>` | Calls `invalidate_node` RPC (descendants become stale — derived — until this node is restored; every node this one blocks stops being gated, because the block edges out of it now read as **dead** — also derived, no edge is written) |
| `aj search -p <project> <query>` | `search_all` RPC results |

Errors: nonzero exit + one-line message. Never swallow Supabase errors.

## Web app (`web/`)

Vite + React 18 + TypeScript strict + `react-router-dom` + `@supabase/supabase-js` + `@xyflow/react` (graph) + `@dagrejs/dagre` (auto-layout) + `tldraw` (canvas). Env: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` (`.env.example` provided).

`tldraw` is `React.lazy`-loaded by the node detail page's Canvas tab and must stay that way: it is ~4 MB of JS, and a static import puts it on every route including the graph, which is enough to get the tab killed on a phone. The graph view likewise selects an explicit column list (`GRAPH_NODE_COLUMNS` in `web/src/lib/types.ts`), never `*` — `tldraw_doc`, `body` and `spec` are not rendered there and grow without bound.

Routes: `/login` · `/` (projects list + create; owner can add agent member by user id/email; shows repo + webhook secret setup with GHA install instructions; **owner can archive a project** from its settings — a reversible soft-delete that hides it from the list while keeping all history — and unarchive from a "Show archived" section) · `/p/:projectId` (graph) · `/n/:nodeId` (node detail).

**Graph view**: dagre top-to-bottom layout over non-removed `subtask` + block-family edges (`firm_block`, `soft_block`, their `_plan` variants, `reassess_after`) (vision at top), weighted so hierarchy dominates — subtask weight 4, firm_block/firm_block_plan 2, reassess_after 2, soft_block/soft_block_plan 1 — which ranks a blocker above what it blocks, so block edges flow top-to-bottom instead of sideways; `relates_to` stays out of layout. All non-removed edges are rendered as bezier curves — `subtask` gray (thinner, faded scaffolding), `firm_block` solid red, `firm_block_plan` long-dashed red, `soft_block` dashed amber, `soft_block_plan` short-dashed amber, `reassess_after` dotted teal, `relates_to` dotted gray (faint). A **satisfied** plan-variant block (source's plan landed: `done`, `broken_down`, OR `merge_sha`) renders faded — it reads as context, not "wait". A block-family edge incident to a `broken_down` node is demoted (hidden from the drawn graph, still a layout ranking hint) — its subtasks carry the granular blocks. Cycle-safe, depth-capped traversal; back-edges are dropped from LAYOUT only and still rendered. Node cards encode turn by brightness (**bright = a human needs to act**): human-turn AND the github turn (`pr_raised`) render as light/bright status-colored cards with dark text — a raised PR is awaiting the human's review on GitHub, so it reads as human-attention — agent-turn as dark cards with the status color as border + left accent bar, `none` (`broken_down`/`done`) dark and muted. An unfinished firm-family gate (`firm_block` / `firm_block_plan` / `reassess_after`) overrides that brightness: any unclaimed agent-turn **or human-turn** node it holds — `human_only_action` included — gets the red BLOCKED badge and fades back with the other parked cards, because nobody should start it yet. A gate from a **dead** blocker (source invalidated or stale) is not a gate at all: it produces no BLOCKED badge, no fade-back, and no soft-block tag, and it does not count toward a container's "gates N nodes". Its **edge still draws exactly as normal** — same color, same dash, same opacity — so the dead relationship stays legible on the board; the faded treatment is reserved for satisfied plan blocks and cleared coarse gates. (Agent-facing `aj tasks` still lists agent-turn statuses only; human-turn gating is visible in the graph view alone.) Descendants of an invalidated node (via non-removed `subtask` edges) are **stale**: they render with the invalidated treatment (dimmed) plus the amber STALE badge while the pill keeps the node's own status label — derived in the view, never persisted, so restoring the ancestor un-stales them automatically. A "Hide invalidated & stale" toolbar toggle (default off, persisted per project in localStorage) filters invalidated + stale nodes and re-runs layout — a human-view convenience only; agents are always served invalidated context. When the toggle hides every node, an empty-state message is shown over the canvas instead of a blank graph. Legend always visible (teaches the light/dark treatment, edge styles, and badges). Live-ish via supabase realtime subscription or refetch-on-focus (either fine).

**Status colors** (the "brighter = human needed" rule, use everywhere incl. legend and node detail):

| Status | Color |
|---|---|
| `human_braindump_needed` | bright magenta `#e91e63` |
| `awaiting_human_response` | bright orange `#ff9800` |
| `split_proposed` | bright amber `#ffc107` |
| `spec_review` | bright yellow-green `#cddc39` |
| `human_only_action` | bright red `#fa5252` (no agent can ever move it — the loudest card on the board; the same red strokes `firm_block` edges, a different visual channel) |
| `awaiting_agent_breakdown` | muted blue `#5c7cfa` |
| `split_approved` | muted indigo `#4263eb` |
| `awaiting_agent_spec` | muted cyan `#22b8cf` |
| `ready_for_pickup` | muted teal `#12b886` |
| `evaluating_soft_block` | muted gold `#d9a441` (agent turn — the soft-block judge is deciding) |
| `pr_raised` | purple `#9775fa` (bright — awaiting the human's PR review) |
| `pr_changes_requested` | deep violet `#7048e8` (agent turn) |
| `pr_base_moved` | grape `#ae3ec9` (agent turn — a separate hue, not another violet, so the two PR side loops stay apart on a dark card's thin border) |
| `broken_down` | gray-blue `#748ffc` at 50% |
| `done` | muted green `#40c057` at 70% |
| `invalidated` | gray `#868e96` |

Stale (derived — ancestor currently invalidated) → amber `#f59f00` STALE corner badge (solid, top-right; dashed amber is reserved for `soft_block` edges) on top of the invalidated card treatment. `claimed_by` set → pulsing dot badge.

**Node detail**: a **stage-flow stepper** at the top renders the whole canonical pipeline (`human_braindump_needed` → `awaiting_agent_breakdown` → fork: split path `split_proposed` → `split_approved` → `broken_down`, spec path `awaiting_agent_spec` → `spec_review` → `ready_for_pickup` → `pr_raised` → `done`, or human-only path `human_only_action` → `done`), marking each step visited / current / skipped / future from the node's `node.status_changed` events; `awaiting_human_response`, `pr_changes_requested`, `evaluating_soft_block`, and `invalidated` render as off-rail chips anchored to the last on-rail status (invalidated dims the rail; `pr_changes_requested` anchors to `pr_raised` as a "reviewer requested changes" side loop; `evaluating_soft_block` is a "soft-block judge deciding" side loop). The stepper carries the single primary **next button** for the current status (braindump done → `awaiting_agent_breakdown`; answered → back to the status the question interrupted; `human_only_action` → `done`, since doing the work *is* the transition) or a cue pointing at the promoted Approve/Reject buttons; agent-turn (incl. `pr_changes_requested` and `evaluating_soft_block`), GitHub, and terminal statuses show a hint instead. Status pill + turn indicator; action buttons contextual to status (approve/reject split → sets `split_approved` / back to `awaiting_agent_breakdown` with a `split_decision` message; approve/reject spec → `ready_for_pickup` / `awaiting_agent_spec` + `review_comment`; invalidate with required reason → RPC; **restore** on invalidated nodes → back to the pre-invalidation status from events, human may override, clearing `invalidation_reason` — descendants un-stale automatically, nothing else is written; unclaim; manual set-status demoted into a collapsed "Advanced" escape hatch). Markdown body editor (plain textarea + save is fine). Tabs or sections: **Canvas** (tldraw; on save, persist `tldraw_doc` and export PNG → storage → update `canvas_png_path`, log `canvas.snapshot` event), **Threads** (messages grouped by `stage`, newest stage first, composer posts to current stage), **History** (events timeline, rendered readably), **Edges** (list + add-edge form + remove sets `removed_at`), **Spec/PR** (spec markdown, PR link out, and the `breakdown_on_merge` toggle — "plan deliverable: merged PR routes back to breakdown"; when the flag is set the node header shows a "↩ breakdown on merge" hint). Header breadcrumb: ancestor chain, each link colored by status, stale/invalidated ancestors visibly flagged — this is the "descendant of dead premise" warning.

Search box (project level) → `search_all`, results link to nodes.

Keep the UI clean but don't gold-plate: function over polish for v1.

## Claude Code plugin (`plugin/`)

Structure: `plugin/.claude-plugin/plugin.json` (name `agentjira`, description, version 0.1.0) and `plugin/skills/<name>/SKILL.md`:

- `agentjira-workflow` — the rulebook (trigger: any AgentJira work). Contents: the status machine table and whose turn it is; soft/firm block judgment rules (verbatim spirit: only pick up soft-blocked work if nothing else to do and it's not too much of a stretch); the block-type choice table (target needs the blocker's implementation → base `firm_block`/`soft_block`; only its decision/plan → `_plan` variant, satisfied once the plan lands — blocker `done`, `broken_down`, or `merge_sha`); claim etiquette (claim before working, unclaim when stopping); PR body marker convention; spec style (tiny, concise); always run `aj context` before working a node and **Read the downloaded canvas PNGs**; treat invalidated/stale ancestors as vital context; ask questions via `aj post --type question` early rather than guessing; depth cap 50.
- `aj-pickup` — procedure: `aj tasks` → choose sensibly (respect blocks) → `aj claim` → `aj context` → do the stage-appropriate work → post results → unclaim if stopping.
- `aj-breakdown` — procedure for `awaiting_agent_breakdown` and `split_approved` nodes: study context incl. canvases; propose concise split (`aj propose-split`) with numbered children, each with a one-line scope + suggested edges (firm/soft blocks between siblings, naming the base-vs-`_plan` variant and why, and flagging plan-deliverable children for `breakdown_on_merge`); after approval, materialize with `aj create-node --parent` (+ `--breakdown-on-merge` where flagged) + `aj add-edge`, set parent `broken_down`; route small nodes to `awaiting_agent_spec` instead.
- `aj-implement` — procedure for `ready_for_pickup`: claim, context, implement per spec on a branch, PR with the marker + `[AJ]` title, `aj link-pr` as backup, status handled by GHA thereafter. If the deliverable is a plan/spec document rather than working code, run `aj set-breakdown-on-merge <node>` before raising the PR so the merge routes back to breakdown.

Plugin README explains install (`/plugin` marketplace-from-dir or `--plugin-dir`) and CLI setup (env vars for the agent login).

## Non-negotiables checklist (all packages)

1. Exact enum strings from this file.
2. No hard deletes, ever.
3. Graph traversals: visited-set + depth cap 50 (cycles are legal data).
4. Agents get invalidated/stale context served to them, never filtered out (`aj context` serves everything; only the `aj tasks` pickup list excludes stale nodes — they are not actionable, not hidden context).
5. Secrets: webhook secret only in GHA repo secrets + `projects` row; anon key is public by design; service-role key only inside the Edge Function.
