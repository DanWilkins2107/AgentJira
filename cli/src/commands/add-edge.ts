import type { Command } from 'commander';
import { connect } from '../client.js';
import { CliError, printJson, short, wrap } from '../output.js';
import { resolveAndFetchNode } from '../resolve.js';
import { EDGE_TYPES } from '../types.js';
import type { EdgeRow } from '../types.js';

interface Opts {
  json?: boolean;
  type: string;
  from: string;
  to: string;
}

export function registerAddEdge(program: Command): void {
  program
    .command('add-edge')
    .description('Create an edge between two nodes (reading is always source -> target)')
    .requiredOption('--type <edge_type>', `one of: ${EDGE_TYPES.join(', ')}`)
    .requiredOption('--from <node>', 'source node')
    .requiredOption('--to <node>', 'target node')
    .option('--json', 'output structured JSON')
    .action(
      wrap(async (opts: Opts) => {
        if (!(EDGE_TYPES as readonly string[]).includes(opts.type)) {
          throw new CliError(
            `invalid edge type "${opts.type}" — valid types: ${EDGE_TYPES.join(', ')}`,
          );
        }
        const { sb, userId } = await connect();
        const from = await resolveAndFetchNode(sb, opts.from);
        const to = await resolveAndFetchNode(sb, opts.to);
        if (from.id === to.id) {
          throw new CliError('source and target are the same node');
        }
        if (from.project_id !== to.project_id) {
          throw new CliError(
            `nodes are in different projects (${short(from.id)} in ${from.project_id}, ${short(to.id)} in ${to.project_id})`,
          );
        }
        const { data, error } = await sb
          .from('edges')
          .insert({
            project_id: from.project_id,
            source_id: from.id,
            target_id: to.id,
            type: opts.type,
            created_by: userId,
          })
          .select()
          .single();
        if (error) throw new CliError(error.message);
        const edge = data as EdgeRow;
        if (opts.json) {
          printJson({ edge });
        } else {
          console.log(
            `created ${edge.type} edge ${short(from.id)} "${from.title}" -> ${short(to.id)} "${to.title}"`,
          );
        }
      }),
    );
}
