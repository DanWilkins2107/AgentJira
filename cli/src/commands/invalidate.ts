import type { Command } from 'commander';
import { connect } from '../client.js';
import { CliError, printJson, short, wrap } from '../output.js';
import { resolveAndFetchNode } from '../resolve.js';

interface Opts {
  json?: boolean;
  reason: string;
}

export function registerInvalidate(program: Command): void {
  program
    .command('invalidate <node>')
    .description(
      'Invalidate a node via the invalidate_node RPC. Descendants become stale (derived at read time, nothing written) until this node is restored; firm-block targets are NOT affected',
    )
    .requiredOption('--reason <text>', 'why the node is wrong (stored permanently as context)')
    .option('--json', 'output structured JSON')
    .action(
      wrap(async (nodeRef: string, opts: Opts) => {
        if (opts.reason.trim() === '') throw new CliError('reason must not be empty');
        const { sb } = await connect();
        const node = await resolveAndFetchNode(sb, nodeRef);
        const { data, error } = await sb.rpc('invalidate_node', {
          p_node: node.id,
          p_reason: opts.reason,
        });
        if (error) throw new CliError(`invalidate_node RPC failed: ${error.message}`);
        if (opts.json) {
          printJson({ node_id: node.id, reason: opts.reason, result: data ?? null });
        } else {
          console.log(
            `invalidated ${short(node.id)} "${node.title}" — its subtask descendants are now stale (derived) until this node is restored; block targets are unaffected`,
          );
        }
      }),
    );
}
