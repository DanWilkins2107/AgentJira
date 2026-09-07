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

/** Block-family edge types that gate/annotate a task's pickup. */
type BlockEdgeType =
  | 'firm_block'
  | 'soft_block'
  | 'firm_block_plan'
  | 'soft_block_plan'
  | 'reassess_after';
const BLOCK_EDGE_TYPES: BlockEdgeType[] = [
  'firm_block',
  'soft_block',
  'firm_block_plan',
  'soft_block_plan',
  'reassess_after',
];

interface BlockerInfo {
  edge_type: BlockEdgeType;
  blocker_id: string;
  blocker_title: string;
  blocker_status: NodeStatus | 'unknown';
  // False once the blocker no longer gates: for plan variants, when its plan has
  // landed (status done OR broken_down OR merge_sha recorded); for a plain block
  // on a broken_down source, when that source's subtree is complete.
  unfinished: boolean;
}

interface TaskEntry {
  id: string;
  project_id: string;
  project_name: string | null;
  title: string;
  status: NodeStatus;
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
  claimed_by: string | null;
  claimed_at: string | null;
}

export function registerTasks(program: Command): void {
  program
    .command('tasks')
    .description(
      `List actionable nodes in agent-turn statuses (${AGENT_TURN_STATUSES.join(', ')}), with claim/blocker annotations. Stale nodes (ancestor currently invalidated) are excluded — they are dead until the ancestor is restored`,
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
          .select('id, project_id, title, status, claimed_by, claimed_at')
          .in('status', [...AGENT_TURN_STATUSES])
          .order('created_at', { ascending: true });
        if (projectId) query = query.eq('project_id', projectId);
        const { data, error } = await query;
        if (error) throw new CliError(error.message);
        let nodes = (data ?? []) as TaskNodeRow[];

        // Derived stale (an ancestor is currently invalidated) per project via
        // the stale_node_ids RPC. Stale nodes are dead until the ancestor is
        // restored — never actionable, so they are excluded entirely.
        const staleIds = new Set<string>();
        const taskProjectIds = [...new Set(nodes.map((n) => n.project_id))];
        for (const pid of taskProjectIds) {
          const { data: staleData, error: staleErr } = await sb.rpc('stale_node_ids', {
            p_project: pid,
          });
          if (staleErr) throw new CliError(`stale_node_ids RPC failed: ${staleErr.message}`);
          for (const id of (staleData ?? []) as string[]) staleIds.add(id);
        }
        nodes = nodes.filter((n) => !staleIds.has(n.id));

        // Project names for annotation.
        const { data: projData, error: projErr } = await sb.from('projects').select('id, name');
        if (projErr) throw new CliError(projErr.message);
        const projectNames = new Map(
          ((projData ?? []) as { id: string; name: string }[]).map((p) => [p.id, p.name]),
        );

        // Non-removed firm/soft/reassess_after block edges targeting these
        // tasks, plus blocker nodes.
        const edgesByTarget = new Map<string, { source_id: string; type: BlockEdgeType }[]>();
        const blockerNodes = new Map<
          string,
          { title: string; status: NodeStatus; merge_sha: string | null }
        >();
        if (nodes.length > 0) {
          const ids = nodes.map((n) => n.id);
          const { data: edgeData, error: edgeErr } = await sb
            .from('edges')
            .select('source_id, target_id, type')
            .in('target_id', ids)
            .in('type', BLOCK_EDGE_TYPES)
            .is('removed_at', null);
          if (edgeErr) throw new CliError(edgeErr.message);
          const edges = (edgeData ?? []) as {
            source_id: string;
            target_id: string;
            type: BlockEdgeType;
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
              .select('id, title, status, merge_sha')
              .in('id', blockerIds);
            if (blockerErr) throw new CliError(blockerErr.message);
            for (const b of (blockerData ?? []) as {
              id: string;
              title: string;
              status: NodeStatus;
              merge_sha: string | null;
            }[]) {
              blockerNodes.set(b.id, { title: b.title, status: b.status, merge_sha: b.merge_sha });
            }
          }
        }

        // Coarse blocks: a plain firm/soft/reassess_after edge whose source is
        // broken_down can never reach 'done', so the status rule alone would gate
        // its target forever. Such a source is instead satisfied when its whole
        // subtask subtree is complete (no descendant still in a live status).
        // Resolve that once, in bulk, via the subtree_complete RPC.
        const subtreeComplete = new Map<string, boolean>();
        const brokenDownBlockerIds = [...blockerNodes.entries()]
          .filter(([, b]) => b.status === 'broken_down')
          .map(([id]) => id);
        if (brokenDownBlockerIds.length > 0) {
          const { data: scData, error: scErr } = await sb.rpc('subtree_complete', {
            p_ids: brokenDownBlockerIds,
          });
          if (scErr) throw new CliError(`subtree_complete RPC failed: ${scErr.message}`);
          for (const row of (scData ?? []) as { id: string; complete: boolean }[]) {
            subtreeComplete.set(row.id, row.complete);
          }
        }

        const recommended: TaskEntry[] = [];
        const notRecommended: TaskEntry[] = [];
        for (const n of nodes) {
          const blockers: BlockerInfo[] = (edgesByTarget.get(n.id) ?? []).map((e) => {
            const b = blockerNodes.get(e.source_id);
            // Plan variants are satisfied once the blocker's plan LANDS: status
            // done, status broken_down (the approved split IS the decision,
            // materialized — a node broken down without a plan-document PR never
            // reaches done or a merge_sha), OR a merge_sha recorded. A PLAIN
            // block on a broken_down source is a different thing — a coarse
            // block, satisfied only when that source's subtree is complete.
            // Everything else waits for done. Unknown blockers count as
            // unfinished; a missing RPC row is the safe default (unfinished).
            const planVariant = e.type === 'firm_block_plan' || e.type === 'soft_block_plan';
            let unfinished: boolean;
            if (!b) {
              unfinished = true;
            } else if (planVariant) {
              unfinished =
                b.status !== 'done' && b.status !== 'broken_down' && b.merge_sha === null;
            } else if (b.status === 'broken_down') {
              unfinished = !(subtreeComplete.get(e.source_id) ?? false);
            } else {
              unfinished = b.status !== 'done';
            }
            return {
              edge_type: e.type,
              blocker_id: e.source_id,
              blocker_title: b?.title ?? '(unknown)',
              blocker_status: b?.status ?? 'unknown',
              unfinished,
            };
          });
          const reasons: string[] = [];
          const unfinishedFirm = blockers.filter(
            (b) =>
              (b.edge_type === 'firm_block' || b.edge_type === 'firm_block_plan') && b.unfinished,
          );
          if (unfinishedFirm.length > 0) {
            reasons.push(
              `firm-blocked by ${unfinishedFirm.map((b) => `${short(b.blocker_id)} [${b.blocker_status}]`).join(', ')}`,
            );
          }
          // A reassess_after edge behaves like a firm block until its source is
          // done: the node is deferred for re-judgment, not actionable yet.
          const unfinishedReassess = blockers.filter(
            (b) => b.edge_type === 'reassess_after' && b.unfinished,
          );
          if (unfinishedReassess.length > 0) {
            reasons.push(
              `awaiting reassessment until ${unfinishedReassess.map((b) => `${short(b.blocker_id)} [${b.blocker_status}]`).join(', ')} resolves`,
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
  if (t.claimed_by !== null && t.claimed_by === ownLabel) flags.push(`claimed by you (${t.claimed_by})`);
  const proj = t.project_name ? `  {${t.project_name}}` : '';
  console.log(
    `  ${short(t.id)}  ${t.title}  [${t.status}]${proj}${flags.length > 0 ? '  ' + flags.join('  ') : ''}`,
  );
  for (const b of t.blockers) {
    const planVariant = b.edge_type === 'firm_block_plan' || b.edge_type === 'soft_block_plan';
    const state = b.unfinished
      ? 'UNFINISHED'
      : planVariant && b.blocker_status !== 'done'
        ? 'PLAN LANDED — decision available, no longer gating'
        : 'finished';
    const warn =
      (b.edge_type === 'soft_block' || b.edge_type === 'soft_block_plan') && b.unfinished
        ? ' — SOFT-BLOCKED: pick up only if nothing better to do and it is not a stretch'
        : b.edge_type === 'reassess_after' && b.unfinished
          ? ' — REASSESS-AFTER: deferred for re-judgment; treat as firm-blocked until it resolves'
          : '';
    console.log(
      `            ${b.edge_type} by ${short(b.blocker_id)} "${b.blocker_title}" [${b.blocker_status}] (${state})${warn}`,
    );
  }
  if (t.not_recommended_reasons.length > 0) {
    console.log(`            not recommended: ${t.not_recommended_reasons.join('; ')}`);
  }
}
