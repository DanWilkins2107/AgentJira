-- AgentJira — plan-deliverable nodes: breakdown on merge.
--
-- Some nodes deliver a PLAN, not working code: the PR that closes them lands a
-- spec / plan document in the repo. Merging that PR should not park the node at
-- `done` — the planned work still has to be split into tasks. The
-- `breakdown_on_merge` flag marks such a node before its PR merges (agent:
-- `aj set-breakdown-on-merge <node>`; human: toggle on the node's Spec/PR tab).
-- github-sync consults it on pr_merged and routes the node back to
-- `awaiting_agent_breakdown` (still recording `merge_sha`) instead of `done`.
-- No new status — the node re-enters the existing breakdown stage, where the
-- merged document is the primary input for the split.

alter table public.nodes
  add column breakdown_on_merge boolean not null default false;

-- ---------------------------------------------------------------------------
-- log_node_update: same event contract as 0003, plus the new flag in the
-- node.updated changed-fields log.
-- ---------------------------------------------------------------------------

create or replace function public.log_node_update()
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
  if new.breakdown_on_merge is distinct from old.breakdown_on_merge then
    v_changed := v_changed || jsonb_build_object('breakdown_on_merge', new.breakdown_on_merge);
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
