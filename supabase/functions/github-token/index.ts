// AgentJira — github-token Edge Function.
//
// Mints a short-lived, repo-scoped GitHub App installation token so that agents
// can push branches and open PRs as the app identity (agentjira[bot]) rather
// than as the operator. A distinct author identity is what lets the human
// reviewer approve the PR — GitHub forbids approving your own PR.
//
// Auth: the caller's Supabase JWT (the agent user). We run every query under
// that token, so RLS enforces project membership for us — a caller who is not a
// member of the node's project simply sees no node (=> 404), and the app's
// private key never leaves this function.
//
// The app key lives only here, as Function secrets:
//   GITHUB_APP_ID           — the numeric App ID (or client id)
//   GITHUB_APP_PRIVATE_KEY  — the app's private key, PKCS#8 PEM
//                             (BEGIN PRIVATE KEY). Convert a downloaded PKCS#1
//                             key with:
//                               openssl pkcs8 -topk8 -inform PEM -nocrypt \
//                                 -in app.private-key.pem
//
// Response: { token, expires_at }. The token is scoped to the single project
// repo with contents+pull_requests write and expires in ~1h.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const GITHUB_API = "https://api.github.com";
const UA = "agentjira-github-token";

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function isUuid(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
  );
}

// --- GitHub App JWT (RS256 via WebCrypto) ---

function base64url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64urlJson(value: unknown): string {
  return base64url(new TextEncoder().encode(JSON.stringify(value)));
}

function pemToDer(pem: string): ArrayBuffer {
  const body = pem
    .replace(/-----BEGIN [^-]+-----/g, "")
    .replace(/-----END [^-]+-----/g, "")
    .replace(/\s+/g, "");
  const bin = atob(body);
  const der = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) der[i] = bin.charCodeAt(i);
  return der.buffer as ArrayBuffer;
}

async function appJwt(appId: string, pem: string): Promise<string> {
  if (/BEGIN RSA PRIVATE KEY/.test(pem)) {
    // WebCrypto imports PKCS#8 only; GitHub hands out PKCS#1 by default.
    throw new Error(
      "GITHUB_APP_PRIVATE_KEY must be PKCS#8 (BEGIN PRIVATE KEY); convert with `openssl pkcs8 -topk8 -inform PEM -nocrypt -in app.pem`",
    );
  }
  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemToDer(pem),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const now = Math.floor(Date.now() / 1000);
  const signingInput =
    `${base64urlJson({ alg: "RS256", typ: "JWT" })}.` +
    // iat backdated 60s for clock skew; GitHub caps app JWT lifetime at 10 min.
    `${base64urlJson({ iat: now - 60, exp: now + 540, iss: appId })}`;
  const sig = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    new TextEncoder().encode(signingInput),
  );
  return `${signingInput}.${base64url(new Uint8Array(sig))}`;
}

async function githubJson(
  path: string,
  jwt: string,
  init?: RequestInit,
): Promise<{ status: number; body: unknown }> {
  const res = await fetch(`${GITHUB_API}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${jwt}`,
      accept: "application/vnd.github+json",
      "x-github-api-version": "2022-11-28",
      "user-agent": UA,
      ...(init?.headers ?? {}),
    },
  });
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    // some responses are empty; leave body null
  }
  return { status: res.status, body };
}

async function handle(
  supabase: SupabaseClient,
  req: Request,
): Promise<Response> {
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return json({ error: "invalid JSON body" }, 400);
  }
  const nodeId = (payload as { node_id?: unknown } | null)?.node_id;
  if (!isUuid(nodeId)) return json({ error: "node_id must be a uuid" }, 400);

  // RLS (caller's token) enforces membership: a non-member sees no node.
  const { data: node, error: nodeError } = await supabase
    .from("nodes")
    .select("id, project_id")
    .eq("id", nodeId)
    .maybeSingle();
  if (nodeError) return json({ error: "lookup failed" }, 500);
  if (!node) return json({ error: "node not found" }, 404);

  const { data: project, error: projectError } = await supabase
    .from("projects")
    .select("repo_owner, repo_name")
    .eq("id", node.project_id)
    .maybeSingle();
  if (projectError) return json({ error: "lookup failed" }, 500);
  if (!project) return json({ error: "node not found" }, 404);
  if (!project.repo_owner || !project.repo_name) {
    return json({ error: "project has no linked repo (set repo_owner/repo_name)" }, 400);
  }

  const appId = Deno.env.get("GITHUB_APP_ID");
  const pem = Deno.env.get("GITHUB_APP_PRIVATE_KEY");
  if (!appId || !pem) return json({ error: "app not configured" }, 500);

  let jwt: string;
  try {
    jwt = await appJwt(appId, pem);
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : "bad app key" }, 500);
  }

  const owner = encodeURIComponent(project.repo_owner);
  const repo = encodeURIComponent(project.repo_name);

  // Resolve the installation for this repo (no DB column needed).
  const inst = await githubJson(`/repos/${owner}/${repo}/installation`, jwt);
  if (inst.status === 404) {
    return json(
      { error: `GitHub App is not installed on ${project.repo_owner}/${project.repo_name}` },
      400,
    );
  }
  const installationId = (inst.body as { id?: number } | null)?.id;
  if (inst.status !== 200 || typeof installationId !== "number") {
    return json({ error: "could not resolve app installation" }, 502);
  }

  // Mint a token scoped to just this repo with the minimum write scopes.
  const tok = await githubJson(
    `/app/installations/${installationId}/access_tokens`,
    jwt,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        repositories: [project.repo_name],
        permissions: { contents: "write", pull_requests: "write" },
      }),
    },
  );
  const token = (tok.body as { token?: string } | null)?.token;
  const expiresAt = (tok.body as { expires_at?: string } | null)?.expires_at;
  if (tok.status !== 201 || !token) {
    return json({ error: "could not mint installation token" }, 502);
  }

  return json({ token, expires_at: expiresAt ?? null }, 200);
}

Deno.serve((req) => {
  const url = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const authHeader = req.headers.get("Authorization");
  if (!url || !anonKey) return json({ error: "server misconfigured" }, 500);
  if (!authHeader) return json({ error: "missing Authorization" }, 401);

  // Run as the caller so RLS applies (membership check comes for free).
  const supabase = createClient(url, anonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return handle(supabase, req);
});
