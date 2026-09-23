# AgentJira — Recreation Prompt

Everything needed to rebuild AgentJira from scratch, split into small independent chunks.

**How to use this:** each chunk is self-contained and removable. Delete the chunks you don't want, keep the ones you do, hand the rest to a build agent. Every chunk lists what it depends on — if you drop a chunk, drop or patch its dependents too. The dependency map is at the end (§M).

**Chunk IDs are stable.** Reference them from your own notes (`keep A1-A4, drop I*`).

---

# A. Product core

## A1 — The one-line concept

A Jira alternative where AI agents and humans collaborate on a **freeform graph of task nodes, not a kanban board**. A vision node at the top is braindumped by the human; agents propose splits into subnodes; small-enough nodes get a concise agent-written spec; approved specs become PRs. Edges carry structure (subtasks, blocks, related context) and are **information for agents to use with judgment, never hard constraints**.

*Depends on: nothing. This is the seed.*

## A2 — Turn-taking is the core mechanic

Humans and agents **alternate turns**, and the node's status always says whose turn it is. Every status belongs to exactly one turn owner: `human`, `agent`, `github`, or `none` (terminal/container).

Regular human intervention is a **feature, not a failure mode**. Humans approve every split, every spec, and every PR.

*Depends on: A1.*

## A3 — History is permanent

Nothing is ever hard-deleted — not nodes, edges, messages, or events. When a premise turns out wrong, its node is **invalidated** with a recorded reason, and its descendants read as **stale**. Invalidated nodes aren't trash: they are the context that stops the next agent repeating the mistake. Everything, including invalidated content, stays searchable.

*Depends on: A1. Drop this and you can drop E1-E4, B7, and simplify a lot — but the product loses its main differentiator.*

## A4 — The board never calls an LLM

Agents are **external**. Claude Code sessions drive the board through a CLI. The backend is a coordination surface, not an actor. No server-side LLM calls anywhere.

*Depends on: A1. Keeping this constrains C7 (the soft-block judge) to an external supervisor design.*

## A5 — Tenancy

Single user + their agents. Owner-scoped row-level security. One dedicated agent database user, added to each project by a membership row.

*Depends on: A1.*

## A6 — Stack

- **Supabase is the entire backend**: Postgres + RLS, Auth (email/password), Storage (canvas PNGs), Edge Functions (Deno). No other server.
- **Web**: Vite + React + TypeScript SPA talking directly to Supabase.
- **CLI**: Node + TypeScript wrapping `@supabase/supabase-js`.
- **Canvas**: tldraw.
- **Agent side**: a Claude Code plugin — skills teaching the workflow, wrapping the CLI.

*Depends on: A1. Swap freely; the rest of this document is stack-agnostic apart from the SQL in B\* and F\*.*

## A7 — Repo layout

Each package self-contained (own `package.json`), no root workspace.

| Path | What | Toolchain |
|---|---|---|
| `supabase/` | Migrations, RLS, triggers, Edge Functions | Supabase CLI, Postgres, Deno |
| `web/` | Human SPA: graph, node detail, canvas | Vite + React + TS |
| `cli/` | The agent-facing CLI | Node + TS |
| `plugin/` | Claude Code plugin (skills) | Markdown |
| `gha/` | GitHub Action template installed into project repos | YAML |
| `docs/` | Architecture contract + workflow diagrams | Markdown |

*Depends on: A6.*

## A8 — One contract document

Keep a single `docs/architecture.md` that is the source of truth for every enum string, table, column, and API shape shared across packages. Rule for all packages: **if you need a status, type, or column, it is defined there — do not invent variants.**

This is what stops five packages drifting on the same enum.

*Depends on: A7.*

---

# B. Data model

## B1 — `projects`

```sql
projects (
  id uuid pk default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 200),
  repo_owner text,            -- one repo per project, nullable until linked
  repo_name text,
  webhook_secret text not null default encode(gen_random_bytes(32), 'hex'),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  archived_at timestamptz     -- soft-archive; null = active
)
```

"Delete a project" = set `archived_at`. Reversible, history kept, hard delete forbidden.

*Depends on: A5.*

## B2 — `project_members`

```sql
project_members (
  project_id uuid not null references projects(id),
  user_id uuid not null references auth.users(id),
  role text not null check (role in ('owner','agent')),
  primary key (project_id, user_id)
)
```

*Depends on: B1, A5.*

## B3 — `nodes`

```sql
nodes (
  id uuid pk default gen_random_uuid(),
  project_id uuid not null references projects(id),
  title text not null check (char_length(title) between 1 and 300),
  body text not null default '',
  status node_status not null default 'human_braindump_needed',
  is_vision boolean not null default false,
  spec text,
  pr_url text, pr_number integer, merge_sha text,
  breakdown_on_merge boolean not null default false,
  invalidation_reason text,
  claimed_by text, claimed_at timestamptz,
  tldraw_doc jsonb,
  canvas_png_path text,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  fts tsvector generated always as (to_tsvector('english',
    coalesce(title,'') || ' ' || coalesce(body,'') || ' ' ||
    coalesce(spec,'') || ' ' || coalesce(invalidation_reason,''))) stored
)
```

Indexes: GIN on `fts`, btree on `(project_id, status)`.

*Depends on: B1, C1. Drop `tldraw_doc`/`canvas_png_path` if dropping the canvas. Drop `breakdown_on_merge` if dropping C6.*

## B4 — `edges`

```sql
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
```

*Depends on: B3, D1.*

## B5 — `messages`

```sql
messages (
  id uuid pk default gen_random_uuid(),
  node_id uuid not null references nodes(id),
  project_id uuid not null references projects(id),
  stage node_status not null,   -- thread scope = node + stage when posted
  author_role text not null check (author_role in ('human','agent','system')),
  author_id uuid references auth.users(id),
  type message_type not null,
  body text not null,
  created_at timestamptz not null default now(),
  fts tsvector generated always as (to_tsvector('english', coalesce(body,''))) stored
)
```

Threads are **scoped to node + the stage the node was in when the message was posted**. That is what keeps a long-lived node's conversation readable.

`message_type`: `note` · `question` · `answer` · `split_proposal` · `split_decision` · `spec_submission` · `review_comment` · `system`

*Depends on: B3, C1.*

## B6 — `events` (append-only audit log)

```sql
events (
  id bigint generated always as identity pk,
  project_id uuid not null,
  node_id uuid,
  actor_id uuid,
  actor_role text not null check (actor_role in ('human','agent','system')),
  type text not null,
  data jsonb not null default '{}',
  created_at timestamptz not null default now()
)
```

Event types: `node.created`, `node.status_changed` (`{from, to}`), `node.claimed`, `node.invalidated`, `edge.created`, `message.posted`, `pr.opened`, `pr.merged`, `canvas.snapshot`, `project.archived`, `project.unarchived`.

The event log is not decoration — the stage-flow stepper (H7) and the restore path (E3) both read it.

*Depends on: B1. Drop it and you lose H7 and E3's default.*

## B7 — Delete guards

- `BEFORE DELETE` triggers on `nodes`, `edges`, `messages`, `events` **raise an exception**.
- `BEFORE UPDATE` on `events` raises — append-only.

Belt and braces alongside "no delete RLS policies". Cheap, and it catches the one migration that forgets.

*Depends on: A3, B3-B6.*

## B8 — Write-side triggers

- `nodes` `BEFORE UPDATE`: maintain `updated_at`.
- `AFTER INSERT/UPDATE` on `nodes`, `AFTER INSERT` on `edges`/`messages`: write an `events` row. On node update log the changed fields; **always** log status transitions as `node.status_changed` with `{from, to}`.
- `AFTER UPDATE` on `projects`: when `archived_at` changes, log `project.archived` / `project.unarchived` (`node_id` null).

*Depends on: B6.*

## B9 — Project bootstrap trigger

`AFTER INSERT` on `projects`: add the creator to `project_members` as `owner`, **and create the vision node** (`is_vision = true`, title = project name, status `human_braindump_needed`).

A project is never empty. The human lands on a graph with exactly one thing to do.

*Depends on: B1, B2, B3.*

## B10 — Search

Generated `fts` tsvector columns on `nodes` and `messages` (see B3, B5), plus one RPC:

`search_all(p_project uuid, p_query text)` — `websearch_to_tsquery` over both, returns unified rows `(kind, node_id, title, snippet, rank)`.

Invalidated nodes are **included** on purpose.

*Depends on: B3, B5.*

---

# C. Status machine

## C1 — The status enum and turn owners

```
node_status:
  human_braindump_needed | awaiting_agent_breakdown | awaiting_human_response |
  split_proposed | split_approved | broken_down | awaiting_agent_spec |
  spec_review | ready_for_pickup | human_only_action | evaluating_soft_block |
  pr_raised | pr_changes_requested | pr_base_moved | done | invalidated
```

| Status | Turn | Meaning |
|---|---|---|
| `human_braindump_needed` | human | Human must provide direction/context (vision nodes start here) |
| `awaiting_agent_breakdown` | agent | Agent studies context; proposes a split or routes to spec |
| `awaiting_human_response` | human | Agent asked a question; human answers in the thread |
| `split_proposed` | human | Agent posted a `split_proposal`; human approves/rejects |
| `split_approved` | agent | Agent materializes child nodes + `subtask` edges, then sets parent `broken_down` |
| `broken_down` | none | Container node; work continues in children |
| `awaiting_agent_spec` | agent | Node is PR-sized; agent writes a tiny spec |
| `spec_review` | human | Human approves (→ `ready_for_pickup`) or rejects (→ `awaiting_agent_spec` + `review_comment`) |
| `ready_for_pickup` | agent | Cleared to build; an agent may claim and implement |
| `human_only_action` | human | Work only a person can do |
| `evaluating_soft_block` | agent | Queued for the soft-block judge |
| `pr_raised` | github | PR open; GitHub review is the approval gate |
| `pr_changes_requested` | agent | Reviewer requested changes; agent addresses, then resubmits |
| `pr_base_moved` | agent | Another PR merged; this branch is behind main |
| `done` | none | Merged/completed; `merge_sha` recorded |
| `invalidated` | none | Marked wrong; reason recorded; kept forever |

**There is no DB transition whitelist.** The machine is enforced by convention + UI + agent skills, not by a constraint. That is deliberate: humans need an escape hatch.

Implement `status_turn_owner(node_status)` as a SQL function — the single source of truth for column 2. Everything else (claim release, task listing, card brightness) derives from it.

*Depends on: A2. Everything in C, G, H, J depends on this.*

## C2 — Canonical happy path

```
human_braindump_needed → awaiting_agent_breakdown
  ├─ split path: split_proposed → split_approved → broken_down
  └─ spec path: awaiting_agent_spec → spec_review → ready_for_pickup → pr_raised → done
```

Plus the question loop (`↔ awaiting_human_response`) available from any agent stage.

*Depends on: C1.*

## C3 — Claiming, and automatic claim release

`claimed_by` (text label, default `hostname:pid`) + `claimed_at` on the node. A **flag, not a lock**. Humans clear stuck claims from the UI.

A `BEFORE UPDATE OF status` trigger on `nodes` clears `claimed_by`/`claimed_at` whenever the new status's turn owner is **not** `agent`. So:

- A claim survives an agent moving through its own stages (`awaiting_agent_breakdown → ready_for_pickup`).
- It drops the moment the node becomes the human's, GitHub's, or nobody's.
- `pr_raised` releases: review takes hours or days, long after the claiming session exited.
- A claim written explicitly in the **same** `UPDATE` as the status change always wins — the trigger only clears claims the caller didn't touch.

Agents therefore never need to unclaim after a handoff. They only unclaim when stopping **mid-stage with no status change**.

*Depends on: C1.*

## C4 — Routing out of breakdown, and the spec-skip

From `awaiting_agent_breakdown` the agent judges:

- **Bigger than one PR** → propose a split.
- **PR-sized, and human guidance on the plan would help** → `awaiting_agent_spec`, write the spec.
- **PR-sized and routine/self-evident** → skip the spec, straight to `ready_for_pickup`. The PR review becomes the only human gate. Post a one-line `note` saying why.

**Hard floor: security-relevant work always gets a spec.** Auth, secrets, permissions, RLS, database migrations, config. Never skipped, no matter how small it looks. Not a judgment call.

The skip is legal because there's no transition whitelist, and because `ready_for_pickup` is an agent turn the claim carries across it (C3).

This is deliberate load control: the spec gate exists where human guidance adds value, not as a rubber stamp.

*Depends on: C1, C3.*

## C5 — `human_only_action`

Some work is blocked on being a person: creating an account, entering payment details, clicking through a third-party console, plugging in hardware, signing something. No amount of context unblocks it.

Rules:

- It is **always its own node**, never a detour on another node. An agent never parks its own node hoping a human wanders past.
- Whatever it holds up is **firm-blocked** by it (source = the human node) — the ordinary dependency machinery.
- **No hand-back path**, because no agent ever held it. The human does it and marks it `done` (or `invalidated` if it turned out unnecessary).
- Never listed to agents (the task list covers agent turns only); the claim-release trigger drops any claim on entry.
- **Predict, don't discover.** Breakdown and spec are where these are cheap to spot; a split proposal names the human-only children up front so the human sees their own queue from day one. Hitting one mid-implementation is the fallback: split it out, block on it, go do something else.

Contrast with a question (`awaiting_human_response`): a question needs *information* and the turn comes back on the same node. A human-only action needs a *thing done* and that node is the human's end to end.

*Depends on: C1, D1.*

## C6 — `breakdown_on_merge` (plan-deliverable nodes)

Some nodes deliver a **plan/spec document committed to the repo**, not working code. `done` is wrong after that merge — the planned work still has to be split.

`nodes.breakdown_on_merge = true` → on PR merge, the node routes to `awaiting_agent_breakdown` (still recording `merge_sha`) instead of `done`. The merged document becomes the primary input for the split.

Not a new status; a re-entry into the existing breakdown stage. Set before the merge, by the agent or by a human toggle in the UI.

*Depends on: C1, B3, I2. Pairs with D2 — a plain block from such a node re-arms forever.*

## C7 — `evaluating_soft_block` (the judge side-loop)

Off-rail side-loop for soft-blocked nodes. The node sits in `evaluating_soft_block`, an **agent-turn** status, and a **judge** decides one of three things:

1. **Proceed** → back to `ready_for_pickup`.
2. **Escalate** → `awaiting_human_response`; the human's answer returns it here for re-judging.
3. **Defer** → add a `reassess_after` edge; the node is held like a firm block until the source is `done`, then re-enters here.

**The board never calls an LLM (A4).** An external, deterministic supervisor watches for this status and dispatches a fresh, throwaway headless judge session. The supervisor never reads the verdict — it just dispatches.

Judgment heuristics for the judge: weigh **reversibility** (a wrong call here causing major downstream problems → wait), and **marginal unblocking value** (lots of unblocked work already → low gain). Never pick up work that would require stacked PRs — convert to a hard block instead. In practice most soft blocks should become hard blocks.

*Depends on: C1, D1, D4, A4. Fully removable — drop it and soft blocks are judged inline by whichever agent picks up.*

## C8 — `pr_changes_requested`

Mirror of `awaiting_human_response` — the human asked the agent, not the other way round.

When a reviewer requests changes or leaves inline comments, the node flips to `pr_changes_requested` (agent turn) and **the review lands on the node's thread as a `review_comment` message** — verbatim summary, formatted inline comments, and the review URL. Agents work it from the board without leaving for GitHub.

The agent addresses it, pushes, then makes an **explicit round-trip** back to `pr_raised`. Explicit so a work-in-progress push never flips the turn on its own.

*Depends on: C1, I2, I3.*

## C9 — `pr_base_moved`

Nodes wait in `pr_raised` for a human review, and while they wait siblings merge. So **any merge in the project hands every other open PR's node** to an agent: merge main in, and check what landed against the branch.

The point of the stage is that a *clean merge proves nothing*. Main may have renamed something the branch calls, changed a contract it relies on, or **already done the work**. Three outcomes: nothing to do, branch needs work, or the node is now redundant (→ ask the human, don't quietly resubmit).

Same explicit resubmit round-trip as C8. Nothing bounces a node that is already an agent's — that agent picks main's changes up anyway.

*Depends on: C1, I2.*

## C10 — Off-rail statuses vs the rail

The "rail" is C2. `awaiting_human_response`, `pr_changes_requested`, `pr_base_moved`, `evaluating_soft_block` and `invalidated` are **off-rail** — they anchor to the last on-rail status rather than occupying a step of their own. This matters for the stepper (H7) and for how people reason about the machine.

*Depends on: C2.*

---

# D. Edges

## D1 — Edge types, read source → target

```
edge_type:
  subtask | firm_block | firm_block_plan | soft_block | soft_block_plan |
  reassess_after | relates_to
```

| Type | Reads |
|---|---|
| `subtask` | target is a subtask (child) of source |
| `firm_block` | source firm-blocks target — target ideally waits |
| `soft_block` | source soft-blocks target — shared decisions |
| `reassess_after` | target should be reassessed after source resolves |
| `relates_to` | contextual link |

**All blocks are informational.** Agents use judgment; they are never hard DB constraints.

- **Firm-blocked** (blocker not `done`): don't pick it up.
- **Soft-blocked**: pick up only if there is **nothing else to do** *and* it's **sensible — not too much of a stretch**. If proceeding means guessing at decisions the blocker will make, it's a stretch: leave it.

*Depends on: A1, B4. D2/D4 add the remaining types.*

## D2 — The `_plan` block variants

`firm_block_plan` / `soft_block_plan`: same as the base type **until the source's plan lands**, then context only — no longer a gate.

Plan has landed when the source is `done` **OR** `broken_down` **OR** has a `merge_sha` recorded.

`broken_down` counts because **the approved split *is* the decision, materialized**. A source broken down without a plan-document PR reaches neither `done` nor a `merge_sha`, so the edge would otherwise gate its target forever.

**Choosing a variant — ask what the target actually needs from the blocker:**

| Target needs… | Use |
|---|---|
| the blocker's **implementation** (built, merged, working) | `firm_block` / `soft_block` |
| only the blocker's **decision/plan** | `firm_block_plan` / `soft_block_plan` |

Getting this wrong over-blocks: a plain block from a plan-deliverable node **re-arms** when that node re-enters breakdown after its plan merges, and stays armed through `broken_down` until the blocker's whole subtree completes — gating the target on an entire implementation subtree when it only ever needed the decision.

If the target also needs a specific **child's** implementation, add an explicit block edge on that child. Don't let the parent-level `_plan` edge stand in for it.

*Depends on: D1, C6.*

## D3 — Coarse blocks (a plain block on a `broken_down` source)

A **plain** block whose source is `broken_down` is a *coarse* block: it keeps gating until that source's whole subtree is complete.

This is what makes "don't replicate the parent's outside blocks onto each child" safe. When a parent that blocks some outside node T is broken down, the block stays on the parent and is surfaced as a parent-level note rather than fanned out to `child₁→T, child₂→T, child₃→T`. Fanning recreates the hairball the demotion exists to prevent. Only attach a child→T block when that one child specifically and solely carries the dependency — then retire the parent's.

Exception: if the parent's outside block is a `_plan` variant, `broken_down` **satisfies** it (D2).

*Depends on: D1, D2.*

## D4 — `reassess_after`

Behaves **exactly like a firm block** while the source is not `done` — target held back from pickup and from the graph frontier. Once the source resolves, the target should be **re-judged** (typically re-entering `evaluating_soft_block`).

A firm block that means "come back to this", not "wait forever". Produced by the judge's defer verdict (C7).

*Depends on: D1, C7.*

## D5 — Traversal rules (non-negotiable)

- **No cycle enforcement anywhere.** Cycles are legal data.
- Therefore **every** graph traversal — server RPC, CLI, web layout — carries a **visited-set** and a **depth cap of 50**.

This applies to ancestor chains, descendant walks, blocker resolution, and layout ranking.

*Depends on: D1.*

## D6 — Edges are never deleted

"Remove an edge" sets `removed_at`. Every query filters on `removed_at is null`, except the context dump, which serves removed edges too (an edge someone deliberately removed is context).

*Depends on: A3, B4.*

---

# E. Invalidation and staleness

## E1 — Stale is derived-only, never persisted

A node is **stale** iff:

- its own status is **not** `invalidated`, **and**
- at least one ancestor via non-removed `subtask` edges (source = parent, target = child) has status `invalidated`.

Computed at read time **everywhere** — server RPCs and the web view both derive the same set. Nothing is ever written to a descendant.

Consequences that make this worth the discipline:

- Restoring the invalidated ancestor **un-stales the whole subtree automatically. Zero writes.**
- There is exactly one derived concept. "Invalidated" means explicitly invalidated (persisted status + reason); "stale" means an ancestor currently is.
- Even `done` descendants read as stale — a merged premise can still be stale.

Stale nodes are **dead until restored**: dimmed in the graph, hidden by the hide-toggle, and **excluded from the agent pickup list**. They are never hidden from the context dump — agents are always served the full picture.

**Blocks never affect staleness.** A blocker's status (including `invalidated`) is information served where blockers are listed, nothing more.

*Depends on: A3, D1, D5.*

## E2 — `invalidate_node(p_node, p_reason)` RPC

Sets `status='invalidated'`, sets `invalidation_reason`, logs a `node.invalidated` event. **That is all.** Nothing is written to any other node.

Reason is mandatory. The reason is the entire point — it's what stops the next agent repeating the mistake.

*Depends on: E1, B6.*

## E3 — Restore

Update the node to its pre-invalidation status — default to the `from` of the latest `node.status_changed` event with `to = 'invalidated'`, human may override — and set `invalidation_reason = null`.

The update trigger logs the change. Nothing is deleted. Every descendant un-stales automatically because staleness is derived (E1).

*Depends on: E1, E2, B6.*

## E4 — No cascades, ever

Post-merge, nothing auto-advances. Dependents' "unblocked" state is **derived from edges at read time**, never cascaded writes. Same for staleness. Same for blocker satisfaction.

The rule: if a piece of state can be computed from the graph, compute it. Don't write it.

*Depends on: E1.*

---

# F. Backend: security and RPCs

## F1 — RLS pattern

All tables have RLS enabled. Helper: `is_project_member(p uuid) returns boolean`, security definer.

- `projects`: select where member **or creator** (`created_by = auth.uid()` — needed because `INSERT ... RETURNING` checks the select policy **before** the AFTER-INSERT bootstrap trigger has written the owner-membership row); insert where `created_by = auth.uid()`; update where member role `owner`.
- Archiving is just the owner setting `archived_at` through that update policy. No new policy. Archived projects stay SELECT-able so the owner can list and unarchive them; the web UI filters them out of the default list.
- `nodes`, `edges`, `messages`: select/insert/update where `is_project_member(project_id)`. **No delete policies.**
- `events`: select/insert where member. No update, no delete.
- `project_members`: select where member; insert/update only by the project owner.

*Depends on: A5, B1-B6.*

## F2 — Secret handling

- `webhook_secret` is **never exposed to the agent role**. The web UI (owner) reads it; the CLI never selects it.
- The anon key is public by design.
- The service-role key lives **only** inside Edge Functions.
- The GitHub App private key lives only in the token-minting function's secrets.

*Depends on: F1.*

## F3 — Storage for canvases

Private bucket `canvases`. Read/write for authenticated users who are members of the node's project, enforced by a storage policy on the path prefix.

Path convention: `{project_id}/{node_id}/{ISO-timestamp}.png`.

Every canvas save exports a PNG snapshot — **agents read the image**, they can't read a tldraw document.

*Depends on: B3, F1.*

## F4 — `stale_node_ids(p_project)` RPC

Returns the project's derived stale set: BFS down from every node with status `invalidated` via non-removed `subtask` edges (visited-set, depth ≤ 50); returns reachable node ids whose own status is not `invalidated`. Security invoker, `stable`.

One implementation, used by the CLI's task list and context dump. The web derives the same set client-side from the graph it already has.

*Depends on: E1, D5.*

## F5 — `node_context(p_node)` RPC

Returns JSON: the node, its edges (both directions, **including removed**), the ancestor chain via subtask edges up to the vision node (id, title, status, stale, invalidation_reason), children, and blockers.

Blockers = sources of non-removed `firm_block` / `soft_block` / `firm_block_plan` / `soft_block_plan` / `reassess_after` edges, **each carrying its `block_type` and the source's `merge_sha`** so plan-variant satisfaction ("plan landed") is computable by callers.

Every `stale` field in the response is the **derived** value. The JSON field name `stale` is part of the contract.

Depth-capped, cycle-safe.

*Depends on: E1, D2, D5, F4.*

## F6 — Local-dev seed

Create an owner user and an agent user with a shared dev password, one sample project (the bootstrap trigger creates its vision node), agent added as a member. Applied on database reset.

Not for cloud — real users there.

*Depends on: B9, A5.*

---

# G. The agent CLI

## G1 — Shape and config

A Node + TypeScript CLI (commander + `@supabase/supabase-js`), logging in as the **dedicated agent user**.

Config resolution: env vars first (`URL`, `ANON_KEY`, `EMAIL`, `PASSWORD`), else `~/.<tool>/config.json` with the same keys lowercased. Session token cached to `~/.<tool>/session.json`.

- Every command supports `--json`. Default output is compact human/agent-readable text.
- **Node ids accept a unique prefix** (≥ 6 chars). Agents copy ids constantly; full uuids everywhere is friction.
- Errors: nonzero exit + one-line message. **Never swallow backend errors.**

*Depends on: A4, A5, A6.*

## G2 — Command surface

| Command | Behavior |
|---|---|
| `whoami` | Current user + role |
| `projects` | List member projects |
| `tasks [-p <project>]` | The pickup list (G3) |
| `context <node>` | Full context dump (G4) |
| `claim <node> [--session <label>]` / `unclaim <node>` | Set/clear `claimed_by`; claim refuses if already claimed (unless `--force`) |
| `post <node> --type <message_type> --body <text> [--stage <status>]` | Post a message; stage defaults to the node's current status. `--type question` also flips status → `awaiting_human_response` |
| `propose-split <node> --body <text>` | Post `split_proposal` + status → `split_proposed` |
| `create-node -p <project> --title <t> [--body] [--parent] [--status] [--breakdown-on-merge]` | Create node (+ `subtask` edge from parent). Default status `awaiting_agent_breakdown` |
| `add-edge --type <edge_type> --from <node> --to <node>` | Create edge |
| `submit-spec <node> (--file <path> \| --body <text>)` | Set `spec` + status → `spec_review`, post `spec_submission` |
| `set-status <node> <status>` | Direct set, validated against the enum |
| `set-breakdown-on-merge <node> [--off]` | Toggle the plan-deliverable flag |
| `link-pr <node> --url <u> --number <n>` | Set PR fields + status → `pr_raised` (backup when the Action isn't installed) |
| `resubmit <node> [--body <text>]` | `pr_changes_requested` / `pr_base_moved` → `pr_raised`, posting a `note`. Refuses on any other status |
| `invalidate <node> --reason <text>` | Calls the invalidate RPC |
| `search -p <project> <query>` | Full-text search |
| `github-token <node>` | Mint a short-lived repo-scoped GitHub App token (I4) |
| `gitpush <node> [refspec]` | Push the current branch as the app identity; mints the token internally so it never reaches the command line |

*Depends on: G1, C1, D1.*

## G3 — `tasks`: the pickup list

Lists nodes in **agent-turn statuses only**: `awaiting_agent_breakdown`, `split_approved`, `awaiting_agent_spec`, `ready_for_pickup`, `evaluating_soft_block`, `pr_changes_requested`, `pr_base_moved`.

Each annotated with `claimed_by` and its block-family blockers (firm/soft, their `_plan` variants, `reassess_after`) with those blockers' statuses.

- **Stale nodes are excluded entirely** (F4). Dead until the ancestor is restored; they reappear automatically when it is.
- Firm-blocked-by-unfinished, `reassess_after`-gated, and claimed-by-someone-else go in a separate **"not recommended"** section — **never hidden**. A `reassess_after` gate is treated exactly like a firm block.
- A `_plan` blocker whose plan has landed (D2) is annotated **"PLAN LANDED"** and stops gating. It becomes required reading, not a wall.
- A **plain** block on a `broken_down` blocker is annotated as a coarse block and keeps gating until that subtree completes (D3).

Two sections, never a filtered-down single list. An agent that can't see why a node is parked will invent a reason.

*Depends on: G2, C1, D2, D3, D4, E1.*

## G4 — `context`: the mandatory pre-work dump

One command that returns everything an agent needs, so there is no excuse for working from a half-read board:

- Node fields and spec.
- **Ancestor chain** with statuses, derived stale flags, and invalidation reasons.
- Children, all edges (including removed), and blockers — each annotated: a `_plan` blocker as PLAN LANDED or still gating; a plain block on a `broken_down` blocker as a coarse block.
- **All thread messages grouped by stage.**
- **Downloads the latest canvas PNGs of the node *and its ancestors*** to a temp dir and prints the file paths, so the agent can read the images.

**Serves everything, including stale and invalidated nodes.** That contract never changes — only the pickup list filters.

*Depends on: F5, F3, F4.*

---

# H. Web app

## H1 — Stack and routes

Vite + React + TypeScript strict + router + Supabase client + a flow/graph library + dagre for auto-layout + tldraw.

Routes:
- `/login`
- `/` — projects list + create; owner adds the agent member by id/email; shows repo + webhook secret with Action install instructions; owner can **archive** a project (reversible soft-delete, hidden from the list) and unarchive from a "Show archived" section.
- `/p/:projectId` — graph
- `/n/:nodeId` — node detail

*Depends on: A6, B1.*

## H2 — Graph layout

Dagre top-to-bottom over non-removed `subtask` + block-family edges, vision node at top.

**Weighted so hierarchy dominates**: subtask 4, firm_block/firm_block_plan 2, reassess_after 2, soft_block/soft_block_plan 1. This ranks a blocker above what it blocks, so block edges flow top-to-bottom instead of sideways. `relates_to` stays out of layout entirely.

Cycle-safe, depth-capped (D5). Back-edges are dropped from **layout only** and still rendered.

*Depends on: H1, D1, D5.*

## H3 — Edge rendering

All non-removed edges drawn as bezier curves:

| Edge | Style |
|---|---|
| `subtask` | gray, thinner, faded — scaffolding |
| `firm_block` | solid red |
| `firm_block_plan` | long-dashed red |
| `soft_block` | dashed amber |
| `soft_block_plan` | short-dashed amber |
| `reassess_after` | dotted teal |
| `relates_to` | dotted gray, faint |

- A **satisfied** plan-variant block (source's plan landed) renders **faded** — it reads as context, not "wait".
- A block-family edge incident to a `broken_down` node is **demoted**: hidden from the drawn graph, still a layout ranking hint. Its subtasks carry the granular blocks (D3).

*Depends on: H2, D2, D3.*

## H4 — Status colors: brighter = human needed

One rule everywhere, including the legend and node detail.

| Status | Color |
|---|---|
| `human_braindump_needed` | bright magenta `#e91e63` |
| `awaiting_human_response` | bright orange `#ff9800` |
| `split_proposed` | bright amber `#ffc107` |
| `spec_review` | bright yellow-green `#cddc39` |
| `human_only_action` | bright red `#fa5252` — loudest card on the board |
| `awaiting_agent_breakdown` | muted blue `#5c7cfa` |
| `split_approved` | muted indigo `#4263eb` |
| `awaiting_agent_spec` | muted cyan `#22b8cf` |
| `ready_for_pickup` | muted teal `#12b886` |
| `evaluating_soft_block` | muted gold `#d9a441` |
| `pr_raised` | purple `#9775fa` (bright — awaiting the human's PR review) |
| `pr_changes_requested` | deep violet `#7048e8` (agent turn) |
| `pr_base_moved` | grape `#ae3ec9` — a separate hue, not another violet, so the two PR side-loops stay apart on a dark card's thin border |
| `broken_down` | gray-blue `#748ffc` @ 50% |
| `done` | muted green `#40c057` @ 70% |
| `invalidated` | gray `#868e96` |

Stale → solid amber `#f59f00` corner badge (dashed amber is reserved for `soft_block` edges). `claimed_by` set → pulsing dot badge.

*Depends on: C1, A2.*

## H5 — Node cards

Brightness encodes turn:

- **Human-turn *and* the GitHub turn (`pr_raised`)** → light/bright status-colored card, dark text. A raised PR is awaiting the human's review on GitHub, so it reads as human-attention.
- **Agent-turn** → dark card, status color as border + left accent bar.
- **`none`** (`broken_down`, `done`) → dark and muted.

Overrides, in order:

- An **unfinished firm-family gate** (`firm_block` / `firm_block_plan` / `reassess_after`) on any unclaimed node — agent-turn **or human-turn**, `human_only_action` included — gets a red BLOCKED badge and fades back. Nobody should start it yet. (The agent-facing task list only covers agent turns; human-turn gating is visible in the graph alone.)
- **Stale** descendants render with the invalidated treatment (dimmed) plus the amber STALE badge, while the status pill keeps the node's own status label.

Toolbar toggle **"Hide invalidated & stale"** (default off, persisted per project in localStorage) filters them and re-runs layout. A human convenience only — agents are always served invalidated context. When the toggle hides every node, show an empty-state message over the canvas, not a blank graph.

Legend always visible: it teaches the light/dark treatment, the edge styles, and the badges.

*Depends on: H4, E1, D1.*

## H6 — Node detail tabs

- **Canvas** — tldraw. On save, persist the document and export a PNG to storage, update the path, log a `canvas.snapshot` event.
- **Threads** — messages grouped by `stage`, newest stage first; the composer posts to the current stage.
- **History** — the events timeline, rendered readably.
- **Edges** — list + add-edge form; remove sets `removed_at`.
- **Spec/PR** — spec markdown, PR link out, and the `breakdown_on_merge` toggle ("plan deliverable: merged PR routes back to breakdown"). When set, the node header shows a "↩ breakdown on merge" hint.

Plus a markdown body editor (plain textarea + save is fine), a status pill + turn indicator, and a **header breadcrumb**: the ancestor chain, each link colored by status, with stale/invalidated ancestors visibly flagged. That breadcrumb is the "descendant of a dead premise" warning.

*Depends on: H1, B4, B5, B6, C6, F3.*

## H7 — The stage-flow stepper

At the top of node detail, render the **whole** pipeline, not just the current status:

```
human_braindump_needed → awaiting_agent_breakdown
   ├─ split path: split_proposed → split_approved → broken_down
   ├─ spec path:  awaiting_agent_spec → spec_review → ready_for_pickup → pr_raised → done
   └─ human-only: human_only_action → done
```

Each step marked **visited / current / skipped / future**, derived from the node's `node.status_changed` events. Off-rail statuses (C10) render as chips anchored to the last on-rail status — `invalidated` dims the rail, `pr_changes_requested` anchors to `pr_raised`, `evaluating_soft_block` reads as "judge deciding".

The stepper carries the **single primary next button** for the current status (braindump done → breakdown; answered → back to the status the question interrupted; `human_only_action` → `done`, since doing the work *is* the transition), or a cue pointing at the promoted Approve/Reject buttons. Agent-turn, GitHub, and terminal statuses show a hint instead of a button.

*Depends on: C1, C2, C10, B6.*

## H8 — Action buttons

Contextual to status:

- Approve/reject split → `split_approved` / back to `awaiting_agent_breakdown`, with a `split_decision` message.
- Approve/reject spec → `ready_for_pickup` / `awaiting_agent_spec` + a `review_comment`.
- Invalidate, with a **required** reason → RPC.
- **Restore** on invalidated nodes → back to the pre-invalidation status from events, human may override, clearing the reason (E3).
- Unclaim.
- **Manual set-status demoted into a collapsed "Advanced" escape hatch.** It must exist; it must not be the obvious thing to click.

*Depends on: H7, E2, E3, C3.*

## H9 — Frontend performance rules

Two rules that are load-bearing on a phone:

- **tldraw is lazy-loaded** by the Canvas tab and must stay that way. It's ~4 MB of JS; a static import puts it on every route including the graph, which is enough to get the tab killed on mobile.
- **The graph view selects an explicit column list, never `*`.** The canvas document, body, and spec are not rendered there and grow without bound.

*Depends on: H1, H2.*

## H10 — Liveness and search

Live-ish is enough: a realtime subscription or refetch-on-focus, either is fine.

Project-level search box → the search RPC, results link to nodes.

Keep the UI clean but don't gold-plate: function over polish.

*Depends on: H1, B10.*

---

# I. GitHub integration

## I1 — The PR ↔ node link

PR title: `[AJ] <node title>`.

PR body must contain, exactly:

```
Implements AgentJira node: <web-app-url>/n/<node-uuid>

AgentJira-Node: <node-uuid>
```

The Action greps `AgentJira-Node: <uuid>`, **last occurrence wins**. One human-clickable link, one machine marker. PRs without the marker are skipped cleanly.

*Depends on: A1.*

## I2 — The `github-sync` Edge Function

`POST /functions/v1/github-sync`, called only by the Action. Auth: an `x-agentjira-secret` header must equal the project's `webhook_secret`, looked up via the node's project. The function uses the service-role key internally, bypassing RLS.

```jsonc
{
  "node_id": "<uuid>",
  "action": "pr_opened" | "pr_approved" | "pr_changes_requested" | "pr_merged" | "pr_closed",
  "pr_url": "...", "pr_number": 7, "repo": "owner/name",
  "merge_sha": "<sha>",        // pr_merged only
  "actor": "github-login",
  "review_body": "...",        // pr_changes_requested only
  "review_comments": "...",    // pr_changes_requested only — formatted inline comments
  "review_url": "..."          // pr_changes_requested only
}
```

Effects:

- `pr_opened` → set PR fields, status `pr_raised`.
- `pr_changes_requested` → status `pr_changes_requested`, and post the review to the thread as a **`review_comment`** message (C8).
- `pr_merged` → set `merge_sha`; status `done`, **unless `breakdown_on_merge`** → `awaiting_agent_breakdown` (C6). Applied only while the node is still `pr_raised`/`pr_changes_requested`, so a duplicate merge report never clobbers post-merge progress. Re-setting `done` stays idempotent.
- `pr_merged` **additionally sweeps the project**: every other node still in `pr_raised` moves to `pr_base_moved` with a `system` message (C9).
- `pr_approved` / `pr_closed` → event + system message only. A closed-unmerged PR is for humans to triage.

Every call logs an event and posts a message to the node at its (new) stage. Unknown node or bad secret → 401/404, **no detail leaked**.

*Depends on: I1, C6, C8, C9, B1.*

## I3 — The GitHub Action template

One workflow installed into each project repo. Repo secrets: the sync URL and the project's `webhook_secret`.

**Job 1 — report.** Triggers on `pull_request` (opened, reopened, ready_for_review, closed) and `pull_request_review` (submitted). Extracts the marker, POSTs the matching action. On a non-approving review it reads the review's inline comments via the GitHub API (needs `pull-requests: read`) and POSTs `pr_changes_requested` — with the review body, formatted inline comments, and review URL — when the review **requested changes** OR left **any inline comment**. A bare "Comment" review with no inline notes is informational and skipped.

**Job 2 — merge.** On a review submitted with state *approved* on a marked PR: verify mergeability, poll check suites until green (~20 min timeout; zero check runs counts as pass), then squash-merge using the repo's own `GITHUB_TOKEN`, then POST `pr_merged` with the merge SHA.

**The PR body is untrusted input** — pass it through an env var, never interpolate it into a shell script.

Caveats to document for whoever installs it:
- Branch protection must permit the Actions bot to complete the merge.
- Merges performed with `GITHUB_TOKEN` **do not trigger downstream `on: push` workflows** (GitHub's recursion guard).
- Manual merges still work — the `pull_request: closed` trigger reports `pr_merged` as a backup, and the server side is idempotent.

*Depends on: I1, I2.*

## I4 — Agent PR identity: a GitHub App

**GitHub forbids approving your own PR.** So the PR author must differ from the human reviewer, which means agents must open PRs as a **GitHub App**, never as the operator.

A GitHub App can open and comment on PRs but **cannot submit an approving review** — fine, because the human approves. An agent-approver would need a separate bot *user* account.

`POST /functions/v1/github-token`, called by the CLI. Auth: the caller's Supabase JWT (the agent user); the function runs every query under that token so **RLS enforces project membership** (a non-member sees no node → 404). Body: `{ "node_id": "<uuid>" }`.

Function secrets:
- App ID — used as the JWT `iss`.
- App private key, **PKCS#8 PEM** (`BEGIN PRIVATE KEY`). WebCrypto rejects the PKCS#1 `BEGIN RSA PRIVATE KEY` GitHub hands out — convert with `openssl pkcs8 -topk8 -inform PEM -nocrypt -in app.pem`.

Flow: sign a ~10 min app JWT (RS256) → resolve the installation for the node's project repo via `GET /repos/{owner}/{repo}/installation` (no DB column needed) → `POST /app/installations/{id}/access_tokens` scoped to **that one repo** with `contents: write` + `pull_requests: write`. Returns `{ token, expires_at }` — a ~1h token for `git push` and PR creation.

Errors: repo not linked → 400; app not installed → 400; GitHub failures → 502. **The token is never logged**, and the CLI's push command hands it straight to git so it never reaches a command line.

*Depends on: I1, F2, B1.*

## I5 — Per-repo setup checklist

1. Copy the Action into `.github/workflows/`, commit to the default branch.
2. Add the two repo secrets.
3. Link the repo to the project (**one repo per project** — each project's secret only authorizes nodes in that project).
4. Install the GitHub App on the repo.
5. Enable branch protection requiring **1 approving review**, so the human review is the enforced merge gate.

*Depends on: I3, I4.*

---

# J. The agent plugin

## J1 — Plugin shape

A Claude Code plugin: a manifest plus one directory per skill, each a `SKILL.md` with `name` + `description` frontmatter. The description is the trigger — it decides when the skill loads.

Skills, layered:

| Skill | Loads when |
|---|---|
| The rulebook | **Any** board work — before and alongside everything else |
| Pickup | "Pick up a task" / starting a session with no node named |
| Breakdown | Nodes at `awaiting_agent_breakdown` or `split_approved` |
| Implement | Nodes at `ready_for_pickup` (and the PR round-trips) |
| Stage notes, one per agent-turn status | Invoked by the three above to load **this project's** instructions for the stage |

*Depends on: A4, G1.*

## J2 — The rulebook skill

The always-on contract. Contents:

- The **status machine table with turn owners** (C1), and the explicit list of agent-turn statuses — the only ones an agent may act on. **Never fake a human's turn** (never approve your own split or spec).
- **Block judgment** (D1, D2, D4) including the block-type choice table.
- **Claim etiquette** (C3): claim before working; handoffs release it for you; unclaim only when stopping mid-stage with no status change; the claim is a flag, not a lock.
- **Context is mandatory**: always run the context dump before working a node, and **Read the downloaded canvas PNGs** — canvases carry human intent the text does not.
- Invalidated and stale ancestors are **vital context, never noise**.
- **Ask early, don't guess.** A cheap question now beats an invalidated subtree later.
- **Human-only work** (C5), including the question-vs-human-only table.
- The PR conventions (I1) and the app-identity rule (I4).
- Hard rules: never delete anything; every traversal carries a visited-set and depth cap 50; use the exact enum strings, never invent variants.

*Depends on: C1, C3, C5, D1, D2, G4, I1.*

## J3 — Pickup: the orchestrator/subagent split

A general "pick up work" request (no node named) makes the session an **orchestrator**. Its entire job is to list, choose, and dispatch — it **never** claims, loads context, breaks down, specs, implements, or raises a PR itself.

1. **List** — run the task command. It is the source of truth; trust it over conversation history.
2. **Choose** — skip the "not recommended" section. A PLAN LANDED blocker no longer gates (it becomes required reading). An `invalidated` blocker is a judgment signal, not a hard stop — read its reason. A blocker in `human_only_action` cannot be cleared, worked around, or done for the human: leave it.
3. **Dispatch one subagent per node, in parallel.** If six nodes are actionable, spawn six. Never point two subagents at the same node. Each dispatch names the node id, the rulebook skill, the stage-notes skill, and tells the subagent to do the work **directly** and never delegate onward.
4. **Monitor** — arm a persistent poll of the task list that diffs against a baseline and reports newly-actionable nodes. A failed poll must **not** overwrite the baseline, or anything that appears meanwhile is silently absorbed. Never stop the monitor because the board is empty — empty just means the human's turn is in progress.

**Every dispatch is a fresh subagent — never reuse one.** A rejected spec, a PR round-trip, a re-judged block: all new dispatches. The old agent is carrying its entire first pass in context and almost none of it is what the revision needs. The review comment says what to change, and the context dump reprints the node, spec, and full thread — so a fresh agent reads the board's *current* state cheaply, where a resumed one remembers a stale version of it at the cost of everything it did to get there.

**Reporting**: small checkpoints, not narratives. One line on dispatch, one line when a node lands. No summaries of what was implemented — the board is the record. Speak up properly only when something needs the human.

*Depends on: J1, J2, G3.*

## J4 — Subagent procedure

Claim → load context (and **read the canvas PNGs**) → load the stage-notes skill for the node's status → do the stage-appropriate work → the status change hands the turn over and releases the claim → post a short note if there's context worth recording → unclaim only if stopping mid-stage → **stop**.

Handing the turn over is the **end** of the job, not a pause in it. Don't wait for the human to approve a spec or review a PR.

*Depends on: J3, C3, G4.*

## J5 — Breakdown procedure

**Bias toward breaking down.** Route straight to spec only when the node is *clearly* one coherent change. On a freshly-created node with thin context, **do not guess small** — propose a split or ask a question. Skipping to spec on a hunch strands the human with no easy way back; a split proposal they can simply reject.

**Split proposals**: numbered children, **one line of scope each**, plus the suggested blocking edges between siblings with the variant named and why (D2). Flag plan-deliverable children (C6). **Name the human-only children explicitly** (C5) — err toward flagging: a mis-flagged child costs the human one status change, an un-flagged one strands an agent.

Then stop. Do not create children yet — the handoff releases the claim.

**Materializing an approved split**: read the thread first (approval often comes with adjustments). Create each child under the parent (which creates the `subtask` edge), add **only the blocks between the new children**, then set the parent `broken_down`.

**Do not replicate the parent's outside blocks onto each child** (D3).

*Depends on: J4, C4, C5, C6, D2, D3.*

## J6 — Implementation procedure

A `ready_for_pickup` node was cleared in one of two ways: it has a **human-approved spec** (that spec is the contract), or the spec was skipped (C4) and the contract is its **title, body, and thread**. If that's too thin to build confidently, ask or route back to spec.

- **Branch from the *remote* default branch** (`git fetch origin && git switch -c <branch> origin/main`). A local main may be days behind, and starting there means the PR is born stale.
- Build exactly the contract. No gold-plating, no scope creep. If it's wrong mid-flight, post a question and pause rather than improvising.
- **If a spec-less node turns out to touch security, stop and route it back to spec.**
- Hit something only a human can do → split it out and firm-block yourself on it (C5), then finish the parts that don't depend on it or go do other work. **Never fake credentials or stub the thing out** unless the contract says to.
- Push and open the PR **as the app identity** (I4). Then link the PR as a backup.
- From `pr_raised` on, **the Action owns the status.** Don't set it yourself — with the one exception of the explicit resubmit round-trips (C8, C9).

*Depends on: J4, C4, C5, C8, C9, I1, I4.*

## J7 — Stage notes: the per-project extension point

One skill per agent-turn status, named after the status. The three procedure skills each load the one matching the node's current status **before writing anything to the board**.

This is where a project puts its own opinions: how large a PR should be, which work needs deep human review, what a spec should and shouldn't contain, how long a PR body runs. Worked long-vs-short examples work far better than adjectives.

The point of the split: the procedure skills are the product, the stage notes are the project. Fork the product without forking the taste.

*Depends on: J1.*

## J8 — Brevity budgets

Every word an agent puts on the board is read by a human. **Shorter is always better.** Bullets over paragraphs; drop preamble, restated context, and anything the human can already see on the node.

Defaults where the stage notes are silent — **ceilings, not targets**:

| Writing | Budget |
|---|---|
| Spec | 4-10 lines |
| Split proposal | one line per child, plus a line of reasoning |
| PR body | 5 bullets, on top of the fixed node marker |
| Question | 3 lines — what you need and why it blocks you |
| Note on a node | 1-2 lines |
| Review reply | as long as the point needs — on the PR, not the node |
| Resubmit note | 1 line |

Review replies are the exception: the reviewer asked something, so give the reasoning properly rather than clipping it to fit.

**Over budget means cut, not reformat.** The usual culprits are all things the human can already see: restating the node's title and body, narrating what you did rather than what changed, listing every file touched, and writing up checks the diff and CI already show.

*Depends on: J2.*

## J9 — Code style guide skill

Loaded whenever an agent writes or plans code. The rules that earned their place:

- **YAGNI.** No unnecessary abstractions, no scope expansion. If extra scope seems useful, **raise it as a question** instead.
- **Comments**: none at the top of functions or files just describing scope. A comment being necessary often means the code should be broken up further.
- **Environment variables**: validate with a schema at startup, not "fail when we hit an error".
- **Documentation** covers only what the code can't. Plans are fine in docs, but remove them once implemented. Anything derivable from code doesn't belong in docs.
- **No "nothing words"** — words that don't carry meaning.
- **File references are flimsy**: two-way references only, or a note saying "if X moves, change Y".
- **No barrel exports.**
- **No pre-emptive fallbacks or "in case" paths.** Strict scope. Error-handle user-facing things, but for anything non-user-facing, surface the failure.

*Depends on: J1.*

---

# K. Conventions and dev environment

## K1 — Code conventions

- TypeScript strict mode everywhere. No `any` unless unavoidable at a JSON boundary.
- Nothing in the data model is ever hard-deleted. Don't write code that deletes nodes, edges, messages, or events.
- Status names, message types, edge types, and color semantics are defined **once** in the contract document (A8) — never invent variants.
- Each package self-contained; no root workspace.

*Depends on: A7, A8.*

## K2 — Commands

- Web: `npm install && npm run dev` / `npm run build` (build = typecheck + bundle).
- CLI: `npm install && npm run build`; run via `dist/index.js` or `npm link`.
- Supabase: `supabase start` locally, `supabase db reset` to apply migrations + seed.

*Depends on: A7.*

## K3 — Migrations are numbered and forward-only

`0001_init.sql`, `0002_grants.sql`, … Each later migration is a focused change with its rationale in a header comment. Never edit a shipped migration; add another.

*Depends on: A7, B\*.*

## K4 — The non-negotiables checklist

Every package must satisfy all five:

1. **Exact enum strings** from the contract document.
2. **No hard deletes, ever.**
3. **Graph traversals: visited-set + depth cap 50.** Cycles are legal data.
4. **Agents get invalidated/stale context served to them, never filtered out.** The context dump serves everything; only the pickup list excludes stale nodes — they aren't actionable, but they're never hidden context.
5. **Secrets**: webhook secret only in repo secrets + the project row; anon key public by design; service-role key only inside Edge Functions; App private key only in the token function.

*Depends on: everything. This is the review checklist.*

---

# L. Deliberately out of scope

Recorded so you don't rediscover them as gaps:

- **Multi-tenant / teams.** Single user + their agents (A5).
- **Server-side LLM calls.** The board is a coordination surface (A4).
- **Deep GitHub integration.** PR linking + the Action loop is the whole of it (I\*).
- **Multiple repos per project.** One repo per project; changeable later (B1).
- **Cycle enforcement, recursion limits.** A soft depth cap of 50 and a visited-set instead (D5).
- **Notifications, inbox.** Graph coloring is the entire human signal for now (H4).
- **An agent that can approve a PR.** Would need a separate bot user account (I4).

Open items worth deciding early in a rebuild: SPA hosting; canvas SDK licensing (watermark on free tiers); search sophistication beyond Postgres full-text.

---

# M. Dependency map

Drop a chunk, check this column.

| Chunk | Depends on | Dropping it also breaks |
|---|---|---|
| A1-A2 | — | everything |
| A3 (history sacred) | A1 | B7, E1-E4, K4.2, K4.4 |
| A4 (no server LLM) | A1 | C7's supervisor design, J1 |
| A5-A8 | A1 | F1, K1, K3 |
| B1-B6 (tables) | A5-A6 | all of F, G, H |
| B7-B9 (triggers) | B3-B6 | H7 (needs B6), E3 |
| B10 (search) | B3, B5 | G2 search, H10 |
| C1 (statuses) | A2 | all of C, G, H, J |
| C3 (claim release) | C1 | C4's skip, J2 claim etiquette |
| C4 (spec skip) | C1, C3 | J5, J6 contract handling |
| C5 (human-only) | C1, D1 | J2 table, J5 flagging, H5 override |
| C6 (breakdown on merge) | C1, I2 | D2's rationale, H6 toggle |
| C7 (judge) | C1, D1, D4, A4 | D4, G3's gating |
| C8-C9 (PR side-loops) | C1, I2 | G2 resubmit, J6 sections |
| D1 (edges) | B4 | all of D, G3, H2-H3 |
| D2 (`_plan`) | D1, C6 | D3 exception, F5 payload, G3, H3 fading |
| D3 (coarse) | D1, D2 | J5's "don't replicate", H3 demotion |
| D4 (reassess) | D1, C7 | G3 gating |
| D5 (traversal) | D1 | F4, F5, H2, K4.3 |
| E1 (stale derived) | A3, D1, D5 | E2-E4, F4-F5, G3, G4, H5 |
| E2-E3 (invalidate/restore) | E1, B6 | H8, G2 |
| F1-F2 (RLS/secrets) | A5, B\* | I4's auth model, K4.5 |
| F3 (storage) | B3, F1 | G4 PNG download, H6 canvas |
| F4-F5 (RPCs) | E1, D2, D5 | G3, G4 |
| G1-G2 (CLI) | A4, C1, D1 | all of J |
| G3 (tasks) | G2, E1, D2-D4 | J3 |
| G4 (context) | F5, F3 | J2, J4 |
| H1-H10 (web) | B\*, C1 | nothing downstream |
| I1 (marker) | A1 | I2, I3, J6 |
| I2 (sync function) | I1, C6, C8, C9 | I3, the whole PR loop |
| I3 (action) | I1, I2 | automatic merge |
| I4 (app identity) | I1, F2 | J6's push, human approval being possible at all |
| J1-J9 (plugin) | G\*, C\* | agent participation |
