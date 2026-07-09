import type { Command } from 'commander';
import { connect, insertMessage, updateNode } from '../client.js';
import { CliError, printJson, short, wrap } from '../output.js';
import { resolveAndFetchNode } from '../resolve.js';

interface Opts {
  json?: boolean;
  body?: string;
  force?: boolean;
}

/**
 * Hand a node back to review after addressing PR review comments:
 * pr_changes_requested -> pr_raised. This is the explicit round-trip that
 * mirrors "human answered a question" — the agent decides when the comments
 * are addressed, so a work-in-progress push never flips the turn prematurely.
 */
export function registerResubmit(program: Command): void {
  program
    .command('resubmit <node>')
    .description(
      'After addressing PR review comments, return the node to review: pr_changes_requested -> pr_raised (posts a note)',
    )
    .option('--body <text>', 'note posted to the thread describing what was addressed')
    .option('--force', 'resubmit even if the node is not in pr_changes_requested')
    .option('--json', 'output structured JSON')
    .action(
      wrap(async (nodeRef: string, opts: Opts) => {
        const { sb, userId } = await connect();
        const node = await resolveAndFetchNode(sb, nodeRef);
        if (node.status !== 'pr_changes_requested' && !opts.force) {
          throw new CliError(
            `node ${short(node.id)} is ${node.status}, not pr_changes_requested — resubmit is for handing a reviewed PR back to review (use --force to override)`,
          );
        }
        const body = opts.body?.trim() || 'Review comments addressed; re-requesting review.';
        const message = await insertMessage(sb, {
          node_id: node.id,
          project_id: node.project_id,
          stage: 'pr_raised',
          author_id: userId,
          type: 'note',
          body,
        });
        const updated = await updateNode(sb, node.id, { status: 'pr_raised' });
        if (opts.json) {
          printJson({ node: updated, previous_status: node.status, message });
        } else {
          console.log(
            `resubmitted ${short(node.id)} "${node.title}" for review: ${node.status} -> ${updated.status}`,
          );
          console.log('Re-request the review on GitHub so a human can approve.');
        }
      }),
    );
}
