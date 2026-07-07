import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Command } from 'commander';
import type { SupabaseClient } from '@supabase/supabase-js';
import { connect } from '../client.js';
import { CliError, printJson, short, wrap } from '../output.js';
import { resolveAndFetchNode } from '../resolve.js';
import type { MessageRow, NodeRow } from '../types.js';

interface Opts {
  json?: boolean;
}

interface CanvasResult {
  node_id: string;
  title: string;
  storage_path: string;
  local_path?: string;
  error?: string;
}

type Obj = Record<string, unknown>;

export function registerContext(program: Command): void {
  program
    .command('context <node>')
    .description(
      'Full context dump: node_context RPC, all thread messages grouped by stage, and canvas PNGs downloaded to a temp dir',
    )
    .option('--json', 'output structured JSON')
    .action(
      wrap(async (nodeRef: string, opts: Opts) => {
        const { sb } = await connect();
        const node = await resolveAndFetchNode(sb, nodeRef);

        const { data: ctxData, error: rpcErr } = await sb.rpc('node_context', {
          p_node: node.id,
        });
        if (rpcErr) throw new CliError(`node_context RPC failed: ${rpcErr.message}`);
        const context: Obj = isObj(ctxData) ? ctxData : {};

        const { data: msgData, error: msgErr } = await sb
          .from('messages')
          .select('*')
          .eq('node_id', node.id)
          .order('created_at', { ascending: true });
        if (msgErr) throw new CliError(msgErr.message);
        const messages = (msgData ?? []) as MessageRow[];
        const messagesByStage = new Map<string, MessageRow[]>();
        for (const m of messages) {
          const list = messagesByStage.get(m.stage) ?? [];
          list.push(m);
          messagesByStage.set(m.stage, list);
        }

        // Canvas PNGs: the node itself + every ancestor with a canvas_png_path.
        const ancestors = asObjArray(context['ancestors'] ?? context['ancestor_chain']);
        const ancestorIds = ancestors
          .map((a) => strField(a, 'id'))
          .filter((id): id is string => id !== null);
        const canvases = await downloadCanvases(sb, node, ancestorIds);

        if (opts.json) {
          printJson({
            node,
            context,
            messages_by_stage: Object.fromEntries(messagesByStage),
            canvases,
          });
          return;
        }

        printHuman(node, context, ancestors, messagesByStage, canvases);
      }),
    );
}

async function downloadCanvases(
  sb: SupabaseClient,
  node: NodeRow,
  ancestorIds: string[],
): Promise<CanvasResult[]> {
  const wantIds = [...new Set([node.id, ...ancestorIds])];
  const { data, error } = await sb
    .from('nodes')
    .select('id, title, canvas_png_path')
    .in('id', wantIds);
  if (error) throw new CliError(error.message);
  const rows = (data ?? []) as { id: string; title: string; canvas_png_path: string | null }[];
  const withCanvas = rows.filter(
    (r): r is { id: string; title: string; canvas_png_path: string } => r.canvas_png_path !== null,
  );
  if (withCanvas.length === 0) return [];

  const outDir = path.join(os.tmpdir(), 'agentjira', node.id);
  fs.mkdirSync(outDir, { recursive: true });

  const results: CanvasResult[] = [];
  for (const row of withCanvas) {
    const { data: blob, error: dlErr } = await sb.storage
      .from('canvases')
      .download(row.canvas_png_path);
    if (dlErr || !blob) {
      results.push({
        node_id: row.id,
        title: row.title,
        storage_path: row.canvas_png_path,
        error: dlErr ? dlErr.message : 'empty download',
      });
      continue;
    }
    const localPath = path.join(outDir, `${row.id}.png`);
    fs.writeFileSync(localPath, Buffer.from(await blob.arrayBuffer()));
    results.push({
      node_id: row.id,
      title: row.title,
      storage_path: row.canvas_png_path,
      local_path: localPath,
    });
  }
  return results;
}

function printHuman(
  node: NodeRow,
  context: Obj,
  ancestors: Obj[],
  messagesByStage: Map<string, MessageRow[]>,
  canvases: CanvasResult[],
): void {
  console.log(`=== NODE ${node.id} ===`);
  console.log(`Title:   ${node.title}`);
  console.log(`Status:  ${node.status}${node.is_vision ? '  (vision node)' : ''}`);
  console.log(`Project: ${node.project_id}`);
  if (node.claimed_by) {
    console.log(`Claimed: ${node.claimed_by}${node.claimed_at ? ` since ${node.claimed_at}` : ''}`);
  }
  if (node.pr_url) {
    console.log(
      `PR:      ${node.pr_url}${node.pr_number !== null ? ` (#${node.pr_number})` : ''}${node.merge_sha ? `  merge_sha=${node.merge_sha}` : ''}`,
    );
  }
  // Stale is derived server-side by node_context (an ancestor is currently
  // invalidated); it is not a nodes-table column.
  const ctxNode = isObj(context['node']) ? context['node'] : {};
  if (ctxNode['stale'] === true) {
    console.log(
      '!! STALE — an ancestor is currently invalidated; this node is dead until that ancestor is restored',
    );
  }
  if (node.status === 'invalidated' || node.invalidation_reason) {
    console.log(`!! INVALIDATED — reason: ${node.invalidation_reason ?? '(none recorded)'}`);
  }

  if (node.body.trim() !== '') {
    console.log('');
    console.log('BODY:');
    console.log(indent(node.body));
  }
  if (node.spec !== null && node.spec.trim() !== '') {
    console.log('');
    console.log('SPEC:');
    console.log(indent(node.spec));
  }

  console.log('');
  console.log('ANCESTORS (toward the vision node):');
  if (ancestors.length === 0) {
    console.log('  (none)');
  }
  for (const a of ancestors) {
    const id = strField(a, 'id');
    const title = strField(a, 'title');
    const status = strField(a, 'status');
    if (id === null && title === null) {
      console.log(`  ${JSON.stringify(a)}`);
      continue;
    }
    let line = `  ${id ? short(id) : '????????'}  "${title ?? '?'}"  [${status ?? '?'}]`;
    if (a['stale'] === true) line += '  !! STALE';
    const reason = strField(a, 'invalidation_reason');
    if (status === 'invalidated' || reason !== null) {
      line += `  !! INVALIDATED${reason !== null ? `: ${reason}` : ''}`;
    }
    console.log(line);
  }

  const children = asObjArray(context['children']);
  console.log('');
  console.log('CHILDREN:');
  if (children.length === 0) console.log('  (none)');
  for (const c of children) {
    console.log(`  ${summarizeNodeish(c)}`);
  }

  const blockers = asObjArray(context['blockers']);
  console.log('');
  console.log('BLOCKERS:');
  if (blockers.length === 0) console.log('  (none)');
  for (const b of blockers) {
    let line = summarizeNodeish(b);
    // A broken-down blocker is a coarse, parent-level block: it's hidden from the
    // graph (its subtasks carry the specific blocks) but still real, so surface it
    // here in words rather than as an edge the reader can't see.
    if (strField(b, 'status') === 'broken_down') {
      line += '  ⟵ coarse parent-level block (broken down; its subtasks carry the specific blocks)';
    }
    console.log(`  ${line}`);
  }

  const edges = asObjArray(context['edges']);
  console.log('');
  console.log('EDGES (source -> target; includes removed):');
  if (edges.length === 0) console.log('  (none)');
  for (const e of edges) {
    const type = strField(e, 'type');
    const source = strField(e, 'source_id');
    const target = strField(e, 'target_id');
    if (type === null || source === null || target === null) {
      console.log(`  ${JSON.stringify(e)}`);
      continue;
    }
    const removed = e['removed_at'] ? `  (REMOVED ${String(e['removed_at'])})` : '';
    console.log(`  ${type}  ${short(source)} -> ${short(target)}${removed}`);
  }

  // Anything in the RPC result we did not render structurally — never hide context.
  const knownKeys = new Set(['node', 'ancestors', 'ancestor_chain', 'children', 'blockers', 'edges']);
  const extraKeys = Object.keys(context).filter((k) => !knownKeys.has(k));
  if (extraKeys.length > 0) {
    console.log('');
    console.log('ADDITIONAL CONTEXT (raw):');
    for (const k of extraKeys) {
      console.log(indent(`${k}: ${JSON.stringify(context[k], null, 2)}`));
    }
  }

  console.log('');
  console.log('MESSAGES (grouped by stage):');
  if (messagesByStage.size === 0) console.log('  (none)');
  for (const [stage, msgs] of messagesByStage) {
    console.log(`  -- stage: ${stage} --`);
    for (const m of msgs) {
      console.log(`  [${m.created_at}] ${m.author_role}/${m.type} (${short(m.id)}):`);
      console.log(indent(m.body, '    '));
    }
  }

  console.log('');
  console.log('CANVAS IMAGES — Read these image files for visual context:');
  if (canvases.length === 0) console.log('  (none)');
  for (const c of canvases) {
    if (c.local_path) {
      console.log(`  ${c.local_path}   (node ${short(c.node_id)} "${c.title}")`);
    } else {
      console.log(
        `  (canvas for ${short(c.node_id)} "${c.title}" could not be downloaded: ${c.error ?? 'unknown error'})`,
      );
    }
  }
}

function summarizeNodeish(o: Obj): string {
  const id = strField(o, 'id') ?? strField(o, 'node_id') ?? strField(o, 'blocker_id');
  const title = strField(o, 'title');
  const status = strField(o, 'status');
  if (id === null && title === null) return JSON.stringify(o);
  let line = `${id ? short(id) : '????????'}  "${title ?? '?'}"  [${status ?? '?'}]`;
  const type = strField(o, 'type') ?? strField(o, 'edge_type') ?? strField(o, 'block_type');
  if (type !== null) line += `  via ${type}`;
  if (o['stale'] === true) line += '  !! STALE';
  const reason = strField(o, 'invalidation_reason');
  if (status === 'invalidated' || reason !== null) {
    line += `  !! INVALIDATED${reason !== null ? `: ${reason}` : ''}`;
  }
  return line;
}

function isObj(v: unknown): v is Obj {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function asObjArray(v: unknown): Obj[] {
  return Array.isArray(v) ? v.filter(isObj) : [];
}

function strField(o: Obj, key: string): string | null {
  const v = o[key];
  return typeof v === 'string' ? v : null;
}

function indent(text: string, pad = '  '): string {
  return text
    .split('\n')
    .map((l) => pad + l)
    .join('\n');
}
