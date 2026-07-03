import type { Command } from 'commander';
import { connect, updateNode } from '../client.js';
import { CliError, printJson, short, wrap } from '../output.js';
import { resolveAndFetchNode } from '../resolve.js';

interface Opts {
  json?: boolean;
  url: string;
  number: string;
}

export function registerLinkPr(program: Command): void {
  program
    .command('link-pr <node>')
    .description(
      'Set pr_url/pr_number and move the node to pr_raised (backup for when the GHA is not installed)',
    )
    .requiredOption('--url <u>', 'the PR URL')
    .requiredOption('--number <n>', 'the PR number')
    .option('--json', 'output structured JSON')
    .action(
      wrap(async (nodeRef: string, opts: Opts) => {
        const prNumber = Number.parseInt(opts.number, 10);
        if (Number.isNaN(prNumber) || prNumber <= 0) {
          throw new CliError(`invalid PR number "${opts.number}"`);
        }
        const { sb } = await connect();
        const node = await resolveAndFetchNode(sb, nodeRef);
        const updated = await updateNode(sb, node.id, {
          pr_url: opts.url,
          pr_number: prNumber,
          status: 'pr_raised',
        });
        if (opts.json) {
          printJson({ node: updated, previous_status: node.status });
        } else {
          console.log(`linked PR #${prNumber} (${opts.url}) to ${short(node.id)} "${node.title}"`);
          console.log(`node ${short(node.id)} status: ${node.status} -> ${updated.status}`);
        }
      }),
    );
}
