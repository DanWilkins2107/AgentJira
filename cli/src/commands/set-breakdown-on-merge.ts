import type { Command } from 'commander';
import { connect, updateNode } from '../client.js';
import { printJson, short, wrap } from '../output.js';
import { resolveAndFetchNode } from '../resolve.js';

interface Opts {
  json?: boolean;
  off?: boolean;
}

export function registerSetBreakdownOnMerge(program: Command): void {
  program
    .command('set-breakdown-on-merge <node>')
    .description(
      'Flag a plan-deliverable node: when its PR merges, it routes back to awaiting_agent_breakdown (to split the planned work) instead of done. --off clears the flag',
    )
    .option('--off', 'clear the flag (merge routes to done again)')
    .option('--json', 'output structured JSON')
    .action(
      wrap(async (nodeRef: string, opts: Opts) => {
        const { sb } = await connect();
        const node = await resolveAndFetchNode(sb, nodeRef);
        const updated = await updateNode(sb, node.id, { breakdown_on_merge: !opts.off });
        if (opts.json) {
          printJson({ node: updated, previous: node.breakdown_on_merge });
        } else {
          console.log(
            `node ${short(updated.id)} "${updated.title}" breakdown_on_merge: ${node.breakdown_on_merge} -> ${updated.breakdown_on_merge}`,
          );
        }
      }),
    );
}
