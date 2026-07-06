-- Creating a project failed from the UI: INSERT ... RETURNING applies the
-- SELECT policy, but the creator's owner-membership row is only written by
-- the projects_bootstrap AFTER INSERT trigger — not yet visible to the
-- RETURNING check. Let creators always see their own projects (mirrors the
-- created_by fallback already in is_project_owner).

alter policy projects_select on public.projects
  using (created_by = auth.uid() or public.is_project_member(id));
