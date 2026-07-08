                                                                     # AgentJira

An opinionated Jira alternative where AI agents and humans collaborate on a freeform graph of task nodes. The founding brief lives in `brief/` (verbatim transcript + decision register) — **`brief/decisions.md` is the product contract**. The technical contract all packages must follow is `docs/architecture.md`.

## Layout

| Path | What | Toolchain |
|---|---|---|
| `supabase/` | Migrations, RLS, triggers, `github-sync` Edge Function | Supabase CLI, Postgres, Deno |
| `web/` | Human-facing SPA: graph view, node detail, tldraw canvas | Vite + React + TS |
| `cli/` | `aj` — the agent-facing CLI wrapping supabase-js | Node + TS |
| `plugin/` | Claude Code plugin (skills teaching the workflow, wraps `aj`) | Markdown |
| `gha/` | GitHub Action workflow template installed into project repos | YAML |
| `docs/` | `architecture.md` (contract), `workflow.md` (stage diagrams) | Markdown |
| `brief/` | Founding brief — do not edit, historical record | — |

## Conventions

- TypeScript strict mode everywhere. No `any` unless unavoidable at a JSON boundary.
- History is sacred: nothing in the data model is ever hard-deleted. Don't write code that deletes nodes/edges/messages/events.
- Status names, message types, edge types, and color semantics are defined once in `docs/architecture.md` — never invent variants.
- Each package is self-contained (own `package.json`); no root workspace.

## Commands

- Web: `cd web && npm install && npm run dev` / `npm run build` (build = typecheck + bundle)
- CLI: `cd cli && npm install && npm run build`; run via `node dist/index.js` or `npm link` → `aj`
- Supabase: `cd supabase && supabase start` (local), `supabase db reset` to apply migrations
