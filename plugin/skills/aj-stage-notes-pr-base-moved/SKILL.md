---
name: aj-stage-notes-pr-base-moved
description: Stage notes for pr_base_moved. Load before starting any pr_base_moved node.
---

# pr_base_moved — project stage instructions

Most of these are no-ops — main moved somewhere unrelated. Say so in one line on `aj resubmit --body` and move on; don't write up an audit of commits that didn't touch you.

Worth a `note` on the node only when the reconcile changed the work: main already did part of it, an interface it depends on moved, or the branch now needs more than it was specced for. If the node's whole point is gone, that's an `aj post --type question`, not a quiet resubmit.
