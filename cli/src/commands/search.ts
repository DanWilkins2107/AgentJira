import type { Command } from 'commander';
import { connect } from '../client.js';
import { CliError, printJson, short, wrap } from '../output.js';
import { resolveProjectId } from '../resolve.js';

interface Opts {
  json?: boolean;
  project: string;
}

interface SearchRow {
  kind: string;
  node_id: string;
  title: string;
  snippet: string;
  rank: number;
}

export function registerSearch(program: Command): void {
  program
    .command('search <query>')
    .description('Full-text search over nodes and messages in a project (search_all RPC)')
    .requiredOption('-p, --project <project>', 'project (uuid, id prefix, or exact name)')
    .option('--json', 'output structured JSON')
    .action(
      wrap(async (query: string, opts: Opts) => {
        const { sb } = await connect();
        const projectId = await resolveProjectId(sb, opts.project);
        const { data, error } = await sb.rpc('search_all', {
          p_project: projectId,
          p_query: query,
        });
        if (error) throw new CliError(`search_all RPC failed: ${error.message}`);
        const rows = (Array.isArray(data) ? data : []) as SearchRow[];
        if (opts.json) {
          printJson({ results: rows });
          return;
        }
        if (rows.length === 0) {
          console.log('no results');
          return;
        }
        for (const r of rows) {
          const snippet = (r.snippet ?? '').replace(/<\/?b>/g, '').replace(/\s+/g, ' ').trim();
          console.log(`${r.kind}  ${short(r.node_id)}  ${r.title}`);
          if (snippet !== '') console.log(`    ${snippet}`);
        }
      }),
    );
}
