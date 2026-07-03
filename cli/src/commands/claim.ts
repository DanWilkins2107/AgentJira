import os from 'node:os';
import type { Command } from 'commander';
import { connect, updateNode } from '../client.js';
import { CliError, printJson, short, wrap } from '../output.js';
import { resolveAndFetchNode } from '../resolve.js';

interface ClaimOpts {
  json?: boolean;
  session?: string;
  force?: boolean;
}

interface UnclaimOpts {
  json?: boolean;
}

export function defaultSessionLabel(): string {
  return `${os.hostname()}:${process.pid}`;
}

export function registerClaim(program: Command): void {
  program
    .command('claim <node>')
    .description('Claim a node for this agent session (sets claimed_by + claimed_at)')
    .option('--session <label>', 'claim label (default: hostname:pid)')
    .option('--force', 'take over even if claimed by a different session')
    .option('--json', 'output structured JSON')
    .action(
      wrap(async (nodeRef: string, opts: ClaimOpts) => {
        const { sb } = await connect();
        const node = await resolveAndFetchNode(sb, nodeRef);
        const label = opts.session ?? defaultSessionLabel();
        if (node.claimed_by !== null && node.claimed_by !== label && !opts.force) {
          throw new CliError(
            `node ${short(node.id)} "${node.title}" is already claimed by ${node.claimed_by}${node.claimed_at ? ` (since ${node.claimed_at})` : ''}; use --force to take over`,
          );
        }
        const updated = await updateNode(sb, node.id, {
          claimed_by: label,
          claimed_at: new Date().toISOString(),
        });
        if (opts.json) {
          printJson({ node: updated });
        } else {
          console.log(`claimed ${short(updated.id)} "${updated.title}" as ${label}`);
        }
      }),
    );

  program
    .command('unclaim <node>')
    .description('Clear a node claim (clears claimed_by and claimed_at)')
    .option('--json', 'output structured JSON')
    .action(
      wrap(async (nodeRef: string, opts: UnclaimOpts) => {
        const { sb } = await connect();
        const node = await resolveAndFetchNode(sb, nodeRef);
        const updated = await updateNode(sb, node.id, { claimed_by: null, claimed_at: null });
        if (opts.json) {
          printJson({ node: updated });
        } else {
          console.log(`unclaimed ${short(updated.id)} "${updated.title}"`);
        }
      }),
    );
}
