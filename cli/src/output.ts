/** Error whose message is safe to show as the one-line stderr output. */
export class CliError extends Error {}

/** First 8 characters of a uuid — used for compact human-readable output. */
export function short(id: string): string {
  return id.slice(0, 8);
}

export function printJson(value: unknown): void {
  process.stdout.write(JSON.stringify(value, null, 2) + '\n');
}

/**
 * Wrap a command action: any thrown error becomes a single-line stderr
 * message and a nonzero exit. Supabase error messages are passed through
 * verbatim (never swallowed).
 */
export function wrap<A extends unknown[]>(
  fn: (...args: A) => Promise<void>,
): (...args: A) => Promise<void> {
  return async (...args: A) => {
    try {
      await fn(...args);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      process.stderr.write(`aj: ${msg.replace(/\s+/g, ' ').trim()}\n`);
      process.exit(1);
    }
  };
}
