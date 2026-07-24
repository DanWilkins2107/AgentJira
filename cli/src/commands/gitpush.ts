import { spawnSync } from 'node:child_process';
import type { Command } from 'commander';
import { connect } from '../client.js';
import { CliError, wrap } from '../output.js';
import { resolveAndFetchNode } from '../resolve.js';
import { mintGithubToken } from './github-token.js';

interface Opts {
  remote: string;
  force?: boolean;
  forceWithLease?: boolean;
  setUpstream?: boolean;
}

/**
 * Parse an `owner/repo` pair out of a GitHub remote URL, accepting both the
 * https (`https://github.com/owner/repo.git`) and ssh
 * (`git@github.com:owner/repo.git`) forms, with or without the `.git` suffix.
 */
function parseGithubRepo(remoteUrl: string): { owner: string; repo: string } {
  const trimmed = remoteUrl.trim();
  const m = /github\.com[/:]([^/]+)\/(.+?)(?:\.git)?$/i.exec(trimmed);
  if (!m) {
    throw new CliError(
      `remote "${trimmed}" does not look like a GitHub URL — gitpush only pushes to github.com`,
    );
  }
  return { owner: m[1]!, repo: m[2]! };
}

/** Run git with args; on failure throw a CliError carrying git's stderr. */
function git(args: string[], opts: { inherit?: boolean } = {}): string {
  const res = spawnSync('git', args, {
    encoding: 'utf8',
    stdio: opts.inherit ? 'inherit' : ['ignore', 'pipe', 'pipe'],
  });
  if (res.error) throw new CliError(`failed to run git: ${res.error.message}`);
  if (res.status !== 0) {
    const detail = opts.inherit ? '' : (res.stderr || '').trim();
    throw new CliError(`git ${args[0]} failed${detail ? `: ${detail}` : ''}`);
  }
  return (res.stdout || '').trim();
}

export function registerGitpush(program: Command): void {
  program
    .command('gitpush <node> [refspec]')
    .description(
      'Push the current branch (or a given refspec) to GitHub authored by the app identity (agentjira[bot]). Mints a fresh github-token internally, so the token never touches your shell',
    )
    .option('--remote <name>', 'remote to read the repo URL from', 'origin')
    .option('-u, --set-upstream', 'set the pushed branch as upstream (git push -u)')
    .option('--force-with-lease', 'safe force-push after a rebase (git push --force-with-lease)')
    .option('--force', 'force-push (git push --force) — prefer --force-with-lease')
    .action(
      wrap(async (nodeRef: string, refspec: string | undefined, opts: Opts) => {
        const remoteUrl = git(['remote', 'get-url', opts.remote]);
        const { owner, repo } = parseGithubRepo(remoteUrl);

        const { sb } = await connect();
        const node = await resolveAndFetchNode(sb, nodeRef);
        const { token, expires_at } = await mintGithubToken(sb, node.id);

        // Authenticate via an Authorization header rather than embedding the
        // token in the URL, so it never appears in git's remote-url error
        // output. The header lives only in this child process's argv — it
        // never crosses back into our shell.
        const basic = Buffer.from(`x-access-token:${token}`).toString('base64');
        const url = `https://github.com/${owner}/${repo}.git`;
        const flags: string[] = [];
        if (opts.setUpstream) flags.push('--set-upstream');
        if (opts.forceWithLease) flags.push('--force-with-lease');
        if (opts.force) flags.push('--force');

        console.error(
          `pushing to ${owner}/${repo} as agentjira[bot] (token expires ${expires_at ?? 'unknown'})`,
        );
        git(
          [
            '-c',
            `http.extraHeader=Authorization: Basic ${basic}`,
            'push',
            ...flags,
            url,
            refspec ?? 'HEAD',
          ],
          { inherit: true },
        );
      }),
    );
}
