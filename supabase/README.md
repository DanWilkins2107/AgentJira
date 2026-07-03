# AgentJira — Supabase backend

The entire backend: Postgres schema + RLS + triggers + RPCs
(`migrations/0001_init.sql`), the private `canvases` storage bucket, the
`github-sync` Edge Function, and a local-dev seed. Contract:
[`docs/architecture.md`](../docs/architecture.md).

## Prerequisites

- [Supabase CLI](https://supabase.com/docs/guides/local-development/cli/getting-started)
- Docker (for local development)
- Deno (only if you want to typecheck/serve the Edge Function directly)

All commands below run from the **repo root** (the CLI finds `supabase/` from
there).

## Local development

```sh
supabase start          # boots Postgres, Auth, Storage, Studio, edge runtime
supabase db reset       # (re)applies migrations/0001_init.sql then seed.sql
```

`supabase start` (and `supabase status` any time later) prints what the other
packages need:

- **API URL** (`http://127.0.0.1:54321`) → `VITE_SUPABASE_URL` / `AGENTJIRA_URL`
- **anon key** → `VITE_SUPABASE_ANON_KEY` / `AGENTJIRA_ANON_KEY` (public by design)
- **service_role key** → only ever used by the Edge Function; never ship it to
  the web app or CLI
- **Studio** at `http://127.0.0.1:54323`

### Seeded logins (local only)

| Email | Password | Role |
|---|---|---|
| `dan@agentjira.local` | `agentjira-dev` | owner |
| `agent@agentjira.local` | `agentjira-dev` | agent |

The seed creates one sample project owned by dan (its vision node is created
automatically by trigger, status `human_braindump_needed`), adds the agent
user as an `agent` member, and pins the project's `webhook_secret` to
`agentjira-dev-webhook-secret` so you can exercise `github-sync` locally.

### Serving and testing the Edge Function locally

```sh
supabase functions serve github-sync
```

(`verify_jwt = false` is set in `config.toml` — the function authenticates via
the shared secret header, not a Supabase JWT.)

Smoke test against the seeded project (grab a node id from Studio or
`select id from nodes;`):

```sh
curl -s http://127.0.0.1:54321/functions/v1/github-sync \
  -H 'content-type: application/json' \
  -H 'x-agentjira-secret: agentjira-dev-webhook-secret' \
  -d '{
    "node_id": "<node-uuid>",
    "action": "pr_opened",
    "pr_url": "https://github.com/o/r/pull/7",
    "pr_number": 7,
    "repo": "o/r",
    "actor": "octocat"
  }'
```

Expect `{"ok":true}` and: node status → `pr_raised`, a `pr.opened` event, and
a `system` message on the node. Wrong secret → 401, unknown node → 404 (no
detail leaked, by design). Re-sending any action is harmless (idempotent).

Typecheck the function without the CLI:

```sh
cd supabase/functions/github-sync && deno check index.ts
```

## Cloud deployment

1. **Create a project** at <https://supabase.com/dashboard> (or
   `supabase projects create agentjira`). Note the project ref.

2. **Link and push the schema**:

   ```sh
   supabase link --project-ref <ref>
   supabase db push          # applies migrations/0001_init.sql
   ```

   Do **not** push `seed.sql` to cloud — it is local-dev convenience only.

3. **Deploy the Edge Function** (JWT verification off — it authenticates via
   the `x-agentjira-secret` header):

   ```sh
   supabase functions deploy github-sync --no-verify-jwt
   ```

   `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are injected automatically
   by the platform; no extra function secrets needed.

4. **Create the two users** in Dashboard → Authentication → Users → "Add
   user" (email/password, auto-confirm):
   - the owner (you) — used by the web app
   - the dedicated agent user — its credentials go in the `aj` CLI config
     (`AGENTJIRA_EMAIL` / `AGENTJIRA_PASSWORD`)

   Then create your project via the web app (or SQL editor); the trigger makes
   you `owner` and creates the vision node. Add the agent user as an `agent`
   member from the web app (owner-only operation under RLS).

5. **Wire up GitHub** for each project repo. The webhook secret lives in the
   `projects.webhook_secret` column (generated per project; the owner reads it
   from the web UI — agents never select it). Set repo secrets:
   - `AGENTJIRA_SYNC_URL` = `https://<ref>.supabase.co/functions/v1/github-sync`
   - `AGENTJIRA_SECRET` = that project's `webhook_secret`

   and install `gha/agentjira.yml` into the repo.

## What lives where

| Path | Contents |
|---|---|
| `config.toml` | Local stack config; declares `github-sync` with `verify_jwt = false` |
| `migrations/0001_init.sql` | Enums, tables, RLS, triggers, RPCs (`invalidate_node`, `search_all`, `node_context`), `canvases` bucket + storage policies |
| `functions/github-sync/` | Edge Function called by the GitHub Action |
| `seed.sql` | Local users + sample project |

## Invariants (enforced here, relied on everywhere)

- **No hard deletes.** `BEFORE DELETE OR TRUNCATE` triggers raise on `nodes`,
  `edges`, `messages`, `events`; `events` also rejects updates. There are no
  delete RLS policies on any table.
- **Every write is audited.** AFTER triggers append `events` rows (status
  transitions logged as `node.status_changed` with `{from, to}`).
- **RLS everywhere**, scoped by project membership via the security-definer
  `is_project_member(uuid)` helper. Storage access is scoped by the
  `{project_id}/{node_id}/{ISO-timestamp}.png` path prefix.
- **Graph traversals** (`invalidate_node`, `node_context`) carry a visited-set
  and a depth cap of 50 — cycles are legal data.
