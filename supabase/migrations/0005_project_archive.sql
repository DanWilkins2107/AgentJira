-- Soft-archive for projects. "Delete a project" can only ever mean archive:
-- hard deletes are forbidden (non-negotiable #2) and structurally impossible
-- anyway — nodes/edges/messages/events FK-reference projects(id) and their
-- BEFORE DELETE triggers raise. Archiving is a reversible owner action that
-- hides the project from the default list; all history stays.

alter table public.projects
  add column archived_at timestamptz;   -- null = active; set = archived (reversible)

-- No new RLS policy needed: setting/clearing archived_at is an UPDATE on
-- projects, already restricted to the owner by projects_update. Archived
-- projects remain SELECT-able by members so the owner can list and unarchive
-- them; the web UI filters them out of the default view.

-- Audit the archive/unarchive transition (history is sacred). Project-level
-- event: node_id is null. Security definer so it can log regardless of the
-- caller's events RLS, mirroring the other log_* triggers.
create function public.log_project_archive()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.archived_at is distinct from old.archived_at then
    insert into events (project_id, node_id, actor_id, actor_role, type, data)
    values (
      new.id, null, auth.uid(), current_actor_role(new.id),
      case when new.archived_at is null then 'project.unarchived' else 'project.archived' end,
      jsonb_build_object('name', new.name)
    );
  end if;
  return new;
end;
$$;

create trigger projects_log_archive
  after update on public.projects
  for each row execute function public.log_project_archive();
