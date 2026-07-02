# AgentJira — Decision Register

Distilled from the grilling session on 2026-07-02. **[transcript.md](transcript.md) is the verbatim source of truth**; if this summary and the transcript disagree, the transcript wins. The original sketch is [idea.png](idea.png).

## Product

An opinionated Jira alternative for AI agents and humans working together. Work lives in a freeform graph of nodes (not a kanban board). A vision node is braindumped by the human (text + tldraw canvas), agents propose splits into subnodes, small-enough nodes get a concise agent-written spec, humans approve at every stage, agents implement via PRs. Regular human intervention is a feature, not a failure mode. Full history — including invalidated nodes and the reasons — is permanent, searchable context for agents.

## Decisions

| Area | Decision |
|---|---|
| Tenancy | Single user + their agents. Owner-scoped RLS. |
| Agent runtime | External only: Claude Code sessions via the plugin. No server-side LLM calls; the board is a coordination surface, not an actor. |
| Stack | Vite SPA talking directly to Supabase (PostgREST + Edge Functions where needed). tldraw for canvases. |
| MVP scope | Everything except deep GitHub integration — PR linking + the GHA loop is enough. |
| Statuses | As heavy as possible. Flow: `human_braindump_needed` → `awaiting_agent_breakdown` → (`awaiting_human_question_response` loop) → split proposal status (chat-based, human approves) → `agent_spec` (tiny, concise spec) → human spec review → agent writes PR → up for review → human approval → agent merges. Separate "agent actively working" indicator alongside status. |
| Edges | Everything is an edge: one edges table, types `subtask` / `firm_block` / `soft_block` (+ `relates_to`). No cycle enforcement. No recursion limits (soft cap ~50 depth). |
| Split review | Agent proposes a rough split concisely in the node's chat; human approves; children materialize then. Proposal is a status. |
| Invalidation | Descendant work is always marked stale when an ancestor is invalidated. Norm is invalidate-and-recreate. Invalidation reasons stored; invalidated nodes remain first-class, readable, valuable context (not soft-deleted "trash"). |
| Claiming | Simple claim flag (`in_progress_by`); human clears stuck claims from the UI. |
| Conversations | Structured threads, scoped to node + node-stage. Typed messages. Cross-node access via some "get related information" mechanism. Messages searchable. |
| Canvas → agents | Every canvas save exports a PNG snapshot (Supabase Storage); agents read the image. |
| History | Keep all history of nodes, permanently. Everything is searchable context, including invalidated nodes and their reasons. |
| Agent auth | One dedicated agent Supabase user; credentials in plugin config; RLS grants project access via membership row. |
| Plugin shape | CLI tool wrapping a Supabase client + skills teaching the workflow (MCP acceptable if it turns out easier — optimize for easiest). |
| Search | Whatever's easiest for v1 (not key now). |
| PR loop | GitHub Action with a shared secret, doing **both**: reports PR state back to the tool (Edge Function callback) and performs the merge once approved + checks green. |
| Merge credential | The repo's own built-in `GITHUB_TOKEN` — workflow lives in each project repo, no long-lived credential anywhere. Branch protection must permit it; merge commit won't trigger downstream workflows. |
| Merge trigger | GitHub PR approval **alone** (+ checks green) is the final human approval — the GHA merges on it and reports back, flipping the node to done. The tool is *not* the source of truth for this final gate; the node's "human approval" stage = GitHub review. |
| PR ↔ node link | Agent embeds an `AgentJira-Node: <uuid>` marker (plus a human-clickable node URL) in the PR body; the GHA extracts it and includes it in the report-back callback. |
| Post-merge | Report-back flips the node to done with the merge SHA in the event log — nothing else. Unblocking of dependents is derived state computed from edges, never cascaded writes. |
| Graph layout | Auto-layout, directional flow (vision at top, leaves down the page; dagre/ELK-style). |
| Projects | Projects table above graphs; **one repo per project** for now (changeable later). |
| Node anatomy | Every node: title, freeform text, own tldraw canvas, stage-scoped threads, status, edges, spec, PR link. Stage-dependent emphasis — PR-stage nodes don't need the canvas in the same way. |
| Block semantics | All informational — agents use judgment. Soft-blocked work only picked up if nothing else to do *and* it's sensible (not too much of a stretch). |
| Human signal | Graph colouring only for now, with an obvious scheme: brighter colours where human intervention is needed. More (inbox, notifications) later. |
| Name | AgentJira as codename ("Jira" is trademarked — rename before any public release). |

## Open items (not yet decided)

- SPA hosting (Vercel / Netlify / Cloudflare Pages — any is fine for a Vite SPA).
- tldraw SDK licensing (free tier shows a watermark; fine for personal use, check before public release).
- "Diagrams for the stages at various points" (from the original brief) — interpreted as workflow-stage diagrams in docs/UI; not yet specified.
- Search implementation (likely Postgres FTS or plain `ilike` to start).
- Exact status enum names and the transition rules table.
