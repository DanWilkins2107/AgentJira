import type { Command } from 'commander';
import { connect } from '../client.js';
import { CliError, printJson, wrap } from '../output.js';

interface Opts {
  json?: boolean;
}

export function registerWhoami(program: Command): void {
  program
    .command('whoami')
    .description('Show the logged-in user and their project roles')
    .option('--json', 'output structured JSON')
    .action(
      wrap(async (opts: Opts) => {
        const { sb, userId, userEmail } = await connect();
        const { data, error } = await sb
          .from('project_members')
          .select('project_id, role')
          .eq('user_id', userId);
        if (error) throw new CliError(error.message);
        const memberships = (data ?? []) as { project_id: string; role: string }[];
        const roles = [...new Set(memberships.map((m) => m.role))];
        if (opts.json) {
          printJson({ id: userId, email: userEmail, roles, memberships });
        } else {
          console.log(
            `${userEmail ?? '(no email)'}  id=${userId}  role=${roles.join(',') || '(none)'}  member of ${memberships.length} project(s)`,
          );
        }
      }),
    );
}
