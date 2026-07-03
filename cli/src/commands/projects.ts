import type { Command } from 'commander';
import { connect } from '../client.js';
import { CliError, printJson, short, wrap } from '../output.js';
import type { ProjectRow } from '../types.js';

interface Opts {
  json?: boolean;
}

export function registerProjects(program: Command): void {
  program
    .command('projects')
    .description('List projects you are a member of')
    .option('--json', 'output structured JSON')
    .action(
      wrap(async (opts: Opts) => {
        const { sb } = await connect();
        // Deliberately never selects webhook_secret (owner-only, per contract).
        const { data, error } = await sb
          .from('projects')
          .select('id, name, repo_owner, repo_name, created_at')
          .order('created_at', { ascending: true });
        if (error) throw new CliError(error.message);
        const projects = (data ?? []) as ProjectRow[];
        if (opts.json) {
          printJson({ projects });
          return;
        }
        if (projects.length === 0) {
          console.log('no projects (ask the owner to add this agent user as a member)');
          return;
        }
        for (const p of projects) {
          const repo = p.repo_owner && p.repo_name ? `  repo=${p.repo_owner}/${p.repo_name}` : '';
          console.log(`${short(p.id)}  ${p.name}${repo}  (${p.id})`);
        }
      }),
    );
}
