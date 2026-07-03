-- AgentJira — initial schema.
-- Contract: docs/architecture.md. Exact enum strings, no hard deletes, ever.
-- All graph traversals: visited-set + depth cap 50 (cycles are legal data).

-- ---------------------------------------------------------------------------
-- Extensions
-- ---------------------------------------------------------------------------

create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------------
-- Enums (exact strings, everywhere)
-- ---------------------------------------------------------------------------

create type public.node_status as enum (
  'human_braindump_needed',
  'awaiting_agent_breakdown',
  'awaiting_human_response',
  'split_proposed',
  'split_approved',
  'broken_down',
  'awaiting_agent_spec',
  'spec_review',
  'ready_for_pickup',
  'pr_raised',
  'done',
  'invalidated'
);

create type public.edge_type as enum (
  'subtask',
  'firm_block',
  'soft_block',
  'relates_to'
);

create type public.message_type as enum (
  'note',
  'question',
  'answer',
  'split_proposal',
  'split_decision',
  'spec_submission',
  'review_comment',
  'system'
);

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table public.projects (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 200),
  repo_owner text,            -- one repo per project, nullable until linked
  repo_name text,
  webhook_secret text not null default encode(extensions.gen_random_bytes(32), 'hex'),
  created_by uuid not null references auth.users (id),
  created_at timestamptz not null default now()
);

create table public.project_members (
  project_id uuid not null references public.projects (id),
  user_id uuid not null references auth.users (id),
  role text not null check (role in ('owner', 'agent')),
  primary key (project_id, user_id)
);

create table public.nodes (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id),
  title text not null check (char_length(title) between 1 and 300),
  body text not null default '',
  status public.node_status not null default 'human_braindump_needed',
  stale boolean not null default false,
  is_vision boolean not null default false,
  spec text,
  pr_url text,
  pr_number integer,
  merge_sha text,
  invalidation_reason text,
  claimed_by text,
  claimed_at timestamptz,
  tldraw_doc jsonb,
  canvas_png_path text,       -- storage path of latest snapshot
  created_by uuid not null references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  fts tsvector generated always as (to_tsvector('english',
    coalesce(title, '') || ' ' || coalesce(body, '') || ' ' ||
    coalesce(spec, '') || ' ' || coalesce(invalidation_reason, ''))) stored
);

create index nodes_project_status_idx on public.nodes (project_id, status);
create index nodes_fts_idx on public.nodes using gin (fts);

create table public.edges (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id),
  source_id uuid not null references public.nodes (id),
  target_id uuid not null references public.nodes (id),
  type public.edge_type not null,
  removed_at timestamptz,     -- edges are never deleted, only flagged removed
  created_by uuid not null references auth.users (id),
  created_at timestamptz not null default now(),
  check (source_id <> target_id)
);

create index edges_project_idx on public.edges (project_id);
create index edges_source_idx on public.edges (source_id);
create index edges_target_idx on public.edges (target_id);

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  node_id uuid not null references public.nodes (id),
  project_id uuid not null references public.projects (id),
  stage public.node_status not null,   -- thread scope = node + stage when posted
  author_role text not null check (author_role in ('human', 'agent', 'system')),
  author_id uuid references auth.users (id),
  type public.message_type not null,
  body text not null,
  created_at timestamptz not null default now(),
  fts tsvector generated always as (to_tsvector('english', coalesce(body, ''))) stored
);

create index messages_node_idx on public.messages (node_id);
create index messages_project_idx on public.messages (project_id);
create index messages_fts_idx on public.messages using gin (fts);

-- Append-only audit log.
create table public.events (
  id bigint generated always as identity primary key,
  project_id uuid not null,
  node_id uuid,
  actor_id uuid,
  actor_role text not null check (actor_role in ('human', 'agent', 'system')),
  type text not null,         -- e.g. node.created, node.status_changed, node.claimed,
                              --      node.invalidated, edge.created, message.posted,
                              --      pr.opened, pr.merged, canvas.snapshot
  data jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create index events_project_idx on public.events (project_id, created_at);
create index events_node_idx on public.events (node_id);

-- ---------------------------------------------------------------------------
-- Helpers (security definer so RLS policies can consult membership without
-- recursing into project_members' own policies)
-- ---------------------------------------------------------------------------

create function public.is_project_member(p uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from project_members pm
    where pm.project_id = p and pm.user_id = auth.uid()
  );
$$;

create function public.is_project_owner(p uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from project_members pm
    where pm.project_id = p and pm.user_id = auth.uid() and pm.role = 'owner'
  )
  or exists (
    select 1 from projects pr
    where pr.id = p and pr.created_by = auth.uid()
  );
$$;

-- Storage-policy membership check keyed by the object path's first folder
-- ({project_id}/...). Compares as text — no uuid cast — so a malformed path
-- can never raise inside a storage.objects policy (Postgres does not
-- guarantee AND short-circuit order); it simply does not match.
create function public.is_project_member_path(p_name text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from project_members pm
    where pm.user_id = auth.uid()
      and pm.project_id::text = (storage.foldername(p_name))[1]
  );
$$;

-- Actor role for event logging: membership row decides human vs agent;
-- no auth context (service role, seed, triggers-of-triggers) => system.
create function public.current_actor_role(p uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case
    when auth.uid() is null then 'system'
    when exists (
      select 1 from project_members pm
      where pm.project_id = p and pm.user_id = auth.uid() and pm.role = 'agent'
    ) then 'agent'
    else 'human'
  end;
$$;

-- ---------------------------------------------------------------------------
-- History is permanent: no deletes (or truncates), events append-only.
-- TRUNCATE is covered too: it bypasses both RLS and DELETE triggers, and
-- Supabase's default grants give `authenticated` TRUNCATE privilege.
-- ---------------------------------------------------------------------------

create function public.forbid_delete()
returns trigger
language plpgsql
as $$
begin
  raise exception 'AgentJira: rows in % are never deleted — history is permanent', tg_table_name;
end;
$$;

create function public.forbid_update()
returns trigger
language plpgsql
as $$
begin
  raise exception 'AgentJira: % is append-only', tg_table_name;
end;
$$;

create trigger nodes_no_delete
  before delete or truncate on public.nodes
  for each statement execute function public.forbid_delete();

create trigger edges_no_delete
  before delete or truncate on public.edges
  for each statement execute function public.forbid_delete();

create trigger messages_no_delete
  before delete or truncate on public.messages
  for each statement execute function public.forbid_delete();

create trigger events_no_delete
  before delete or truncate on public.events
  for each statement execute function public.forbid_delete();

create trigger events_no_update
  before update on public.events
  for each statement execute function public.forbid_update();

-- ---------------------------------------------------------------------------
-- updated_at maintenance
-- ---------------------------------------------------------------------------

create function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger nodes_set_updated_at
  before update on public.nodes
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Referential sanity: edges and messages must stay inside their project.
-- CHECK constraints can't subquery, so enforce with BEFORE triggers
-- (security definer: the check must see the true node rows, not an
-- RLS-filtered view — a cross-project reference is rejected either way).
-- ---------------------------------------------------------------------------

create function public.validate_edge_project()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from nodes n
                  where n.id = new.source_id and n.project_id = new.project_id)
     or not exists (select 1 from nodes n
                  where n.id = new.target_id and n.project_id = new.project_id)
  then
    raise exception 'AgentJira: edge endpoints must belong to the edge''s project';
  end if;
  return new;
end;
$$;

create trigger edges_validate_project
  before insert or update on public.edges
  for each row execute function public.validate_edge_project();

create function public.validate_message_project()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from nodes n
                  where n.id = new.node_id and n.project_id = new.project_id)
  then
    raise exception 'AgentJira: message node must belong to the message''s project';
  end if;
  return new;
end;
$$;

create trigger messages_validate_project
  before insert or update on public.messages
  for each row execute function public.validate_message_project();

-- ---------------------------------------------------------------------------
-- Event-logging triggers (security definer: any member's write must always be
-- able to log, and events RLS must never block the audit trail)
-- ---------------------------------------------------------------------------

create function public.log_node_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into events (project_id, node_id, actor_id, actor_role, type, data)
  values (
    new.project_id, new.id, auth.uid(), current_actor_role(new.project_id),
    'node.created',
    jsonb_build_object('title', new.title, 'status', new.status, 'is_vision', new.is_vision)
  );
  return new;
end;
$$;

create function public.log_node_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text := current_actor_role(new.project_id);
  v_changed jsonb := '{}'::jsonb;
begin
  -- Status transitions always get their own event with {from, to}.
  if new.status is distinct from old.status then
    insert into events (project_id, node_id, actor_id, actor_role, type, data)
    values (new.project_id, new.id, auth.uid(), v_role, 'node.status_changed',
            jsonb_build_object('from', old.status, 'to', new.status));
  end if;

  -- Claim changes get their own events too.
  if new.claimed_by is distinct from old.claimed_by then
    if new.claimed_by is not null then
      insert into events (project_id, node_id, actor_id, actor_role, type, data)
      values (new.project_id, new.id, auth.uid(), v_role, 'node.claimed',
              jsonb_build_object('claimed_by', new.claimed_by));
    else
      insert into events (project_id, node_id, actor_id, actor_role, type, data)
      values (new.project_id, new.id, auth.uid(), v_role, 'node.unclaimed',
              jsonb_build_object('was_claimed_by', old.claimed_by));
    end if;
  end if;

  -- Everything else: one node.updated event listing the changed fields.
  if new.title is distinct from old.title then
    v_changed := v_changed || jsonb_build_object('title', new.title);
  end if;
  if new.body is distinct from old.body then
    v_changed := v_changed || jsonb_build_object('body', 'changed');
  end if;
  if new.stale is distinct from old.stale then
    v_changed := v_changed || jsonb_build_object('stale', new.stale);
  end if;
  if new.spec is distinct from old.spec then
    v_changed := v_changed || jsonb_build_object('spec', 'changed');
  end if;
  if new.pr_url is distinct from old.pr_url then
    v_changed := v_changed || jsonb_build_object('pr_url', new.pr_url);
  end if;
  if new.pr_number is distinct from old.pr_number then
    v_changed := v_changed || jsonb_build_object('pr_number', new.pr_number);
  end if;
  if new.merge_sha is distinct from old.merge_sha then
    v_changed := v_changed || jsonb_build_object('merge_sha', new.merge_sha);
  end if;
  if new.invalidation_reason is distinct from old.invalidation_reason then
    v_changed := v_changed || jsonb_build_object('invalidation_reason', new.invalidation_reason);
  end if;
  if new.tldraw_doc is distinct from old.tldraw_doc then
    v_changed := v_changed || jsonb_build_object('tldraw_doc', 'changed');
  end if;
  if new.canvas_png_path is distinct from old.canvas_png_path then
    v_changed := v_changed || jsonb_build_object('canvas_png_path', new.canvas_png_path);
  end if;

  if v_changed <> '{}'::jsonb then
    insert into events (project_id, node_id, actor_id, actor_role, type, data)
    values (new.project_id, new.id, auth.uid(), v_role, 'node.updated',
            jsonb_build_object('changed', v_changed));
  end if;

  return new;
end;
$$;

create function public.log_edge_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into events (project_id, node_id, actor_id, actor_role, type, data)
  values (
    new.project_id, new.source_id, auth.uid(), current_actor_role(new.project_id),
    'edge.created',
    jsonb_build_object('edge_id', new.id, 'type', new.type,
                       'source_id', new.source_id, 'target_id', new.target_id)
  );
  return new;
end;
$$;

create function public.log_message_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into events (project_id, node_id, actor_id, actor_role, type, data)
  values (
    new.project_id, new.node_id, auth.uid(), current_actor_role(new.project_id),
    'message.posted',
    jsonb_build_object('message_id', new.id, 'type', new.type, 'stage', new.stage,
                       'author_role', new.author_role)
  );
  return new;
end;
$$;

create trigger nodes_log_insert
  after insert on public.nodes
  for each row execute function public.log_node_insert();

create trigger nodes_log_update
  after update on public.nodes
  for each row execute function public.log_node_update();

create trigger edges_log_insert
  after insert on public.edges
  for each row execute function public.log_edge_insert();

create trigger messages_log_insert
  after insert on public.messages
  for each row execute function public.log_message_insert();

-- ---------------------------------------------------------------------------
-- Project bootstrap: creator becomes owner member, vision node is created.
-- Security definer: the AFTER INSERT trigger runs as the inserting user, whose
-- RLS would otherwise block these writes (membership row doesn't exist yet).
-- ---------------------------------------------------------------------------

create function public.bootstrap_project()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into project_members (project_id, user_id, role)
  values (new.id, new.created_by, 'owner');

  insert into nodes (project_id, title, is_vision, status, created_by)
  values (new.id, new.name, true, 'human_braindump_needed', new.created_by);

  return new;
end;
$$;

create trigger projects_bootstrap
  after insert on public.projects
  for each row execute function public.bootstrap_project();

-- ---------------------------------------------------------------------------
-- RPCs (security invoker: RLS applies to the caller)
-- ---------------------------------------------------------------------------

-- Invalidate a node, then mark every reachable descendant (non-removed
-- `subtask` edges) and firm-block target stale — recursively, visited-set,
-- depth <= 50. `done` nodes get stale = true too (a merged premise can still
-- be stale); already-`invalidated` nodes are left alone.
create function public.invalidate_node(p_node uuid, p_reason text)
returns void
language plpgsql
as $$
declare
  v_project uuid;
  v_visited uuid[];
  v_frontier uuid[];
  v_next uuid[];
  v_depth integer := 0;
begin
  update public.nodes
     set status = 'invalidated',
         invalidation_reason = p_reason
   where id = p_node
   returning project_id into v_project;

  if v_project is null then
    raise exception 'node not found';
  end if;

  insert into public.events (project_id, node_id, actor_id, actor_role, type, data)
  values (v_project, p_node, auth.uid(), public.current_actor_role(v_project),
          'node.invalidated', jsonb_build_object('reason', p_reason));

  v_visited := array[p_node];
  v_frontier := array[p_node];

  while v_depth < 50 loop
    select coalesce(array_agg(distinct e.target_id), '{}'::uuid[])
      into v_next
      from public.edges e
     where e.source_id = any (v_frontier)
       and e.removed_at is null
       and e.type in ('subtask', 'firm_block')
       and not (e.target_id = any (v_visited));

    exit when v_next = '{}'::uuid[];

    with marked as (
      update public.nodes
         set stale = true
       where id = any (v_next)
         and status <> 'invalidated'
         and stale = false
       returning id, project_id
    )
    insert into public.events (project_id, node_id, actor_id, actor_role, type, data)
    select m.project_id, m.id, auth.uid(), public.current_actor_role(m.project_id),
           'node.marked_stale',
           jsonb_build_object('invalidated_ancestor', p_node, 'reason', p_reason)
      from marked m;

    v_visited := v_visited || v_next;
    v_frontier := v_next;
    v_depth := v_depth + 1;
  end loop;
end;
$$;

-- Unified FTS over nodes and messages. RLS still applies (security invoker),
-- so callers only ever see projects they are members of.
create function public.search_all(p_project uuid, p_query text)
returns table (kind text, node_id uuid, title text, snippet text, rank real)
language plpgsql
stable
as $$
declare
  v_tsq tsquery := websearch_to_tsquery('english', p_query);
begin
  return query
  select 'node'::text,
         n.id,
         n.title,
         ts_headline('english',
           n.title || ' ' || n.body || ' ' || coalesce(n.spec, '') || ' ' ||
           coalesce(n.invalidation_reason, ''), v_tsq),
         ts_rank(n.fts, v_tsq)::real
    from public.nodes n
   where n.project_id = p_project
     and n.fts @@ v_tsq
  union all
  select 'message'::text,
         m.node_id,
         n.title,
         ts_headline('english', m.body, v_tsq),
         ts_rank(m.fts, v_tsq)::real
    from public.messages m
    join public.nodes n on n.id = m.node_id
   where m.project_id = p_project
     and m.fts @@ v_tsq
   order by 5 desc;
end;
$$;

-- Full context for a node: the node, its edges (both directions, incl.
-- removed), ancestor chain via subtask edges up to the vision node, children,
-- and blockers with their statuses. Visited-set, depth <= 50 (cycles are
-- legal data). Invalidated/stale ancestors are served, never filtered out.
create function public.node_context(p_node uuid)
returns jsonb
language plpgsql
stable
as $$
declare
  v_node public.nodes%rowtype;
  v_edges jsonb;
  v_ancestors jsonb := '[]'::jsonb;
  v_children jsonb;
  v_blockers jsonb;
  v_visited uuid[];
  v_frontier uuid[];
  v_next uuid[];
  v_depth integer := 0;
  v_level jsonb;
begin
  select * into v_node from public.nodes where id = p_node;
  if not found then
    raise exception 'node not found';
  end if;

  -- Edges, both directions, including removed ones.
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', e.id,
           'type', e.type,
           'source_id', e.source_id,
           'target_id', e.target_id,
           'removed_at', e.removed_at,
           'created_at', e.created_at,
           'direction', case when e.source_id = p_node then 'out' else 'in' end,
           'other_node', jsonb_build_object(
             'id', o.id, 'title', o.title, 'status', o.status, 'stale', o.stale)
         ) order by e.created_at), '[]'::jsonb)
    into v_edges
    from public.edges e
    join public.nodes o
      on o.id = case when e.source_id = p_node then e.target_id else e.source_id end
   where e.source_id = p_node or e.target_id = p_node;

  -- Ancestor chain: walk up non-removed subtask edges (parent = source).
  v_visited := array[p_node];
  v_frontier := array[p_node];
  while v_depth < 50 loop
    select coalesce(array_agg(distinct e.source_id), '{}'::uuid[])
      into v_next
      from public.edges e
     where e.target_id = any (v_frontier)
       and e.type = 'subtask'
       and e.removed_at is null
       and not (e.source_id = any (v_visited));

    exit when v_next = '{}'::uuid[];
    v_depth := v_depth + 1;

    select coalesce(jsonb_agg(jsonb_build_object(
             'id', n.id,
             'title', n.title,
             'status', n.status,
             'stale', n.stale,
             'invalidation_reason', n.invalidation_reason,
             'is_vision', n.is_vision,
             'depth', v_depth)), '[]'::jsonb)
      into v_level
      from public.nodes n
     where n.id = any (v_next);

    v_ancestors := v_ancestors || v_level;
    v_visited := v_visited || v_next;
    v_frontier := v_next;
  end loop;

  -- Children: targets of non-removed subtask edges from this node.
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', c.id,
           'title', c.title,
           'status', c.status,
           'stale', c.stale,
           'claimed_by', c.claimed_by) order by c.created_at), '[]'::jsonb)
    into v_children
    from public.edges e
    join public.nodes c on c.id = e.target_id
   where e.source_id = p_node
     and e.type = 'subtask'
     and e.removed_at is null;

  -- Blockers: sources of non-removed firm/soft block edges targeting this node.
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', b.id,
           'title', b.title,
           'status', b.status,
           'stale', b.stale,
           'block_type', e.type) order by e.created_at), '[]'::jsonb)
    into v_blockers
    from public.edges e
    join public.nodes b on b.id = e.source_id
   where e.target_id = p_node
     and e.type in ('firm_block', 'soft_block')
     and e.removed_at is null;

  return jsonb_build_object(
    'node', to_jsonb(v_node) - 'fts',
    'edges', v_edges,
    'ancestors', v_ancestors,
    'children', v_children,
    'blockers', v_blockers
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------

alter table public.projects enable row level security;
alter table public.project_members enable row level security;
alter table public.nodes enable row level security;
alter table public.edges enable row level security;
alter table public.messages enable row level security;
alter table public.events enable row level security;

-- projects: select where member; insert where created_by = auth.uid();
-- update only by the owner. No delete policy.
create policy projects_select on public.projects
  for select to authenticated
  using (public.is_project_member(id));

create policy projects_insert on public.projects
  for insert to authenticated
  with check (created_by = auth.uid());

create policy projects_update on public.projects
  for update to authenticated
  using (public.is_project_owner(id))
  with check (public.is_project_owner(id));

-- project_members: select where member; insert/update only by project owner.
-- is_project_member/is_project_owner are security definer, so these policies
-- do not recurse into project_members' own policies. No delete policy.
create policy project_members_select on public.project_members
  for select to authenticated
  using (public.is_project_member(project_id));

create policy project_members_insert on public.project_members
  for insert to authenticated
  with check (public.is_project_owner(project_id));

create policy project_members_update on public.project_members
  for update to authenticated
  using (public.is_project_owner(project_id))
  with check (public.is_project_owner(project_id));

-- nodes / edges / messages: select/insert/update where member. No delete
-- policies (plus the raise-trigger belt-and-braces).
create policy nodes_select on public.nodes
  for select to authenticated
  using (public.is_project_member(project_id));

create policy nodes_insert on public.nodes
  for insert to authenticated
  with check (public.is_project_member(project_id));

create policy nodes_update on public.nodes
  for update to authenticated
  using (public.is_project_member(project_id))
  with check (public.is_project_member(project_id));

create policy edges_select on public.edges
  for select to authenticated
  using (public.is_project_member(project_id));

create policy edges_insert on public.edges
  for insert to authenticated
  with check (public.is_project_member(project_id));

create policy edges_update on public.edges
  for update to authenticated
  using (public.is_project_member(project_id))
  with check (public.is_project_member(project_id));

create policy messages_select on public.messages
  for select to authenticated
  using (public.is_project_member(project_id));

create policy messages_insert on public.messages
  for insert to authenticated
  with check (public.is_project_member(project_id));

create policy messages_update on public.messages
  for update to authenticated
  using (public.is_project_member(project_id))
  with check (public.is_project_member(project_id));

-- events: select/insert where member; no update/delete (append-only).
create policy events_select on public.events
  for select to authenticated
  using (public.is_project_member(project_id));

create policy events_insert on public.events
  for insert to authenticated
  with check (public.is_project_member(project_id));

-- ---------------------------------------------------------------------------
-- Storage: private `canvases` bucket, membership-scoped via the
-- {project_id}/{node_id}/{ISO-timestamp}.png path convention.
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public)
values ('canvases', 'canvases', false)
on conflict (id) do nothing;

create policy canvases_member_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'canvases'
    and public.is_project_member_path(name)
  );

create policy canvases_member_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'canvases'
    and public.is_project_member_path(name)
  );

create policy canvases_member_update on storage.objects
  for update to authenticated
  using (
    bucket_id = 'canvases'
    and public.is_project_member_path(name)
  )
  with check (
    bucket_id = 'canvases'
    and public.is_project_member_path(name)
  );
