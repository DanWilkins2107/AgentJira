# AgentJira — Workflow Stages

How a node moves from braindump to merged PR. Exact names and rules live in [architecture.md](architecture.md); this page is the picture. Colors in the app follow one rule: **brighter = human needed**.

## The status machine

Every node is in exactly one status, and each status belongs to a turn: **human**, **agent**, **github**, or **none** (terminal/container).

```mermaid
stateDiagram-v2
    human_braindump_needed : human_braindump_needed (human)
    awaiting_agent_breakdown : awaiting_agent_breakdown (agent)
    awaiting_human_response : awaiting_human_response (human)
    split_proposed : split_proposed (human)
    split_approved : split_approved (agent)
    broken_down : broken_down (none)
    awaiting_agent_spec : awaiting_agent_spec (agent)
    spec_review : spec_review (human)
    ready_for_pickup : ready_for_pickup (agent)
    human_only_action : human_only_action (human)
    evaluating_soft_block : evaluating_soft_block (agent/judge)
    pr_raised : pr_raised (github)
    pr_changes_requested : pr_changes_requested (agent)
    done : done (none)
    invalidated : invalidated (none)

    [*] --> human_braindump_needed : project created (vision node)
    human_braindump_needed --> awaiting_agent_breakdown : human braindumps text + canvas

    awaiting_agent_breakdown --> awaiting_human_response : agent asks a question
    awaiting_human_response --> awaiting_agent_breakdown : human answers
    awaiting_agent_breakdown --> split_proposed : agent proposes a split
    awaiting_agent_breakdown --> awaiting_agent_spec : PR-sized, spec worthwhile → agent writes spec
    awaiting_agent_breakdown --> ready_for_pickup : PR-sized + routine (no security) → agent skips the spec, builds

    split_proposed --> split_approved : human approves
    split_proposed --> awaiting_agent_breakdown : human rejects
    split_approved --> broken_down : agent materializes children + subtask edges

    awaiting_agent_spec --> awaiting_human_response : agent asks a question
    awaiting_human_response --> awaiting_agent_spec : human answers
    awaiting_agent_spec --> spec_review : agent submits tiny spec
    spec_review --> ready_for_pickup : human approves spec
    spec_review --> awaiting_agent_spec : human rejects with review_comment

    [*] --> human_only_action : split out as its own node — only a person can do it
    awaiting_agent_breakdown --> human_only_action : agent finds the whole node is human-only
    human_only_action --> done : human does it and marks it done

    ready_for_pickup --> evaluating_soft_block : supervisor queues a soft-blocked node for the judge
    evaluating_soft_block --> ready_for_pickup : judge proceeds — or defers (reassess_after), held until source done, then re-judged
    evaluating_soft_block --> awaiting_human_response : judge escalates a question
    awaiting_human_response --> evaluating_soft_block : human answers, judge re-evaluates

    ready_for_pickup --> pr_raised : agent raises PR (GHA pr_opened, aj link-pr)
    pr_raised --> pr_changes_requested : reviewer requests changes / leaves inline comments
    pr_changes_requested --> pr_raised : agent addresses comments, aj resubmit
    pr_raised --> done : GitHub approval, GHA merges, pr_merged
    pr_raised --> awaiting_agent_breakdown : breakdown_on_merge node — merged plan routes back to split

    note right of invalidated
        Reachable from any status via
        invalidate (reason required).
        Kept forever as context.
    end note

    note right of human_only_action
        Work only a person can do. A whole node,
        never a detour: the agent splits it out and
        firm-blocks whatever it holds up, rather than
        parking its own node. No hand-back path —
        no agent ever held it.
    end note

    note left of evaluating_soft_block
        Off-rail side-loop. An external supervisor
        watches for this status and dispatches a
        throwaway headless judge session — the board
        never calls an LLM. A reassess_after edge holds
        the node like a firm block until its source is
        done, then it re-enters here to be re-judged.
    end note
```

Two loops in that diagram are easy to miss:

- **The soft-block judge** (`evaluating_soft_block`). A soft-blocked node is queued for an external, throwaway **judge** session that decides: proceed, escalate a question to the human (which returns here for re-judging once answered), or defer via a `reassess_after` edge — which gates the node exactly like a firm block until its source is `done`, then routes it back through the judge. The board never calls an LLM; a deterministic supervisor just watches for the status and dispatches the session. Detail: `agentjira-workflow` rulebook + [architecture.md](architecture.md).
- **Breakdown-on-merge re-entry** (`pr_raised → awaiting_agent_breakdown`). A node flagged `breakdown_on_merge` delivers a plan/spec document, so its PR merge routes it back to breakdown (recording the `merge_sha`) instead of `done` — the planned work still has to be split into tasks.

Orthogonal to status: **stale** (derived at read time, never stored — an ancestor via subtask edges is currently `invalidated`; the node is dead until that ancestor is restored) and `claimed_by` (an agent session is actively on it; humans clear stuck claims from the UI).

## The breakdown loop

The top half of a node's life: human braindumps, agent asks, human answers, agent proposes a split, human approves, agent materializes.

```mermaid
sequenceDiagram
    actor Human
    participant Board as AgentJira board
    actor Agent

    Human->>Board: braindump on node (text + tldraw canvas)
    Note over Board: awaiting_agent_breakdown
    Agent->>Board: aj claim, then aj context (reads canvas PNGs)
    Agent->>Board: aj post --type question
    Note over Board: awaiting_human_response
    Human->>Board: answer in thread, hand turn back
    Note over Board: awaiting_agent_breakdown
    Agent->>Board: aj propose-split (numbered children, one-line scopes, suggested blocks)
    Note over Board: split_proposed
    Human->>Board: approve (split_decision message)
    Note over Board: split_approved
    Agent->>Board: aj create-node --parent for each child
    Agent->>Board: aj add-edge for firm/soft blocks between siblings
    Agent->>Board: aj set-status parent broken_down
    Note over Board: broken_down — work continues in the children
```

The question loop can repeat as often as needed — regular human intervention is the point, not a failure mode. Children that are already PR-sized skip further splitting: the agent then judges whether a spec is worthwhile ("would human guidance on the plan help here?") — routine, self-evident work skips straight to `ready_for_pickup` and builds, so the PR review is the human's only gate on it; anything where the plan is worth a look, and **all security-relevant work** (auth, secrets, permissions, RLS, migrations, config), goes through `awaiting_agent_spec` → `spec_review`. This is deliberate load control: the spec gate exists where human guidance adds value, not as a rubber stamp on obvious work.

## Human-only work

Some work is blocked on being a person: creating an account, paying for something, clicking through a third-party console, plugging in hardware, signing a document. No amount of context unblocks it, so it does not belong in an agent's queue at all.

The rule is **split it out, don't wait on it**. The human-only step becomes its own node in `human_only_action`, and whatever it holds up is firm-blocked by that node — the same dependency machinery as everything else. An agent never parks its own node hoping a human wanders past.

```mermaid
flowchart LR
    spot["breakdown / spec:<br/>spot the human-only step"] --> split["create it as its own node<br/>status = human_only_action"]
    split --> block["firm_block: human node → the work it holds up"]
    block --> human["human does it, marks it done"]
    human --> unblock["dependent node unblocks<br/>by the ordinary edge rule — no cascade"]
```

- **Predict them, don't discover them.** Breakdown and spec are where these steps are cheap to spot, and a split proposal should name the human-only children explicitly. Running into one mid-implementation is the fallback: the agent splits it out, blocks its own node on it, and goes and does something else rather than stalling.
- **The whole node is the human's, start to finish.** There is no hand-back, because no agent ever held it. The human marks it `done` — or `invalidated` if it turns out to be unnecessary.
- **It is loud on purpose.** Bright red card, never listed by `aj tasks`, and any firm block from it reads as unfinished everywhere until the human acts. That is exactly the truth: nothing downstream can move.

## The PR endgame

The bottom half: spec approved, agent implements, GitHub review is the final human gate, the GHA does the rest.

```mermaid
sequenceDiagram
    actor Human
    participant Board as AgentJira board
    actor Agent
    participant GitHub
    participant GHA as GHA (agentjira.yml)

    Human->>Board: approve spec
    Note over Board: ready_for_pickup
    Agent->>Board: aj claim, then aj context
    Agent->>Agent: implement on a git branch per the spec
    Agent->>GitHub: open PR — title [AJ] node title, body has AgentJira-Node marker
    Agent->>Board: aj link-pr (backup path)
    GHA->>Board: POST pr_opened to github-sync
    Note over Board: pr_raised — GHA owns status from here
    opt reviewer requests changes / leaves inline comments
        Human->>GitHub: submit review (changes requested or inline comments)
        GHA->>Board: POST pr_changes_requested (review body + inline comments)
        Note over Board: pr_changes_requested — turn back to the agent
        Agent->>Board: aj context (reads the review from the thread)
        Agent->>GitHub: push fixes on the branch (as the app identity)
        Agent->>Board: aj resubmit → pr_raised, re-request review on GitHub
        Note over Board: pr_raised
    end
    Human->>GitHub: review and approve the PR
    GHA->>Board: POST pr_approved
    GHA->>GitHub: poll checks until green, gh pr merge --squash
    GHA->>Board: POST pr_merged with merge SHA
    Note over Board: done — merge_sha recorded, nothing else cascades
```

Post-merge, nothing auto-advances: dependents' "unblocked" state is derived from edges, never cascaded writes.

## Invalidation and staleness

When a premise turns out wrong, the node is **invalidated** (reason required, recorded forever). Everything built on it reads as **stale** — derived at read time, nothing is written to the descendants:

```mermaid
flowchart TD
    inv[invalidate node<br/>reason recorded, status = invalidated] --> desc[descendants via subtask edges<br/>read as STALE - derived, no writes]
    desc --> dead[stale = dead until restored:<br/>dimmed in the graph, hidden by the hide-toggle,<br/>excluded from aj tasks]
    dead --> restore[restore the invalidated ancestor]
    restore --> undo[whole subtree un-stales automatically<br/>zero writes]
```

- A node is stale iff its own status is not `invalidated` and an ancestor via non-removed `subtask` edges currently is. The walk (server: `stale_node_ids`; web: derived in the view) is cycle-safe and depth-capped at 50. Even `done` descendants read as stale — a merged premise can still be stale.
- **Blocks never affect staleness.** A blocker's status (including `invalidated`) is visible wherever blockers are listed; that's the whole signal.
- Stale renders as the dimmed invalidated card treatment plus a solid amber STALE badge; invalidated ancestors are flagged in every descendant's breadcrumb.
- **Invalidated nodes are not trash.** They stay first-class, readable, and searchable — the invalidation reason is exactly the context that stops the next agent repeating the mistake. Nothing is ever deleted.
