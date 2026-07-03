import type { Command } from 'commander';
import { connect } from '../client.js';
import { CliError, printJson, short, wrap } from '../output.js';
import { resolveProjectId } from '../resolve.js';
import { AGENT_TURN_STATUSES } from '../types.js';
import type { NodeStatus } from '../types.js';

interface Opts {
  json?: boolean;
  project?: string;
  session?: string;
}

interface BlockerInfo {
  edge_type: 'firm_block' | 'soft_block';
  blocker_id: string;
  blocker_title: string;
  blocker_status: NodeStatus | 'unknown';
  unfinished: boolean;
}

interface TaskEntry {
  id: string;
  project_id: string;
  project_name: string | null;
  title: string;
  status: NodeStatus;
  stale: boolean;
  claimed_by: string | null;
  claimed_at: string | null;
  blockers: BlockerInfo[];
  not_recommended_reasons: string[];
}

interface TaskNodeRow {
  id: string;
  project_id: string;
  title: string;
  status: NodeStatus;
  stale: boolean;
  claimed_by: string | null;
  claimed_at: string | null;
}

export function registerTasks(program: Command): void {
  program
    .command('tasks')
    .description(
      `List nodes in agent-turn statuses (${AGENT_TURN_STATUSES.join(', ')}), with stale/claim/blocker annotations`,
    )
    .option('-p, --project <project>', 'limit to one project (uuid, id prefix, or exact name)')
    .option(
      '--session <label>',
      'your claim label — tasks claimed under it count as yours, not "claimed by someone else"',
    )
    .option('--json', 'output structured JSON')
    .action(
      wrap(async (opts: Opts) => {
        const { sb } = await connect();
        const projectId = opts.project ? await resolveProjectId(sb, opts.project) : null;

        let query = sb
          .from('nodes')
          .select('id, project_id, title, status, stale, claimed_by, claimed_at')
          .in('status', [...AGENT_TURN_STATUSES])
          .order('created_at', { ascending: true });
        if (projectId) query = query.eq('project_id', projectId);
        const { data, error } = await query;
        if (error) throw new CliError(error.message);
        const nodes = (data ?? []) as TaskNodeRow[];

        // Project names for annotation.
        const { data: projData, error: projErr } = await sb.from('projects').select('id, name');
        if (projErr) throw new CliError(projErr.message);
        const projectNames = new Map(
          ((projData ?? []) as { id: string; name: string }[]).map((p) => [p.id, p.name]),
        );

        // Non-removed firm/soft block edges targeting these tasks, plus blocker nodes.
        const edgesByTarget = new Map<string, { source_id: string; type: 'firm_block' | 'soft_block' }[]>();
        const blockerNodes = new Map<string, { title: string; status: NodeStatus }>();
        if (nodes.length > 0) {
          const ids = nodes.map((n) => n.id);
          const { data: edgeData, error: edgeErr } = await sb
            .from('edges')
            .select('source_id, target_id, type')
            .in('target_id', ids)
            .in('type', ['firm_block', 'soft_block'])
            .is('removed_at', null);
          if (edgeErr) throw new CliError(edgeErr.message);
          const edges = (edgeData ?? []) as {
            source_id: string;
            target_id: string;
            type: 'firm_block' | 'soft_block';
          }[];
          for (const e of edges) {
            const list = edgesByTarget.get(e.target_id) ?? [];
            list.push({ source_id: e.source_id, type: e.type });
            edgesByTarget.set(e.target_id, list);
          }
          const blockerIds = [...new Set(edges.map((e) => e.source_id))];
          if (blockerIds.length > 0) {
            const { data: blockerData, error: blockerErr } = await sb
              .from('nodes')
              .select('id, title, status')
              .in('id', blockerIds);
            if (blockerErr) throw new CliError(blockerErr.message);
            for (const b of (blockerData ?? []) as { id: string; title: string; status: NodeStatus }[]) {
              blockerNodes.set(b.id, { title: b.title, status: b.status });
            }
          }
        }

        const recommended: TaskEntry[] = [];
        const notRecommended: TaskEntry[] = [];
        for (const n of nodes) {
          const blockers: BlockerInfo[] = (edgesByTarget.get(n.id) ?? []).map((e) => {
            const b = blockerNodes.get(e.source_id);
            return {
              edge_type: e.type,
              blocker_id: e.source_id,
              blocker_title: b?.title ?? '(unknown)',
              blocker_status: b?.status ?? 'unknown',
              unfinished: b ? b.status !== 'done' : true,
            };
          });
          const reasons: string[] = [];
          const unfinishedFirm = blockers.filter((b) => b.edge_type === 'firm_block' && b.unfinished);
          if (unfinishedFirm.length > 0) {
            reasons.push(
              `firm-blocked by ${unfinishedFirm.map((b) => `${short(b.blocker_id)} [${b.blocker_status}]`).join(', ')}`,
            );
          }
          const claimedByOther = n.claimed_by !== null && n.claimed_by !== (opts.session ?? null);
          if (claimedByOther) {
            reasons.push(`claimed by ${n.claimed_by}${n.claimed_at ? ` since ${n.claimed_at}` : ''}`);
          }
          const entry: TaskEntry = {
            id: n.id,
            project_id: n.project_id,
            project_name: projectNames.get(n.project_id) ?? null,
            title: n.title,
            status: n.status,
            stale: n.stale,
            claimed_by: n.claimed_by,
            claimed_at: n.claimed_at,
            blockers,
            not_recommended_reasons: reasons,
          };
          (reasons.length > 0 ? notRecommended : recommended).push(entry);
        }

        if (opts.json) {
          printJson({ recommended, not_recommended: notRecommended });
          return;
        }

        console.log(`RECOMMENDED (${recommended.length})`);
        if (recommended.length === 0) console.log('  (none)');
        for (const t of recommended) printTask(t, opts.session ?? null);
        console.log('');
        console.log(`NOT RECOMMENDED (${notRecommended.length})`);
        if (notRecommended.length === 0) console.log('  (none)');
        for (const t of notRecommended) printTask(t, opts.session ?? null);
      }),
    );
}

function printTask(t: TaskEntry, ownLabel: string | null): void {
  const flags: string[] = [];
  if (t.stale) flags.push('!! STALE');
  if (t.claimed_by !== null && t.claimed_by === ownLabel) flags.push(`claimed by you (${t.claimed_by})`);
  const proj = t.project_name ? `  {${t.project_name}}` : '';
  console.log(
    `  ${short(t.id)}  ${t.title}  [${t.status}]${proj}${flags.length > 0 ? '  ' + flags.join('  ') : ''}`,
  );
  for (const b of t.blockers) {
    const state = b.unfinished ? 'UNFINISHED' : 'finished';
    const warn =
      b.edge_type === 'soft_block' && b.unfinished
        ? ' — SOFT-BLOCKED: pick up only if nothing better to do and it is not a stretch'
        : '';
    console.log(
      `            ${b.edge_type} by ${short(b.blocker_id)} "${b.blocker_title}" [${b.blocker_status}] (${state})${warn}`,
    );
  }
  if (t.not_recommended_reasons.length > 0) {
    console.log(`            not recommended: ${t.not_recommended_reasons.join('; ')}`);
  }
}
