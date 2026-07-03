# AgentJira — web

The human-facing SPA: projects, the task graph, node detail with tldraw canvas, staged threads, history, and edges. Talks directly to Supabase (see `docs/architecture.md` for the contract).

## Stack

Vite + React 18 + TypeScript (strict) + react-router-dom + @supabase/supabase-js + @xyflow/react + @dagrejs/dagre + tldraw.

## Setup

```bash
cd web
npm install
cp .env.example .env   # then fill in the values
```

`.env`:

| Var | Value |
|---|---|
| `VITE_SUPABASE_URL` | Your Supabase project URL (local: `http://127.0.0.1:54321`) |
| `VITE_SUPABASE_ANON_KEY` | The anon key (public by design) |

## Run

```bash
npm run dev      # dev server
npm run build    # typecheck (tsc) + production bundle
npm run preview  # serve the production build
```

## Routes

| Route | What |
|---|---|
| `/login` | Email/password sign-in |
| `/` | Projects list + create; per-project settings (repo, webhook secret, GHA install, add member) |
| `/p/:projectId` | Graph view (dagre layout, status colors, legend, search) |
| `/n/:nodeId` | Node detail: actions, body, canvas, threads, history, edges, spec/PR |
