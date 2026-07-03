import fs from 'node:fs';
import type { Command } from 'commander';
import { connect, insertMessage, updateNode } from '../client.js';
import { CliError, printJson, short, wrap } from '../output.js';
import { resolveAndFetchNode } from '../resolve.js';

interface Opts {
  json?: boolean;
  file?: string;
  body?: string;
}

export function registerSubmitSpec(program: Command): void {
  program
    .command('submit-spec <node>')
    .description(
      'Set the node spec, move it to spec_review, and post a spec_submission message with the spec text',
    )
    .option('--file <path>', 'read the spec from a file')
    .option('--body <text>', 'the spec text inline')
    .option('--json', 'output structured JSON')
    .action(
      wrap(async (nodeRef: string, opts: Opts) => {
        if ((opts.file === undefined) === (opts.body === undefined)) {
          throw new CliError('provide exactly one of --file or --body');
        }
        let spec: string;
        if (opts.file !== undefined) {
          try {
            spec = fs.readFileSync(opts.file, 'utf8');
          } catch (err) {
            throw new CliError(
              `could not read spec file ${opts.file}: ${err instanceof Error ? err.message : String(err)}`,
            );
          }
        } else {
          spec = opts.body as string;
        }
        if (spec.trim() === '') throw new CliError('spec is empty');

        const { sb, userId } = await connect();
        const node = await resolveAndFetchNode(sb, nodeRef);
        const updated = await updateNode(sb, node.id, { spec, status: 'spec_review' });
        const message = await insertMessage(sb, {
          node_id: node.id,
          project_id: node.project_id,
          stage: 'spec_review',
          author_id: userId,
          type: 'spec_submission',
          body: spec,
        });

        if (opts.json) {
          printJson({ node: updated, message });
        } else {
          console.log(`spec submitted for ${short(node.id)} "${node.title}"`);
          console.log(`node ${short(node.id)} status: ${node.status} -> ${updated.status}`);
          console.log(`posted spec_submission message ${short(message.id)} [stage spec_review]`);
        }
      }),
    );
}
