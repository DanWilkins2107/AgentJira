// AgentJira — github-sync Edge Function.
//
// Called only by the GitHub Actions workflow installed in each project repo.
// Auth: the `x-agentjira-secret` header must equal the node's project's
// `webhook_secret`. Uses the service-role key internally (bypasses RLS).
// Unknown node or bad secret => 404/401 with no detail leaked.
// Idempotent: re-sending any action (e.g. pr_merged) is harmless.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

type Action = "pr_opened" | "pr_approved" | "pr_merged" | "pr_closed";

const ACTIONS: readonly Action[] = [
  "pr_opened",
  "pr_approved",
  "pr_merged",
  "pr_closed",
] as const;

interface SyncPayload {
  node_id: string;
  action: Action;
  pr_url?: string;
  pr_number?: number;
  repo?: string;
  merge_sha?: string; // pr_merged only
  actor?: string; // github login
}

const EVENT_TYPE: Record<Action, string> = {
  pr_opened: "pr.opened",
  pr_approved: "pr.approved",
  pr_merged: "pr.merged",
  pr_closed: "pr.closed",
};

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** Constant-time string comparison so the secret can't be probed by timing. */
function timingSafeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const ab = enc.encode(a);
  const bb = enc.encode(b);
  let diff = ab.length ^ bb.length;
  const len = Math.max(ab.length, bb.length);
  for (let i = 0; i < len; i++) {
    diff |= (ab[i] ?? 0) ^ (bb[i] ?? 0);
  }
  return diff === 0;
}

function isSyncPayload(value: unknown): value is SyncPayload {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.node_id === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      v.node_id,
    ) &&
    typeof v.action === "string" &&
    (ACTIONS as readonly string[]).includes(v.action)
  );
}

function messageBody(payload: SyncPayload): string {
  const pr = payload.pr_number !== undefined ? `PR #${payload.pr_number}` : "PR";
  const by = payload.actor ? ` by ${payload.actor}` : "";
  switch (payload.action) {
    case "pr_opened":
      return `${pr} opened${by}${payload.pr_url ? `: ${payload.pr_url}` : ""}`;
    case "pr_approved":
      return `${pr} approved${by} on GitHub.`;
    case "pr_merged":
      return `${pr} merged${by}${
        payload.merge_sha ? ` (merge SHA ${payload.merge_sha})` : ""
      }. Node is done.`;
    case "pr_closed":
      return `${pr} closed without merging${by}. Needs triage.`;
  }
}

async function handle(
  supabase: SupabaseClient,
  req: Request,
): Promise<Response> {
  if (req.method !== "POST") {
    return json({ ok: false }, 405);
  }

  const secret = req.headers.get("x-agentjira-secret");
  if (!secret) return json({ ok: false }, 401);

  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return json({ ok: false }, 400);
  }
  if (!isSyncPayload(payload)) return json({ ok: false }, 400);

  // Look up the node, then its project's webhook secret. Leak nothing.
  const { data: node, error: nodeError } = await supabase
    .from("nodes")
    .select("id, project_id, status")
    .eq("id", payload.node_id)
    .maybeSingle();
  if (nodeError) return json({ ok: false }, 500);
  if (!node) return json({ ok: false }, 404);

  const { data: project, error: projectError } = await supabase
    .from("projects")
    .select("id, webhook_secret")
    .eq("id", node.project_id)
    .maybeSingle();
  if (projectError) return json({ ok: false }, 500);
  if (!project) return json({ ok: false }, 404);

  if (!timingSafeEqual(secret, project.webhook_secret)) {
    return json({ ok: false }, 401);
  }

  // Effects. pr_approved / pr_closed change no node fields — event + system
  // message only; a closed-unmerged PR is for humans/agents to triage.
  let stage: string = node.status;
  const updates: Record<string, unknown> = {};
  if (payload.action === "pr_opened") {
    if (payload.pr_url !== undefined) updates.pr_url = payload.pr_url;
    if (payload.pr_number !== undefined) updates.pr_number = payload.pr_number;
    updates.status = "pr_raised";
    stage = "pr_raised";
  } else if (payload.action === "pr_merged") {
    updates.status = "done";
    if (payload.merge_sha !== undefined) updates.merge_sha = payload.merge_sha;
    stage = "done";
  }

  if (Object.keys(updates).length > 0) {
    const { error } = await supabase
      .from("nodes")
      .update(updates)
      .eq("id", node.id);
    if (error) return json({ ok: false }, 500);
  }

  // Audit event (the node update above also fires the DB-side event triggers;
  // this row records the GitHub-side facts).
  const { error: eventError } = await supabase.from("events").insert({
    project_id: node.project_id,
    node_id: node.id,
    actor_id: null,
    actor_role: "system",
    type: EVENT_TYPE[payload.action],
    data: {
      action: payload.action,
      pr_url: payload.pr_url ?? null,
      pr_number: payload.pr_number ?? null,
      repo: payload.repo ?? null,
      merge_sha: payload.merge_sha ?? null,
      actor: payload.actor ?? null,
    },
  });
  if (eventError) return json({ ok: false }, 500);

  // System message on the node's thread at its current stage.
  const { error: messageError } = await supabase.from("messages").insert({
    node_id: node.id,
    project_id: node.project_id,
    stage,
    author_role: "system",
    author_id: null,
    type: "system",
    body: messageBody(payload),
  });
  if (messageError) return json({ ok: false }, 500);

  return json({ ok: true }, 200);
}

Deno.serve((req) => {
  const url = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceRoleKey) return json({ ok: false }, 500);

  const supabase = createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return handle(supabase, req);
});
