import type { Command } from 'commander';
import { connect } from '../client.js';
import { CliError, printJson, wrap } from '../output.js';
import { resolveAndFetchNode } from '../resolve.js';

interface Opts {
  json?: boolean;
}

interface TokenResponse {
  token: string;
  expires_at: string | null;
}

/** Best-effort extraction of the function's JSON error body. */
async function functionErrorMessage(error: unknown): Promise<string> {
  const ctx = (error as { context?: Response } | null)?.context;
  if (ctx && typeof ctx.json === 'function') {
    try {
      const body = (await ctx.json()) as { error?: unknown };
      if (typeof body.error === 'string') return body.error;
    } catch {
      // fall through to the generic message
    }
  }
  return error instanceof Error ? error.message : String(error);
}

export function registerGithubToken(program: Command): void {
  program
    .command('github-token <node>')
    .description(
      "Mint a short-lived (~1h), repo-scoped GitHub App token so branches/PRs are authored by the app identity (agentjira[bot]), letting a human reviewer approve. Prints the token to stdout; expiry to stderr",
    )
    .option('--json', 'output structured JSON ({ token, expires_at })')
    .action(
      wrap(async (nodeRef: string, opts: Opts) => {
        const { sb } = await connect();
        // Resolve/validate the node client-side first for clear errors.
        const node = await resolveAndFetchNode(sb, nodeRef);
        const { data, error } = await sb.functions.invoke<TokenResponse>('github-token', {
          body: { node_id: node.id },
        });
        if (error) throw new CliError(await functionErrorMessage(error));
        if (!data?.token) throw new CliError('no token returned');
        if (opts.json) {
          printJson(data);
        } else {
          // Token on stdout so it can be captured: TOKEN=$(aj github-token <node>)
          console.log(data.token);
          console.error(`expires ${data.expires_at ?? 'unknown'}`);
        }
      }),
    );
}
