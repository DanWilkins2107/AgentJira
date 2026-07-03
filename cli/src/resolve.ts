import type { SupabaseClient } from '@supabase/supabase-js';
import { fetchNode } from './client.js';
import { CliError } from './output.js';
import type { NodeRow, ProjectRow } from './types.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PREFIX_RE = /^[0-9a-f-]+$/i;

/**
 * Resolve a node reference: a full uuid is accepted as-is; otherwise it is
 * treated as an id prefix (>= 6 chars), matched against candidate node ids —
 * scoped to a project when given, else across all member projects. Errors
 * clearly when ambiguous or not found.
 */
export async function resolveNodeId(
  sb: SupabaseClient,
  ref: string,
  projectId?: string,
): Promise<string> {
  const needle = ref.toLowerCase();
  if (UUID_RE.test(needle)) return needle;
  if (!PREFIX_RE.test(needle)) {
    throw new CliError(`node id "${ref}" is not a uuid or uuid prefix`);
  }
  if (needle.length < 6) {
    throw new CliError(
      `node id "${ref}" is too short: give a full uuid or a prefix of at least 6 characters`,
    );
  }
  let query = sb.from('nodes').select('id, title');
  if (projectId) query = query.eq('project_id', projectId);
  const { data, error } = await query;
  if (error) throw new CliError(error.message);
  const rows = (data ?? []) as Pick<NodeRow, 'id' | 'title'>[];
  const matches = rows.filter((n) => n.id.startsWith(needle));
  if (matches.length === 0) {
    throw new CliError(
      `no node found matching "${ref}"${projectId ? ' in the given project' : ''}`,
    );
  }
  if (matches.length > 1) {
    const list = matches
      .slice(0, 5)
      .map((m) => `${m.id} "${m.title}"`)
      .join('; ');
    throw new CliError(`node id "${ref}" is ambiguous (${matches.length} matches): ${list}`);
  }
  return matches[0]!.id;
}

/** resolveNodeId + fetch the full row (also validates that a full uuid exists). */
export async function resolveAndFetchNode(
  sb: SupabaseClient,
  ref: string,
  projectId?: string,
): Promise<NodeRow> {
  const id = await resolveNodeId(sb, ref, projectId);
  return fetchNode(sb, id);
}

/**
 * Resolve a project reference: full uuid, exact name (case-insensitive),
 * or an id prefix (>= 6 chars) against member projects.
 */
export async function resolveProjectId(sb: SupabaseClient, ref: string): Promise<string> {
  const needle = ref.toLowerCase();
  if (UUID_RE.test(needle)) return needle;
  const { data, error } = await sb.from('projects').select('id, name');
  if (error) throw new CliError(error.message);
  const rows = (data ?? []) as Pick<ProjectRow, 'id' | 'name'>[];

  const byName = rows.filter((p) => p.name.toLowerCase() === needle);
  if (byName.length === 1) return byName[0]!.id;
  if (byName.length > 1) {
    throw new CliError(`project name "${ref}" is ambiguous: ${byName.map((p) => p.id).join(', ')}`);
  }

  if (PREFIX_RE.test(needle) && needle.length >= 6) {
    const byId = rows.filter((p) => p.id.startsWith(needle));
    if (byId.length === 1) return byId[0]!.id;
    if (byId.length > 1) {
      throw new CliError(
        `project id prefix "${ref}" is ambiguous: ${byId.map((p) => `${p.id} "${p.name}"`).join('; ')}`,
      );
    }
  }
  throw new CliError(
    `no project found matching "${ref}" (use a full uuid, an id prefix of >= 6 chars, or the exact name)`,
  );
}
