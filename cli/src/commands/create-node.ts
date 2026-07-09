import type { Command } from 'commander';
import { connect } from '../client.js';
import { CliError, printJson, short, wrap } from '../output.js';
import { resolveAndFetchNode, resolveProjectId } from '../resolve.js';
import { NODE_STATUSES } from '../types.js';
import type { EdgeRow, NodeRow, NodeStatus } from '../types.js';

interface Opts {
  json?: boolean;
  project: string;
  title: string;
  body?: string;
  parent?: string;
  status?: string;
  breakdownOnMerge?: boolean;
}

export function registerCreateNode(program: Command): void {
  program
    .command('create-node')
    .description('Create a node (with --parent, also creates a subtask edge from the parent)')
    .requiredOption('-p, --project <project>', 'project (uuid, id prefix, or exact name)')
    .requiredOption('--title <t>', 'node title')
    .option('--body <b>', 'node body (markdown)', '')
    .option('--parent <node>', 'parent node — creates a subtask edge parent -> new node')
    .option('--status <s>', 'initial status (default awaiting_agent_breakdown)')
    .option(
      '--breakdown-on-merge',
      'plan-deliverable node: when its PR merges, route back to awaiting_agent_breakdown instead of done',
    )
    .option('--json', 'output structured JSON')
    .action(
      wrap(async (opts: Opts) => {
        const status = opts.status ?? 'awaiting_agent_breakdown';
        if (!(NODE_STATUSES as readonly string[]).includes(status)) {
          throw new CliError(
            `invalid status "${status}" — valid statuses: ${NODE_STATUSES.join(', ')}`,
          );
        }
        const { sb, userId } = await connect();
        const projectId = await resolveProjectId(sb, opts.project);
        const parent = opts.parent
          ? await resolveAndFetchNode(sb, opts.parent, projectId)
          : null;

        const { data, error } = await sb
          .from('nodes')
          .insert({
            project_id: projectId,
            title: opts.title,
            body: opts.body ?? '',
            status: status as NodeStatus,
            breakdown_on_merge: opts.breakdownOnMerge ?? false,
            created_by: userId,
          })
          .select()
          .single();
        if (error) throw new CliError(error.message);
        const node = data as NodeRow;

        let edge: EdgeRow | null = null;
        if (parent) {
          const { data: edgeData, error: edgeErr } = await sb
            .from('edges')
            .insert({
              project_id: projectId,
              source_id: parent.id,
              target_id: node.id,
              type: 'subtask',
              created_by: userId,
            })
            .select()
            .single();
          if (edgeErr) {
            throw new CliError(
              `node ${node.id} created, but subtask edge failed: ${edgeErr.message}`,
            );
          }
          edge = edgeData as EdgeRow;
        }

        if (opts.json) {
          printJson({ node, edge });
        } else {
          console.log(
            `created node ${node.id} "${node.title}" [${node.status}]${
              node.breakdown_on_merge ? ' (breakdown on merge)' : ''
            }`,
          );
          if (edge && parent) {
            console.log(`created subtask edge ${short(parent.id)} -> ${short(node.id)}`);
          }
        }
      }),
    );
}
