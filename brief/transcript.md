# AgentJira — Grilling Transcript (verbatim)

Date: 2026-07-02
Participants: Dan (human), Claude (agent)
Referenced file: [idea.png](idea.png)

This is a verbatim transcript of the initial idea braindump and the full Q&A grilling session. Nothing is paraphrased. Question option labels/descriptions are reproduced as asked; answers are reproduced exactly as given (including freeform notes).

---

## Dan — original message

> I've got an idea.png file to reference. Basically I want to make an opinionated Jira alternative for AI Agents and Humans to combine in a more effective manner. How I want this to work is as follows. Tasks follow a specific working diagram, and get split out from nodes. We should have a history of nodes and splits that have occured, and we should have human intervention very regularly to illustrate the vision the human has. How this should work in more detail: We start with a singular big node that's the overall vision. This is where the human can essentially braindump what they want (sometimes in quite vague terms, and with a tldraw-style (if not tldraw itself)) canvas, as well as free form text. From here, the idea is we have a general direction, going either up or down the page, and it's a general graph. Similarly to jira tickets, we have nodes of the graph. However our nodes are far more linked to each other in a natural, graph format, and we don't have the same style of kanban board or anything, the main page is like the top left of the provided picture but with nodes of different colours that a user can click through, kind of like a knowledge graph. For big nodes, we have breakdown stages. Basically the idea is the human provides some direction, then the agent proposes a split into subnodes, and we have "awaiting human" and "awaiting agent" phases. When a task gets small enough (can be after several high level splits, and generally will be focusing on the earlier nodes in a blocking series), the agent then writes an implementation spec. At this point one node = one pr sort of size. Then the human approves/rejects, providing context in the form of drawings etc. Then, an agent will be able to see a specific status, and pick up the PR, and will complete it and raise for review. Everything will be navigatable for both agents and humans from the site, including github back to the site etc. I also want a claude plugin to be made alongside to install this and be able to run this super-effectively. Links between will include firm-blocks, soft-blocks (idea being the ideal is to not pick X up because there's some dependency on Y (or shared decisions) but you could pick it up if needed), subtasks (where nodes spike out the main node). Importantly, there's no concept of recursion limits (maybe an upper limit of like 50) - it's important that this is really freeform. We also want to have a detailed history with node invalidation. I've had it before where an earlier decision from an agent is just wrong and needs rectifying, and agents should be able to access this vital context, as well as any context from nodes that have been previously shut off. Use supabase for the backend on this, should be authenticated, we'll provide the agent with a login. RLS etc is critical too. Ideally we have diagrams for the stages at various points too. Grill me with any outstanding questions, after ingesting the (vague) diagram

## Claude — diagram ingestion

> Diagram ingested — I can see the flow: Overall Graph View → click into a big node → "Context Gather from User" stage (statuses, nodelinks, sublinks, canvas, free text) → split into subtasks; small-enough nodes get an Agent Written Spec (Brief) → onward to implementation. Now let me grill you properly.

The diagram (idea.png) shows: an "Overall Graph View" panel (top-left, sketchy figures), an arrow labelled "Click into a big node" to a "Context Gather from User Stage" panel (containing **Statuses**, **Nodelinks**, **Sublinks**, **Canvas**, **Free text box**), an arrow out labelled "Split into subtasks" which loops back down, an arrow from the graph view labelled "Click into small enough node" to an "Agent Written Spec (Brief)" panel, with further arrows onward/down.

---

## Round 1 — Foundations

> Claude: I'll walk the decision tree in dependency order, batching related questions per round (freeform "Other" is always available). Round 1 is the foundational stuff — everything else hangs off these.

### Q1.1 — Tenancy
**Who is this for in v1? This drives the entire RLS/tenancy design — the difference between 'a projects table with an owner column' and full org/membership/role modeling.**

- **Single user + their agents** — You and your agent logins, possibly multiple projects. RLS is simple (owner-scoped), ships fastest. Can evolve to teams later but RLS policies will need rework.
- **Small team, single org** — A handful of humans + agents sharing projects. Needs membership tables and role-aware RLS from day one, but no org-switching UI.
- **Multi-tenant SaaS from day one** — Orgs, invites, per-org agents. Most upfront schema/RLS work; slowest to first useful version. Only worth it if you intend others to sign up soon.

**Dan:** `Single user + their agents`

### Q1.2 — Agent runtime
**Where does the agent actually run? The diagram has agents proposing splits and writing specs — someone has to execute those LLM calls. This is the biggest architectural fork.**

- **External only (Claude Code)** — The product is a passive coordination board. Claude Code sessions (via your plugin) poll for 'awaiting agent' nodes, do splits/specs/implementation locally, write results back via API. No server-side LLM costs or keys, but nothing happens unless a session is running.
- **Server-side agent built in** — Backend (e.g. Supabase Edge Functions calling the Claude API) does splits and spec-writing automatically when a node enters 'awaiting agent'. Implementation/PRs still happen in Claude Code. Board feels alive on its own, but you're managing API keys, costs, and long-running function limits.
- **Hybrid: server plans, Claude Code implements** — Splits + specs run server-side via Claude API; implementation nodes get picked up by Claude Code via the plugin. Matches the workflow's two distinct agent roles, at the cost of building both integration paths.

**Dan:** `External only (Claude Code)`

### Q1.3 — Stack
**What's the frontend stack? The graph canvas + tldraw embedding is the hardest UI piece, so the stack choice matters.**

- **Next.js + tldraw + React Flow** — tldraw SDK for the freeform braindump canvas, React Flow (or similar) for the node graph view. Battle-tested, both are React-native libraries. Vercel-deployable, API routes available for GitHub webhooks.
- **Vite SPA + Supabase directly** — Lighter: no server framework, client talks straight to Supabase. Simpler mental model but GitHub webhooks and agent-facing API endpoints need Edge Functions for everything.
- **tldraw for everything** — Use tldraw itself as the graph view too (custom shapes for nodes, arrows for edges). One canvas paradigm everywhere, maximum freeform feel — but you build graph semantics (auto-layout, click-through navigation, status coloring) yourself on top of a drawing tool.

**Dan:** `Vite SPA + Supabase directly`

### Q1.4 — MVP scope
**What's the MVP cut? The full vision is web app + workflow engine + GitHub two-way integration + Claude plugin. What must exist before it's useful to you?**

- **Thin vertical slice, all parts** — One project, minimal UI, but the full loop works: braindump → split → spec → approve → Claude Code picks it up → PR link back. Proves the concept end-to-end fastest; every part is rough.
- **Web app + workflow first** — Graph, nodes, splits, statuses, canvas, history — all in the web app. GitHub integration and the plugin come in phase 2. You get a polished core but can't actually dispatch work to agents yet.
- **Plugin/API first, UI minimal** — Nail the agent-facing API + Claude plugin so agents can work the graph immediately; the human UI starts as something barebones. Useful if you'd rather drive it from Claude Code than a browser initially.

**Dan:** `We don't need github integration per se, more just enablement to link to PRs etc. Apart form that I want the rest of them. `

> Claude: Round 1 locked: single-user + agent logins, agents run externally via Claude Code only, Vite SPA talking straight to Supabase, MVP includes everything except deep GitHub integration (just PR links).
>
> Note one consequence to keep in mind: with external-only agents, nothing happens while no Claude Code session is running — the board is a coordination surface, not an actor. That fits the "human intervention very regularly" ethos, so I think it's right.

---

## Round 2 — Graph & workflow semantics

### Q2.1 — Statuses
**What's the node status state machine? You mentioned 'awaiting human' and 'awaiting agent' phases, plus spec/approval/PR stages. How granular should statuses be?**

- **Rich fixed set (~9 states)** — e.g. draft → awaiting_agent_split → awaiting_human_review → awaiting_spec → spec_review → ready_for_pickup → in_progress → pr_raised → done, plus invalidated/blocked. Agents always know exactly what's expected of them; more states to render and enforce.
- **Two axes: phase + turn** — Separate 'whose turn is it' (awaiting_human / awaiting_agent) from 'lifecycle phase' (breakdown / spec / implementation / done). Cleaner model — the turn flag is the universal work-queue signal — but two fields to keep consistent.
- **Minimal (~5 states)** — open → awaiting_agent → awaiting_human → in_progress → done (+invalidated). What kind of agent work is needed gets inferred from node size/context. Least ceremony, but agents must guess whether to split or spec.

**Dan (freeform):** `This should be as heavy as possible. I want to have: 1. Human braindump needed - this is when the human needs to provide some information. Once that's provided we move to "Awaiting agent breakdown" (note if somethings in progress by an agent we need some form of separate indicator I think). We also have "Awaiting human question response" where the agent has some idea of the task, but needs specifics answering. Then once the tasks are small enough we have "agent spec" where the agent writes a tiny (concise) spec. + human review here. then agent writes PR. Agent puts up for review. Human approval. Agent merges.`

### Q2.2 — Edges
**Edge semantics: you named firm-blocks, soft-blocks, and subtask edges. Should block-edges be constrained to a DAG (no cycles), and is 'subtask' a separate parent-child relationship or just another edge type?**

- **Parent-child + typed edges, DAG-enforced blocks** — Subtask = a parent_id column (a tree backbone, matches 'splits'). firm_block/soft_block/relates_to = rows in an edges table, with a DB-level cycle check on firm blocks. Predictable topology; the check trigger is some work.
- **Everything is an edge, no cycle enforcement** — One edges table with type ∈ {subtask, firm_block, soft_block, relates_to}. Maximally freeform (matches your 'no recursion limits' instinct); UI/agents must tolerate cycles, and 'is this node blocked?' becomes a graph traversal that might loop.
- **Parent-child + edges, cycles allowed but flagged** — Tree backbone via parent_id, typed edges unconstrained, but the UI/API surfaces cycle warnings rather than rejecting them. Freeform with guardrails; agents get a 'this dependency is circular' signal instead of an error.

**Dan:** `Everything is an edge, no cycle enforcement`

### Q2.3 — Split review
**When an agent proposes a split of a big node, how does the human review it? This defines the core interaction loop.**

- **Proposal object, atomic accept/reject/edit** — The split is a first-class 'proposal' row: proposed child nodes shown as ghosts on the graph, human accepts all / rejects / edits titles & boundaries before materializing. Cleanest history ('proposal #3 accepted with edits'), most build work.
- **Agent creates children directly, human prunes** — Agent materializes child nodes immediately in a 'proposed' status; human deletes/merges/edits them in place on the graph. Less machinery, feels hands-on; history is messier (no single accept/reject event) and a bad split litters the graph.
- **Chat-style iteration, then materialize** — Split negotiation happens as threaded comments on the parent (agent proposes in text, human replies), and only the final agreed split becomes nodes. Cheap to build, keeps graph clean, but the proposal isn't visual/spatial until accepted.

**Dan (freeform):** `Good point this may be another status. Agent should propose a rough split concisely in a chat, human then approves`

### Q2.4 — Invalidation
**Invalidation semantics: when a node (or a decision inside it) is marked wrong, what happens to work that descended from it?**

- **Cascade to 'stale', human confirms each** — Invalidating a node auto-marks all descendants (and firm-block dependents) as 'stale — ancestor invalidated'; each needs human confirmation to either re-validate or invalidate. Safe and explicit; can create a lot of confirmation work on big subtrees.
- **Mark only, no cascade** — Invalidation affects just that node; descendants keep working state but the graph shows the invalid ancestor. Zero friction, but nothing stops an agent picking up a task whose premise is dead — agents must check ancestor validity themselves.
- **Hard cascade, auto-invalidate subtree** — Invalidating a node invalidates its whole subtree in one action (all preserved in history, restorable). Fast and decisive; risks nuking still-valid grandchildren that would survive the corrected premise.

**Dan (freeform):** `Whole point is that work descended from nodes is always marked as stale. Some is possibly recoverable in some worlds - in the sense of if it's far enough down the line, but probably easiest is to just invalidate and recreate..`

> Claude: Locked in: heavy state machine (braindump → agent breakdown → human Q&A loop → split proposal via chat → spec → spec review → PR → human approval → agent merges, with a separate "agent actively working" indicator), everything-is-an-edge with cycles allowed, chat-based split proposals, and hard cascade invalidation (descendants go stale; invalidate-and-recreate is the norm).

---

## Round 3 — Agent mechanics

### Q3.1 — Claiming
**The 'agent is actively working on this' indicator: how should agents claim a node so two Claude Code sessions don't pick up the same work?**

- **Lease with expiry + heartbeat** — Agent claims a node (claimed_by, claimed_at); the claim expires after e.g. 15 min unless the agent heartbeats. Dead sessions self-heal, and the UI shows a live 'agent working' pulse. Slightly more plugin machinery (heartbeat calls).
- **Simple claim flag, human unsticks** — Agent sets in_progress_by; if a session dies, the human clears it manually from the UI. Trivial to build; stuck claims are on you to notice, which is fine at single-user scale.
- **No lock, last-write-wins** — Agents just work and post results; collisions are rare with one human dispatching. Zero machinery, but two sessions on the same node will happen eventually and waste tokens.

**Dan:** `Simple claim flag, human unsticks`

### Q3.2 — Node chat
**Where do the conversations live — the split proposals, agent questions ('awaiting human question response'), and general back-and-forth?**

- **One thread per node, typed messages** — Every node has a single chronological thread; messages carry a type (question, answer, split_proposal, spec, review_comment, note) and author (human/agent). One place to read a node's whole story; agents fetch it as context. Long threads on big nodes.
- **Structured Q&A + separate proposals** — Questions/answers are first-class rows (agents can query 'unanswered questions'), split proposals are their own entity with approve state, plus a freeform notes thread. More queryable for agents, three surfaces for the human to check per node.
- **Freeform thread, conventions only** — Plain markdown comments; agents follow prompt conventions ('prefix questions with Q:'). Fastest to build; statuses like 'awaiting human question response' can't be auto-derived from data, agents parse text.

**Dan (freeform):** `conversations live on the node and the node-stage. Should be easily accessible from other nodes via some sort of get related information. Also ideally messages should be generally searchable. Generally, structured threads is the way I want to go here`

### Q3.3 — Canvas→agent
**How do agents consume the tldraw canvas drawings? Claude Code can read images, so this determines what the API serves.**

- **PNG snapshot per save, served to agents** — Every canvas save exports a PNG to Supabase Storage; the plugin downloads it and Claude reads it visually. Agents see exactly what you drew, including vague sketches. Text inside drawings comes through as pixels only.
- **PNG + extracted text** — Snapshot PNG plus a text dump of tldraw text/labels/arrows-with-labels from the JSON. Agents get both the visual and searchable text; a bit more export logic.
- **tldraw JSON only** — Serve the raw shape JSON; agents parse geometry and labels. No storage/export pipeline, but Claude reading raw shape coordinates is far weaker than seeing the image — not recommended for vague sketches.

**Dan:** `PNG snapshot per save, served to agents`

### Q3.4 — History
**History model: you want detailed history with invalidated-node context accessible to agents. How should history be stored?**

- **Append-only event log + soft-delete everything** — Every mutation (status change, edit, split, claim, invalidation) is an events row; nodes/edges are never hard-deleted, only flagged. Agents query 'full history of this node and its invalidated ancestors' cheaply. The log becomes the audit trail and the 'why' record.
- **Current-state + snapshots on key transitions** — Nodes hold current state; a snapshot copy is taken at each status transition and at invalidation. Simpler queries for 'what did the spec say when approved', but between-snapshot edits are lost and there's no unified timeline.
- **Current-state only, invalidated nodes kept** — No event log — invalidated nodes just stay readable with a reason field. Lightest build; you lose the 'what happened when and why' timeline you said you wanted, so probably too thin.

**Dan (freeform):** `So I want to keep all history of nodes. This doesn't mean soft delete - they're intentionally kept as they have valuable history. The reasons for node invalidation should be stored and everything. Everything is context that needs to be searchable.`

> Claude: Locked: simple claim flag, structured threads scoped to node + stage (searchable, with cross-node "get related info"), PNG snapshots of the canvas for agents, and full permanent history — invalidated nodes are first-class, valuable context with stored reasons, everything searchable.

---

## Round 4 — Agent-facing surface

### Q4.1 — Agent auth
**How do agents authenticate? You said 'we'll provide the agent with a login' and RLS is critical. This shapes the RLS policies and the audit trail.**

- **One dedicated agent Supabase user** — A single real Supabase account (agent@…) whose credentials live in the plugin config. RLS grants it access to your projects via a membership row; every write is attributable to 'the agent'. Simple; you can't tell two concurrent sessions apart except via the claim flag.
- **Agent user + per-session identity** — Same single agent account, but every API write carries a session label (e.g. machine + session id) stored on events/messages. You can tell which session did what — useful when running multiple Claude Code sessions in parallel. Slightly more plugin config.
- **Multiple named agent accounts** — Create agent users as needed (agent-frontend@, agent-backend@). Richest attribution and per-agent RLS possible, but managing several sets of credentials is ceremony you likely don't need at single-user scale.

**Dan:** `One dedicated agent Supabase user`

### Q4.2 — Plugin shape
**What form does the Claude plugin take? This decides how Claude Code sessions actually interact with the system.**

- **MCP server (tools) + skills** — An MCP server exposing typed tools (list_my_tasks, get_node_context, post_message, propose_split, claim_node, submit_spec, link_pr…) plus skills that teach the workflow (/pickup, /breakdown). Tools are discoverable and schema-validated; MCP server is a real component to build and version.
- **Skills + REST via curl** — No MCP server — skills document a REST API (Supabase PostgREST + Edge Functions) and Claude calls it with curl/Bash. Much less to build and maintain; every interaction burns tokens on request construction and error handling, and there's no schema safety.
- **CLI tool + skills** — Ship a small CLI (aj pickup, aj context <id>) the plugin installs; skills teach its usage. Nice ergonomics and human-usable too, but you're now maintaining a CLI, its auth storage, and cross-platform installs.

**Dan (freeform):** `Probably this for now assuming it's easiest. If MCP is easiest then MCP, but I think just a CLI tool wrapping a supabase client is easiest`

### Q4.3 — Search
**'Everything is context that needs to be searchable' — what search does v1 need? This affects schema (pgvector or not) and whether something must generate embeddings.**

- **Postgres full-text search only** — FTS indexes over node titles/bodies/messages/specs/invalidation reasons. Zero external dependencies, works entirely inside Supabase, good for keyword recall. Won't find conceptually-related-but-differently-worded content.
- **FTS now, pgvector-ready schema** — Ship FTS, but design content tables so an embedding column + backfill can be added later without migration pain. Defers the 'who generates embeddings and with whose API key' question until the corpus is big enough to need it.
- **Semantic search from day one** — pgvector + an Edge Function generating embeddings on write (needs an embeddings API key server-side — note this contradicts 'external only' agents slightly). Best 'get related information' quality; most moving parts and ongoing cost.

**Dan (freeform):** `Whatever's easiest. This isn't key for now`

### Q4.4 — PR loop
**The endgame states: agent raises PR → human approval → agent merges. Where does the human approve — in this tool, on GitHub, or both?**

- **Approve in the tool; GitHub is just linked** — Node holds pr_url; human reviews on GitHub but clicks 'approve' in this tool, which flips status to awaiting_merge; agent sees it and merges. Single source of truth for workflow state; requires you to approve in two places (GitHub review + tool) or skip GitHub reviews.
- **GitHub approval is the signal** — Human approves the PR on GitHub; the agent (when next running) checks PR review state via gh and merges, then updates the node. No double-approval, but the tool's status lags reality until an agent session syncs it — and the tool can't show 'approved' on its own.
- **Tool approval, agent verifies GitHub too** — Tool status is authoritative for the workflow, but the merging agent also confirms the PR is green/approved on GitHub before merging. Belt and braces; approval friction stays in the tool.

**Dan (freeform):** `I think this might be where I want a link actually, we'll want a GHA for this. Potentially we can provide a username/password for Github, or more likely some sort of secret`

## Dan — mid-session request

> Once we're done asking questions, can we also save all this (basically a transcript - do not paraphrase) into a brief folder, with idea.png too. Including my original message, just everything so far.

---

## Round 5 — GHA, graph UX, node anatomy

### Q5.1 — GHA role
**You said the PR approval loop wants a GHA with some sort of secret. Which direction does that integration flow?**

- **GHA reports back to the tool** — A workflow in your repos fires on PR events (opened, approved, merged) and POSTs to a Supabase Edge Function with a shared secret, updating the linked node's status automatically. Tool stays current without an agent session running; merging is still done by human or agent normally.
- **GHA performs the merge** — Human approves (in tool or GitHub); a GHA merges the PR when conditions are met and reports back. Closes the loop without needing an agent session to merge, but a bot merging via Action needs repo write tokens and careful conditions — more security surface.
- **Both: report + merge** — GHA syncs PR state to the tool and also auto-merges once the node hits 'approved' + checks green. Fullest automation of the endgame; most moving parts and the most trust placed in the pipeline.

**Dan:** `Both: report + merge`

### Q5.2 — Graph layout
**The main graph view: how are nodes positioned on the knowledge-graph-style canvas?**

- **Auto-layout, directional flow** — Hierarchical auto-layout (e.g. dagre/ELK) following your 'general direction down the page' — vision at top, leaves at bottom, edges routed. Always tidy, zero user effort; you can't spatially arrange nodes to encode your own meaning.
- **Manual positions, persisted** — You (and agents, when materializing splits) place nodes; x/y stored per node. Maximum freeform spatial meaning — closest to a real whiteboard — but big graphs need you to do the gardening.
- **Auto-layout default, manual override** — New nodes get auto-placed in the flow direction; any node can be dragged and its position pinned. Middle ground; some complexity in mixing pinned and auto nodes.

**Dan:** `Auto-layout, directional flow`

### Q5.3 — Projects
**Project scoping: is there a 'project' level above the graph, and does it tie to a GitHub repo?**

- **Projects table, one repo each** — Each project = one graph, one vision node, one associated GitHub repo (used for PR links and the GHA secret). Clean mapping; multi-repo products need multiple projects or a later change.
- **Projects table, repos optional/multiple** — A project can list zero or more repos; PR links carry their own repo context. Handles monorepo-less products and infra+app splits; slightly looser data model.
- **No projects — one big graph** — The whole tool is a single universe of nodes; 'projects' are just big vision nodes. Simplest schema and matches 'everything is a graph' purism, but unrelated ventures share one canvas and search space.

**Dan (freeform):** `Yeha probably should have an option for splitting out projects actually. `

### Q5.4 — Node contents
**Node anatomy: what does every node carry? The diagram's context-gather stage shows statuses, nodelinks, sublinks, canvas, free text.**

- **Every node: text + canvas + threads** — Title, freeform markdown body, its own tldraw canvas (PNG-snapshotted for agents), stage-scoped threads, status, edges. Uniform — you can sketch on any node at any level. Lots of canvases; most will stay empty on small nodes.
- **Canvas on vision/big nodes only** — All nodes get text + threads; canvases exist only where breakdown happens (vision node and nodes being split). Fewer empty canvases and snapshots; you lose 'sketch anywhere', and 'is this node canvas-worthy' is a distinction to maintain.
- **One shared canvas per project** — A single project-level tldraw board; nodes reference regions/frames of it. Whiteboard purism, but region↔node mapping is fiddly and agent snapshots get noisy.

**Dan (freeform):** `Every node has it's own text, canvas, threads etc. This does depend on stage, once I get to the PR stage I probably don't need this in quite the same way.`

> Claude: Locked: GHA both reports PR state back and performs the merge, auto-layout directional graph, projects exist as a level above graphs, and every node carries text + canvas + threads, with stage-dependent emphasis (PR-stage nodes lean on spec/PR link rather than canvas).

---

## Round 6 — Loose ends

### Q6.1 — Repo mapping
**Project ↔ repo mapping: when a project exists, how does it relate to GitHub repos (for PR links and the GHA secret)?**

- **Repos optional, multiple per project** — A project lists zero or more repos; each PR link carries its repo. Flexible for app+infra splits and non-code projects; the GHA secret is per-repo config anyway, so this costs little.
- **Exactly one repo per project** — Tightest mapping: project = repo. Simplest UI and GHA setup; multi-repo work needs multiple projects with cross-project edges (or lacks them).
- **No formal mapping** — pr_url is just a URL field; repos aren't modeled at all. Least schema, but the GHA callback has to find nodes by URL matching alone and there's nowhere to hang per-repo config.

**Dan (freeform):** `One repo per project for now, we can probably change that later`

### Q6.2 — Block rules
**Blocking semantics at pickup time: how do firm-blocks and soft-blocks affect what an agent is allowed to claim?**

- **Firm = hard stop, soft = warn** — list_my_tasks excludes firm-blocked nodes outright (blocker not done); soft-blocked nodes appear with a warning the agent should relay to you before claiming. Matches your 'ideal is to not pick X up, but you could' framing exactly.
- **Both advisory, agent decides** — Everything shows in the task list with block annotations; agents use judgment. Maximum freeform, but an eager agent will happily start firm-blocked work.
- **Firm = hard stop, soft = human unlock** — Soft-blocked nodes need you to explicitly mark 'ok to start early' before an agent can claim. Safest; adds a human step to precisely the situations you wanted to keep fluid.

**Dan (freeform):** `It's all information for the agent. It should be clear enough to the agent that they should only pick up soft blocked work if they have nothing else to do, and also only in the case that it's sensible - i.e. not too much of a stretch`

### Q6.3 — Human inbox
**How does the human know work is waiting on them (braindumps needed, questions to answer, specs and splits to review)?**

- **Inbox panel in the app** — A sidebar listing every node in an awaiting-human status, grouped by type (questions, split reviews, spec reviews, braindumps). You check when you visit; no infra beyond a query. Graph nodes also glow by status color.
- **Inbox + push notifications** — Inbox panel plus browser push / ntfy / email via an Edge Function when a node flips to awaiting-human. You hear about it while doing other things; notification plumbing to build and tune.
- **Graph coloring only** — No inbox — status colors on the graph are the signal. Purist, but 'what needs me right now' requires visually scanning the whole graph every time.

**Dan (freeform):** `For now, graph colouring. We'll add more later. Make sure to have an obvious scheme, e.g. brighter colours where human intervention needed`

### Q6.4 — Name
**What's the product called? The working dir says AgentJira — fine as a codename, but it'll leak into package names, the CLI command, plugin name, and the repo.**

- **Keep AgentJira for now** — Ship under the codename, rename later if it ever goes public. Zero time spent; 'Jira' is an Atlassian trademark so it can't survive going public.
- **Pick a real name now** — Choose the permanent name before the CLI command, plugin id, and DB project get minted — renames later touch everything. Costs a naming decision today (suggest one in Other, or I can propose options).

**Dan:** `Keep AgentJira for now`

---

## Dan — follow-up request

> Quickly grill me on that. Note I've deleted the original idea.png

("that" = the GHA report+merge flow flagged as the piece with the most security surface. The copy at brief/idea.png survives.)

---

## Round 7 — GHA report+merge design

### Q7.1 — Merge token
**What credential does the merge run on? This is the main security-surface decision.**

- **Repo's own GITHUB_TOKEN (Recommended)** — The workflow lives in each project's repo and merges with the built-in GITHUB_TOKEN — no long-lived credential exists anywhere, scope is automatically just that repo. Constraint: branch protection must allow it, and it can't trigger further workflows on the merge commit (usually fine).
- **Fine-grained PAT as repo secret** — A PAT (contents+PRs write, scoped per repo) stored as an Actions secret. Works even where GITHUB_TOKEN is restricted and the merge can trigger downstream workflows; but now there's a credential to rotate and leak.
- **GitHub App** — An app installation token minted per run. Cleanest audit trail ('AgentJira bot merged this') and survives going multi-user; meaningful setup overhead for a single-user tool.

**Dan:** `Repo's own GITHUB_TOKEN (Recommended)`

### Q7.2 — Merge signal
**What is the actual merge trigger — what must be true before the GHA merges?**

- **GitHub approval + node approved (both)** — GHA fires on pull_request_review; before merging it calls an Edge Function (with the shared secret) to confirm the linked node is in 'human approved' state, plus checks green. Tool stays the workflow authority; one extra callback to build.
- **GitHub approval alone** — Approving the PR on GitHub IS the human approval — GHA merges once approved + checks green, then reports back so the node flips to done. One approval action, no double bookkeeping; the tool is no longer the source of truth for the final gate.
- **Tool approval dispatches the merge** — Clicking approve in the tool makes an Edge Function fire repository_dispatch to start the merge workflow. Tool is fully authoritative; but now the tool needs its own GitHub token server-side, and you approve in the tool while reviewing on GitHub.

**Dan:** `GitHub approval alone`

### Q7.3 — PR↔node link
**How does the GHA report-back find the right node? (You chose one repo per project, so repo→project is known.)**

- **Node ID marker in PR body** — The agent raising the PR embeds e.g. 'AgentJira-Node: <uuid>' in the description (and links back to the node page). GHA extracts it and sends it with the callback — exact, survives branch renames, and gives humans a clickable trail both ways.
- **Branch naming convention** — Branches named aj/<node-id>-slug; GHA parses the head ref. No reliance on PR body discipline, but ugly branch names and it breaks if anyone branches manually.
- **pr_url matching only** — Agent stores pr_url on the node via the CLI; the callback looks nodes up by URL. No conventions needed in the repo, but the link only exists if the agent remembered to set it, and the GHA can't self-heal a missing link.

**Dan:** `Node ID marker in PR body`

### Q7.4 — Post-merge
**After a successful merge, what should the pipeline do to the graph?**

- **Node → done, log event, nothing else** — Report-back flips the node to done with merge SHA in the event log. Descendant/dependent bookkeeping (unblocking firm-blocked nodes) is just derived state the UI/agents compute from edges — nothing to cascade.
- **Done + notify-style breadcrumbs** — Also posts a message into the node's thread ('merged as <sha>') and marks soft/firm blocks from this node as released with events. Richer history trail; slightly chattier pipeline.
- **Done + auto-advance dependents** — Additionally flips now-unblocked dependent nodes into their next awaiting status automatically. Most 'alive', but status changes now happen without human or agent intent — cuts against the human-in-the-loop ethos.

**Dan:** `Node → done, log event, nothing else`

---

*End of grilling session. See [decisions.md](decisions.md) for the distilled decision register (transcript above is the source of truth).*
