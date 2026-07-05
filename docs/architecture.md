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
| `ready_for_pickup` | agent | Approved spec; an agent may claim and implement |
| `pr_raised` | github | PR open; GitHub review is the approval gate; GHA merges and reports back |
| `done` | none | Merged (or completed); `merge_sha` recorded |
| `invalidated` | none | Marked wrong; `invalidation_reason` recorded; kept forever as context |

Separate from status: `stale` (boolean flag — an ancestor was invalidated; premise needs re-checking) and `claimed_by`/`claimed_at` (an agent session is actively working the node — simple flag, human unsticks from UI).

Routing from `awaiting_agent_breakdown` is agent judgment: big → propose split; small enough → `aj set-status <id> awaiting_agent_spec` and write the spec.

### `edge_type` — reading is always **source → target**

| Type | source → target reads |
|---|---|
| `subtask` | target is a subtask (child) of source |
| `firm_block` | source firm-blocks target (target ideally waits for source) |
| `soft_block` | source soft-blocks target (shared decisions; pick up target only if sensible and nothing else to do) |
| `relates_to` | contextual link |

No cycle enforcement anywhere. All graph traversals MUST carry a visited-set and a depth cap of 50. Blocks are information for agents, never hard DB constraints.

### `message_type`

`note` · `question` · `answer` · `split_proposal` · `split_decision` · `spec_submission` · `review_comment` · `system`

### `author_role` / actor role: `human` · `agent` · `system`

## Database schema (Postgres, one migration `0001_init.sql`)

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
  created_at timestamptz not null default now()
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
  stale boolean not null default false,
  is_vision boolean not null default false,
  spec text,
  pr_url text, pr_number integer, merge_sha text,
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
                              --      pr.opened, pr.merged, canvas.snapshot
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

### RPCs (security invoker unless noted)

- `invalidate_node(p_node uuid, p_reason text)` — sets `status='invalidated'`, `invalidation_reason`; then walks **descendants** (via non-removed `subtask` edges) and **firm-block targets**, recursively (visited-set, depth ≤ 50), setting `stale = true` on every node not already `done`/`invalidated`… including `done` ones getting `stale=true` too (a merged premise can still be stale). Logs `node.invalidated` + `node.marked_stale` events.
  - **Invalidation semantics**: a node is **effectively invalidated** if its own status is `invalidated` OR any ancestor via non-removed `subtask` edges is invalidated. Inherited invalidation is derived at read time — nothing is written to descendants.
  - **Restore** (reverse an invalidation): update the node to its pre-invalidation status — default the `from` of the latest `node.status_changed` event with `to = 'invalidated'`, human may override — and set `invalidation_reason = null`. The update trigger logs the change; nothing is deleted.
  - Restoring an ancestor automatically un-invalidates every descendant that was only inherited-invalidated. `stale` flags are NOT auto-cleared by a restore — premises still need re-checking.
- `search_all(p_project uuid, p_query text)` — FTS (`websearch_to_tsquery`) over `nodes.fts` and `messages.fts`, returns unified rows `(kind, node_id, title, snippet, rank)`.
- `node_context(p_node uuid)` — returns JSON: the node, its edges (both directions, incl. removed), ancestor chain via subtask edges up to the vision node (id, title, status, stale, invalidation_reason), children, and blockers with their statuses. Depth-capped, cycle-safe.

### RLS policy pattern

- `projects`: select where member; insert where `created_by = auth.uid()`; update where member role `owner`. **`webhook_secret` is never exposed to the agent role** — simplest: a view or column privilege revoke for non-owners is overkill for v1; instead the web UI (owner) reads it, and the CLI never selects it.
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
  "action": "pr_opened" | "pr_approved" | "pr_merged" | "pr_closed",
  "pr_url": "https://github.com/o/r/pull/7",
  "pr_number": 7,
  "repo": "owner/name",
  "merge_sha": "<sha>",         // pr_merged only
  "actor": "github-login"
}
```

Effects: `pr_opened` → set `pr_url`/`pr_number`, status `pr_raised`. `pr_merged` → status `done`, set `merge_sha`. `pr_approved`/`pr_closed` → event + system message only (no status change; a closed-unmerged PR is for humans/agents to triage). Every call logs an `events` row and posts a `system` message to the node at its current stage. Unknown node or bad secret → 401/404, no detail leaked.

## PR body convention (agents MUST follow)

```
Implements AgentJira node: <web-app-url>/n/<node-uuid>

AgentJira-Node: <node-uuid>
```

The GHA greps `AgentJira-Node: <uuid>` (last occurrence wins). PR titles: `[AJ] <node title>`.

## GHA template (`gha/agentjira.yml`)

Installed in each project repo. Repo secrets: `AGENTJIRA_SYNC_URL` (edge function URL), `AGENTJIRA_SECRET` (the project's `webhook_secret`). Jobs:

1. **report** — on `pull_request` (opened, reopened, ready_for_review) and `pull_request_review` (submitted) and `pull_request` closed: extract marker; POST the matching action (`pr_opened` / `pr_approved` / `pr_merged` when `merged == true` / `pr_closed`).
2. **merge** — on `pull_request_review` submitted+approved: if marker present and PR is mergeable, wait for check suites to succeed (poll via `gh api`, timeout ~20 min), then `gh pr merge --squash` using `GITHUB_TOKEN`, then POST `pr_merged` with the merge SHA. (The `pull_request.closed` report job also fires as backup when merges happen manually — dedupe is server-side idempotent: setting `done` twice is harmless.)

## CLI: `aj` (package `agentjira-cli`, bin `aj`)

Node 22 + TypeScript + commander + `@supabase/supabase-js`. Config resolution: env vars `AGENTJIRA_URL`, `AGENTJIRA_ANON_KEY`, `AGENTJIRA_EMAIL`, `AGENTJIRA_PASSWORD` first, else `~/.agentjira/config.json` (same keys, lowercase). Session token cached in `~/.agentjira/session.json`. Every command supports `--json` for machine-readable output; default output is compact human/agent-readable text. Node ids may be given as full uuid or unique prefix (≥ 6 chars; resolve via `like`).

| Command | Behavior |
|---|---|
| `aj whoami` | Current user + role |
| `aj projects` | List member projects |
| `aj tasks [-p <project>]` | Nodes in agent-turn statuses (`awaiting_agent_breakdown`, `split_approved`, `awaiting_agent_spec`, `ready_for_pickup`), each annotated: stale flag, claimed_by, firm/soft blockers and blocker statuses. Firm-blocked-by-not-done and claimed-by-someone-else shown in a separate "not recommended" section, never hidden |
| `aj context <node>` | Full context dump: node fields, spec, ancestor chain (statuses, stale, invalidation reasons), children, edges, all thread messages grouped by stage, blockers; downloads latest canvas PNGs of the node **and its ancestors** to a temp dir and prints the file paths (agents then Read the images) |
| `aj claim <node> [--session <label>]` / `aj unclaim <node>` | Set/clear `claimed_by` (default label `hostname:pid`); claim refuses (without `--force`) if already claimed |
| `aj post <node> --type <message_type> --body <text> [--stage <status>]` | Post a message (stage defaults to node's current status). `--type question` also flips status → `awaiting_human_response` |
| `aj propose-split <node> --body <text>` | Posts `split_proposal` message + status → `split_proposed` |
| `aj create-node -p <project> --title <t> [--body <b>] [--parent <node>] [--status <s>]` | Create node (+ `subtask` edge from parent). Default status `awaiting_agent_breakdown` |
| `aj add-edge --type <edge_type> --from <node> --to <node>` | Create edge |
| `aj submit-spec <node> (--file <path> \| --body <text>)` | Set `spec` + status → `spec_review`, post `spec_submission` message |
| `aj set-status <node> <status>` | Direct status set (validated against enum) |
| `aj link-pr <node> --url <u> --number <n>` | Set PR fields + status → `pr_raised` (backup for when the GHA isn't installed) |
| `aj invalidate <node> --reason <text>` | Calls `invalidate_node` RPC |
| `aj search -p <project> <query>` | `search_all` RPC results |

Errors: nonzero exit + one-line message. Never swallow Supabase errors.

## Web app (`web/`)

Vite + React 18 + TypeScript strict + `react-router-dom` + `@supabase/supabase-js` + `@xyflow/react` (graph) + `@dagrejs/dagre` (auto-layout) + `tldraw` (canvas). Env: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` (`.env.example` provided).

Routes: `/login` · `/` (projects list + create; owner can add agent member by user id/email; shows repo + webhook secret setup with GHA install instructions) · `/p/:projectId` (graph) · `/n/:nodeId` (node detail).

**Graph view**: dagre top-to-bottom layout over non-removed `subtask` + `firm_block` + `soft_block` edges (vision at top), weighted so hierarchy dominates — subtask weight 4, firm_block 2, soft_block 1 — which ranks a blocker above what it blocks, so block edges flow top-to-bottom instead of sideways; `relates_to` stays out of layout. All non-removed edges are rendered as bezier curves — `subtask` gray (thinner, faded scaffolding), `firm_block` solid red, `soft_block` dashed amber, `relates_to` dotted gray (faint). Cycle-safe, depth-capped traversal; back-edges are dropped from LAYOUT only and still rendered. Node cards encode turn by brightness: human-turn statuses render as light/bright status-colored cards with dark text, agent-turn as dark cards with the status color as border + left accent bar, github/none dark and muted. Descendants of an invalidated node (via non-removed `subtask` edges) render with the invalidated treatment and an "Invalidated (inherited)" pill — derived in the view, never persisted, so restoring the ancestor restores them automatically. A "Hide invalidated" toolbar toggle (default off, persisted per project in localStorage) filters effectively-invalidated nodes and re-runs layout — a human-view convenience only; agents are always served invalidated context. Legend always visible (teaches the light/dark treatment, edge styles, and badges). Live-ish via supabase realtime subscription or refetch-on-focus (either fine).

**Status colors** (the "brighter = human needed" rule, use everywhere incl. legend and node detail):

| Status | Color |
|---|---|
| `human_braindump_needed` | bright magenta `#e91e63` |
| `awaiting_human_response` | bright orange `#ff9800` |
| `split_proposed` | bright amber `#ffc107` |
| `spec_review` | bright yellow-green `#cddc39` |
| `awaiting_agent_breakdown` | muted blue `#5c7cfa` |
| `split_approved` | muted indigo `#4263eb` |
| `awaiting_agent_spec` | muted cyan `#22b8cf` |
| `ready_for_pickup` | muted teal `#12b886` |
| `pr_raised` | purple `#9775fa` |
| `broken_down` | gray-blue `#748ffc` at 50% |
| `done` | muted green `#40c057` at 70% |
| `invalidated` | gray `#868e96` |

`stale = true` → amber `#f59f00` STALE corner badge (solid, top-right; dashed amber is reserved for `soft_block` edges). `claimed_by` set → pulsing dot badge.

**Node detail**: a **stage-flow stepper** at the top renders the whole canonical pipeline (`human_braindump_needed` → `awaiting_agent_breakdown` → fork: split path `split_proposed` → `split_approved` → `broken_down`, or spec path `awaiting_agent_spec` → `spec_review` → `ready_for_pickup` → `pr_raised` → `done`), marking each step visited / current / skipped / future from the node's `node.status_changed` events; `awaiting_human_response` and `invalidated` render as off-rail chips (invalidated dims the rail). The stepper carries the single primary **next button** for the current status (braindump done → `awaiting_agent_breakdown`; answered → back to the status the question interrupted) or a cue pointing at the promoted Approve/Reject buttons; agent-turn, GitHub, and terminal statuses show a hint instead. Status pill + turn indicator; action buttons contextual to status (approve/reject split → sets `split_approved` / back to `awaiting_agent_breakdown` with a `split_decision` message; approve/reject spec → `ready_for_pickup` / `awaiting_agent_spec` + `review_comment`; invalidate with required reason → RPC; **restore** on invalidated nodes → back to the pre-invalidation status from events, human may override, clearing `invalidation_reason`; unclaim; manual set-status demoted into a collapsed "Advanced" escape hatch). Markdown body editor (plain textarea + save is fine). Tabs or sections: **Canvas** (tldraw; on save, persist `tldraw_doc` and export PNG → storage → update `canvas_png_path`, log `canvas.snapshot` event), **Threads** (messages grouped by `stage`, newest stage first, composer posts to current stage), **History** (events timeline, rendered readably), **Edges** (list + add-edge form + remove sets `removed_at`), **Spec/PR** (spec markdown, PR link out). Header breadcrumb: ancestor chain, each link colored by status, stale/invalidated ancestors visibly flagged — this is the "descendant of dead premise" warning.

Search box (project level) → `search_all`, results link to nodes.

Keep the UI clean but don't gold-plate: function over polish for v1.

## Claude Code plugin (`plugin/`)

Structure: `plugin/.claude-plugin/plugin.json` (name `agentjira`, description, version 0.1.0) and `plugin/skills/<name>/SKILL.md`:

- `agentjira-workflow` — the rulebook (trigger: any AgentJira work). Contents: the status machine table and whose turn it is; soft/firm block judgment rules (verbatim spirit: only pick up soft-blocked work if nothing else to do and it's not too much of a stretch); claim etiquette (claim before working, unclaim when stopping); PR body marker convention; spec style (tiny, concise); always run `aj context` before working a node and **Read the downloaded canvas PNGs**; treat invalidated/stale ancestors as vital context; ask questions via `aj post --type question` early rather than guessing; depth cap 50.
- `aj-pickup` — procedure: `aj tasks` → choose sensibly (respect blocks) → `aj claim` → `aj context` → do the stage-appropriate work → post results → unclaim if stopping.
- `aj-breakdown` — procedure for `awaiting_agent_breakdown` and `split_approved` nodes: study context incl. canvases; propose concise split (`aj propose-split`) with numbered children, each with a one-line scope + suggested edges (firm/soft blocks between siblings); after approval, materialize with `aj create-node --parent` + `aj add-edge`, set parent `broken_down`; route small nodes to `awaiting_agent_spec` instead.
- `aj-implement` — procedure for `ready_for_pickup`: claim, context, implement per spec on a branch, PR with the marker + `[AJ]` title, `aj link-pr` as backup, status handled by GHA thereafter.

Plugin README explains install (`/plugin` marketplace-from-dir or `--plugin-dir`) and CLI setup (env vars for the agent login).

## Non-negotiables checklist (all packages)

1. Exact enum strings from this file.
2. No hard deletes, ever.
3. Graph traversals: visited-set + depth cap 50 (cycles are legal data).
4. Agents get invalidated/stale context served to them, never filtered out.
5. Secrets: webhook secret only in GHA repo secrets + `projects` row; anon key is public by design; service-role key only inside the Edge Function.
