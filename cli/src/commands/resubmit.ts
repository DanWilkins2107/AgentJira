import type { Command } from 'commander';
import { connect, insertMessage, updateNode } from '../client.js';
import { CliError, printJson, short, wrap } from '../output.js';
import { resolveAndFetchNode } from '../resolve.js';
import type { NodeStatus } from '../types.js';

interface Opts {
  json?: boolean;
  body?: string;
  force?: boolean;
}

/** The two ways a raised PR hands the turn back to an agent: a reviewer asked
 * for changes, or main moved underneath it. */
const RESUBMITTABLE: readonly NodeStatus[] = ['pr_changes_requested', 'pr_base_moved'];

/**
 * Hand a node back to review: pr_changes_requested / pr_base_moved -> pr_raised.
 * This is the explicit round-trip that mirrors "human answered a question" — the
 * agent decides when the work is addressed, so a work-in-progress push never
 * flips the turn prematurely.
 */
export function registerResubmit(program: Command): void {
  program
    .command('resubmit <node>')
    .description(
      'After addressing PR review comments or reconciling with main, return the node to review: pr_changes_requested / pr_base_moved -> pr_raised (posts a note)',
    )
    .option('--body <text>', 'note posted to the thread describing what was addressed')
    .option('--force', 'resubmit even if the node is not awaiting an agent on its PR')
    .option('--json', 'output structured JSON')
    .action(
      wrap(async (nodeRef: string, opts: Opts) => {
        const { sb, userId } = await connect();
        const node = await resolveAndFetchNode(sb, nodeRef);
        if (!RESUBMITTABLE.includes(node.status) && !opts.force) {
          throw new CliError(
            `node ${short(node.id)} is ${node.status}, not ${RESUBMITTABLE.join(' or ')} — resubmit is for handing a PR back to review (use --force to override)`,
          );
        }
        const body =
          opts.body?.trim() ||
          (node.status === 'pr_base_moved'
            ? 'Reconciled with main; re-requesting review.'
            : 'Review comments addressed; re-requesting review.');
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
