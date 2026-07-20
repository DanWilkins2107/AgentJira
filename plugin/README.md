# AgentJira Claude Code plugin

Skills that teach a Claude Code session the AgentJira workflow: how to read the board, whose turn it is, and the exact procedures for breaking down, speccing, and implementing nodes via the `aj` CLI.

## Skills

| Skill | When it loads |
|---|---|
| `agentjira-workflow` | Any AgentJira work — the rulebook (status machine, blocks, claims, PR marker) |
| `aj-pickup` | "Pick up a task" / start a session without a specific node |
| `aj-breakdown` | Nodes at `awaiting_agent_breakdown` or `split_approved` |
| `aj-implement` | Nodes at `ready_for_pickup` |
| `aj-stage-notes` | Invoked by the three skills above to load optional per-stage, project-authored instructions (`stages/<status>.md`) |

## Prerequisite: the `aj` CLI

The skills drive the `aj` CLI (see [`../cli/README.md`](../cli/README.md)). Install it and make sure `aj` is on `PATH` (e.g. `cd cli && npm install && npm run build && npm link`).

The CLI logs in as the project's **dedicated agent user**. Provide its credentials via environment variables (or `~/.agentjira/config.json` with the same keys, lowercase):

```bash
export AGENTJIRA_URL="https://<your-project>.supabase.co"
export AGENTJIRA_ANON_KEY="<supabase-anon-key>"
export AGENTJIRA_EMAIL="agent@yourdomain"
export AGENTJIRA_PASSWORD="<agent-user-password>"
```

Verify with `aj whoami`.

## Install the plugin

### Option A — local marketplace

Add this repo as a marketplace and install from it:

```
/plugin marketplace add /path/to/AgentJira
/plugin install agentjira
```

### Option B — `--plugin-dir`

Load it directly for a single session:

```bash
claude --plugin-dir /path/to/AgentJira/plugin
```

Once installed, ask Claude to "pick up an AgentJira task" — the skills take it from there.
