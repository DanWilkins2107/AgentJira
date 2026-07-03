import { createClient } from '@supabase/supabase-js';
import type { Session, SupabaseClient } from '@supabase/supabase-js';
import { loadConfig, readCachedSession, writeCachedSession } from './config.js';
import { CliError } from './output.js';
import type { MessageRow, MessageType, NodeRow, NodeStatus } from './types.js';

export interface Ctx {
  sb: SupabaseClient;
  userId: string;
  userEmail: string | null;
}

/**
 * Create an authenticated Supabase client. Reuses the cached session from
 * ~/.agentjira/session.json when possible (setSession refreshes an expired
 * access token via the refresh token); falls back to a fresh
 * email/password login and re-caches.
 */
export async function connect(): Promise<Ctx> {
  const cfg = loadConfig();
  const sb = createClient(cfg.url, cfg.anon_key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });

  const cached = readCachedSession();
  if (cached) {
    const { data, error } = await sb.auth.setSession(cached);
    if (!error && data.session) {
      if (
        data.session.access_token !== cached.access_token ||
        data.session.refresh_token !== cached.refresh_token
      ) {
        writeCachedSession({
          access_token: data.session.access_token,
          refresh_token: data.session.refresh_token,
        });
      }
      return ctxFrom(sb, data.session);
    }
    // cached session expired or unusable — fall through to fresh login
  }

  const { data, error } = await sb.auth.signInWithPassword({
    email: cfg.email,
    password: cfg.password,
  });
  if (error || !data.session) {
    throw new CliError(
      `login failed for ${cfg.email}: ${error ? error.message : 'no session returned'}`,
    );
  }
  writeCachedSession({
    access_token: data.session.access_token,
    refresh_token: data.session.refresh_token,
  });
  return ctxFrom(sb, data.session);
}

function ctxFrom(sb: SupabaseClient, session: Session): Ctx {
  return { sb, userId: session.user.id, userEmail: session.user.email ?? null };
}

// --- Small data helpers shared by commands ---

export async function fetchNode(sb: SupabaseClient, id: string): Promise<NodeRow> {
  const { data, error } = await sb.from('nodes').select('*').eq('id', id).maybeSingle();
  if (error) throw new CliError(error.message);
  if (!data) {
    throw new CliError(`node ${id} not found (or you are not a member of its project)`);
  }
  return data as NodeRow;
}

export async function updateNode(
  sb: SupabaseClient,
  id: string,
  patch: Partial<NodeRow>,
): Promise<NodeRow> {
  const { data, error } = await sb.from('nodes').update(patch).eq('id', id).select().single();
  if (error) throw new CliError(error.message);
  return data as NodeRow;
}

export interface NewMessage {
  node_id: string;
  project_id: string;
  stage: NodeStatus;
  author_id: string;
  type: MessageType;
  body: string;
}

/** Insert a message authored by the agent role. */
export async function insertMessage(sb: SupabaseClient, m: NewMessage): Promise<MessageRow> {
  const { data, error } = await sb
    .from('messages')
    .insert({ ...m, author_role: 'agent' })
    .select()
    .single();
  if (error) throw new CliError(error.message);
  return data as MessageRow;
}
