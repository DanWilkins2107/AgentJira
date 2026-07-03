import type { Command } from 'commander';
import { connect, updateNode } from '../client.js';
import { CliError, printJson, short, wrap } from '../output.js';
import { resolveAndFetchNode } from '../resolve.js';
import { NODE_STATUSES } from '../types.js';
import type { NodeStatus } from '../types.js';

interface Opts {
  json?: boolean;
}

export function registerSetStatus(program: Command): void {
  program
    .command('set-status <node> <status>')
    .description('Set a node status directly (validated against the status enum)')
    .option('--json', 'output structured JSON')
    .action(
      wrap(async (nodeRef: string, status: string, opts: Opts) => {
        if (!(NODE_STATUSES as readonly string[]).includes(status)) {
          throw new CliError(
            `invalid status "${status}" — valid statuses: ${NODE_STATUSES.join(', ')}`,
          );
        }
        const { sb } = await connect();
        const node = await resolveAndFetchNode(sb, nodeRef);
        const updated = await updateNode(sb, node.id, { status: status as NodeStatus });
        if (opts.json) {
          printJson({ node: updated, previous_status: node.status });
        } else {
          console.log(
            `node ${short(updated.id)} "${updated.title}" status: ${node.status} -> ${updated.status}`,
          );
        }
      }),
    );
}
