# AgentJira

An opinionated Jira alternative where AI agents and humans collaborate on work. Work lives in a **freeform graph of task nodes, not a kanban board**: a vision node at the top is braindumped by the human (text plus a tldraw canvas), agents propose splits into subnodes, small-enough nodes get a concise agent-written spec, and approved specs become PRs. Edges carry structure — subtasks, firm blocks, soft blocks, related context — and all of it is information for agents to use with judgment, never hard constraints.

Humans and agents **alternate turns**, and the node's status always says whose turn it is. Regular human intervention is a feature, not a failure mode: humans approve every split, every spec, and every PR (the GitHub review is the final gate — a GitHub Action then merges and flips the node to done). Agents work through the `aj` CLI from Claude Code sessions; the board itself never calls an LLM — it is a coordination surface, not an actor.

History is **permanent and searchable**. Nothing is ever deleted: when a premise turns out wrong, its node is invalidated with a recorded reason and its descendants are flagged stale. Invalidated nodes aren't trash — they are vital context that stops the next agent from repeating the mistake.

> **Name**: "AgentJira" is a working codename only — this project is not affiliated with Atlassian, and "Jira" is their trademark. It gets renamed before any public release.

## Monorepo layout

| Path | What |
|---|---|
| [`supabase/`](supabase/) | Migrations, RLS, triggers, and the `github-sync` Edge Function — the entire backend |
| [`web/`](web/) | Human-facing SPA: graph view, node detail, tldraw canvas |
| [`cli/`](cli/) | `aj` — the agent-facing CLI wrapping supabase-js |
| [`plugin/`](plugin/) | Claude Code plugin: skills teaching agents the workflow |
| [`gha/`](gha/) | GitHub Action workflow template installed into each project repo |
| [`docs/`](docs/) | [`architecture.md`](docs/architecture.md) (the contract) and [`workflow.md`](docs/workflow.md) (stage diagrams) |
| [`brief/`](brief/) | Founding brief — verbatim [transcript](brief/transcript.md) and [decision register](brief/decisions.md); historical record, do not edit |

## Quickstart

Set up each piece in order — each README hands off to the next:

1. **Backend** — [`supabase/README.md`](supabase/README.md): start Supabase, apply migrations, seed the owner + agent users.
2. **Web app** — [`web/README.md`](web/README.md): run the SPA, create a project (its vision node is created automatically), braindump on it.
3. **CLI** — [`cli/README.md`](cli/README.md): install `aj`, log in as the agent user, run `aj tasks`.
4. **Plugin** — [`plugin/README.md`](plugin/README.md): install the Claude Code plugin so agent sessions know the workflow.
5. **GitHub Action** — [`gha/README.md`](gha/README.md): install the workflow + secrets into your project repo to close the PR loop.

## Status colors — brighter means a human is needed

| Status | Color | |
|---|---|---|
| `human_braindump_needed` | bright magenta | `#e91e63` |
| `awaiting_human_response` | bright orange | `#ff9800` |
| `split_proposed` | bright amber | `#ffc107` |
| `spec_review` | bright yellow-green | `#cddc39` |
| `awaiting_agent_breakdown` | muted blue | `#5c7cfa` |
| `split_approved` | muted indigo | `#4263eb` |
| `awaiting_agent_spec` | muted cyan | `#22b8cf` |
| `ready_for_pickup` | muted teal | `#12b886` |
| `pr_raised` | purple | `#9775fa` |
| `broken_down` | gray-blue at 50% | `#748ffc` |
| `done` | muted green at 70% | `#40c057` |
| `invalidated` | gray | `#868e96` |

Plus: a dashed amber ring means `stale` (an ancestor was invalidated); a pulsing dot means an agent has the node claimed.

## Learn more

- [`docs/workflow.md`](docs/workflow.md) — the stage diagrams: status machine, breakdown loop, PR endgame, invalidation.
- [`docs/architecture.md`](docs/architecture.md) — the technical contract: enums, schema, RPCs, CLI, plugin, GHA.
- [`brief/transcript.md`](brief/transcript.md) + [`brief/decisions.md`](brief/decisions.md) — why it is the way it is.
