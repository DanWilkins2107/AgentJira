import type { Command } from 'commander';
import { connect, insertMessage, updateNode } from '../client.js';
import { printJson, short, wrap } from '../output.js';
import { resolveAndFetchNode } from '../resolve.js';

interface Opts {
  json?: boolean;
  body: string;
}

export function registerProposeSplit(program: Command): void {
  program
    .command('propose-split <node>')
    .description('Post a split_proposal message and set the node status to split_proposed')
    .requiredOption('--body <text>', 'the proposed split (concise, numbered children)')
    .option('--json', 'output structured JSON')
    .action(
      wrap(async (nodeRef: string, opts: Opts) => {
        const { sb, userId } = await connect();
        const node = await resolveAndFetchNode(sb, nodeRef);
        // Stage the proposal in split_proposed so the human's split_decision
        // lands in the same stage thread.
        const message = await insertMessage(sb, {
          node_id: node.id,
          project_id: node.project_id,
          stage: 'split_proposed',
          author_id: userId,
          type: 'split_proposal',
          body: opts.body,
        });
        const updated = await updateNode(sb, node.id, { status: 'split_proposed' });
        if (opts.json) {
          printJson({ message, node: updated });
        } else {
          console.log(
            `posted split_proposal ${short(message.id)} on ${short(node.id)} "${node.title}"`,
          );
          console.log(`node ${short(node.id)} status: ${node.status} -> ${updated.status}`);
        }
      }),
    );
}
