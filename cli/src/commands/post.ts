import type { Command } from 'commander';
import { connect, insertMessage, updateNode } from '../client.js';
import { CliError, printJson, short, wrap } from '../output.js';
import { resolveAndFetchNode } from '../resolve.js';
import { MESSAGE_TYPES, NODE_STATUSES } from '../types.js';
import type { MessageType, NodeStatus } from '../types.js';

interface Opts {
  json?: boolean;
  type: string;
  body: string;
  stage?: string;
}

export function registerPost(program: Command): void {
  program
    .command('post <node>')
    .description(
      'Post a message to a node thread as the agent; --type question also flips the node to awaiting_human_response',
    )
    .requiredOption('--type <message_type>', `one of: ${MESSAGE_TYPES.join(', ')}`)
    .requiredOption('--body <text>', 'message body')
    .option('--stage <status>', "thread stage (defaults to the node's current status)")
    .option('--json', 'output structured JSON')
    .action(
      wrap(async (nodeRef: string, opts: Opts) => {
        if (!(MESSAGE_TYPES as readonly string[]).includes(opts.type)) {
          throw new CliError(
            `invalid message type "${opts.type}" — valid types: ${MESSAGE_TYPES.join(', ')}`,
          );
        }
        if (opts.stage !== undefined && !(NODE_STATUSES as readonly string[]).includes(opts.stage)) {
          throw new CliError(
            `invalid stage "${opts.stage}" — valid statuses: ${NODE_STATUSES.join(', ')}`,
          );
        }
        const { sb, userId } = await connect();
        const node = await resolveAndFetchNode(sb, nodeRef);
        const stage = (opts.stage as NodeStatus | undefined) ?? node.status;
        const message = await insertMessage(sb, {
          node_id: node.id,
          project_id: node.project_id,
          stage,
          author_id: userId,
          type: opts.type as MessageType,
          body: opts.body,
        });

        let updatedStatus: NodeStatus | null = null;
        if (opts.type === 'question') {
          const updated = await updateNode(sb, node.id, { status: 'awaiting_human_response' });
          updatedStatus = updated.status;
        }

        if (opts.json) {
          printJson({ message, node_status: updatedStatus ?? node.status });
        } else {
          console.log(
            `posted ${opts.type} message ${short(message.id)} on ${short(node.id)} [stage ${stage}]`,
          );
          if (updatedStatus !== null) {
            console.log(`node ${short(node.id)} status: ${node.status} -> ${updatedStatus}`);
          }
        }
      }),
    );
}
