import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CliError } from './output.js';

export interface Config {
  url: string;
  anon_key: string;
  email: string;
  password: string;
}

export function configDir(): string {
  return path.join(os.homedir(), '.agentjira');
}

const CONFIG_KEYS = ['url', 'anon_key', 'email', 'password'] as const;
type ConfigKey = (typeof CONFIG_KEYS)[number];

const ENV_NAMES: Record<ConfigKey, string> = {
  url: 'AGENTJIRA_URL',
  anon_key: 'AGENTJIRA_ANON_KEY',
  email: 'AGENTJIRA_EMAIL',
  password: 'AGENTJIRA_PASSWORD',
};

/**
 * Resolve config: env vars first, else ~/.agentjira/config.json
 * (keys: url, anon_key, email, password). Env vars win per-key, so a
 * partial env overlay on top of the file also works.
 */
export function loadConfig(): Config {
  const filePath = path.join(configDir(), 'config.json');
  let fileValues: Record<string, unknown> = {};
  if (fs.existsSync(filePath)) {
    try {
      fileValues = JSON.parse(fs.readFileSync(filePath, 'utf8')) as Record<string, unknown>;
    } catch {
      throw new CliError(`invalid JSON in ${filePath}`);
    }
  }

  const cfg: Partial<Config> = {};
  const missing: string[] = [];
  for (const key of CONFIG_KEYS) {
    const fromEnv = process.env[ENV_NAMES[key]];
    const fileValue = fileValues[key];
    const fromFile = typeof fileValue === 'string' ? fileValue : undefined;
    const value = fromEnv !== undefined && fromEnv !== '' ? fromEnv : fromFile;
    if (value === undefined || value === '') {
      missing.push(ENV_NAMES[key]);
    } else {
      cfg[key] = value;
    }
  }

  if (missing.length === CONFIG_KEYS.length) {
    throw new CliError(
      'no config found: set AGENTJIRA_URL, AGENTJIRA_ANON_KEY, AGENTJIRA_EMAIL, AGENTJIRA_PASSWORD or create ~/.agentjira/config.json with keys url, anon_key, email, password',
    );
  }
  if (missing.length > 0) {
    throw new CliError(
      `incomplete config, missing: ${missing.join(', ')} (env var, or the lowercase key in ${filePath})`,
    );
  }
  return cfg as Config;
}

// --- Session cache (~/.agentjira/session.json) ---

export interface CachedSession {
  access_token: string;
  refresh_token: string;
}

function sessionFile(): string {
  return path.join(configDir(), 'session.json');
}

export function readCachedSession(): CachedSession | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(sessionFile(), 'utf8')) as Partial<CachedSession>;
    if (typeof parsed.access_token === 'string' && typeof parsed.refresh_token === 'string') {
      return { access_token: parsed.access_token, refresh_token: parsed.refresh_token };
    }
  } catch {
    // missing or corrupt cache — caller falls back to a fresh login
  }
  return null;
}

export function writeCachedSession(session: CachedSession): void {
  const dir = configDir();
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    sessionFile(),
    JSON.stringify(
      { access_token: session.access_token, refresh_token: session.refresh_token },
      null,
      2,
    ),
    { mode: 0o600 },
  );
}
