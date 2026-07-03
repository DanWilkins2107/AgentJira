-- Explicit table privileges. The initial migration relied on Supabase's
-- default grants, which do not reliably apply to tables created in
-- migrations; grant exactly what each role needs (RLS still applies on
-- top for authenticated). No role except postgres gets DELETE or TRUNCATE
-- — history is permanent.

grant usage on schema public to anon, authenticated, service_role;

-- Authenticated humans/agents: read + write, never delete/truncate.
grant select, insert, update on all tables in schema public to authenticated;
revoke truncate on all tables in schema public from anon, authenticated;
-- events is append-only (the trigger also enforces this).
revoke update on public.events from authenticated;

-- The events identity column needs sequence access for inserts.
grant usage, select on all sequences in schema public to authenticated, service_role;

-- Edge function (service role): full DML; delete/truncate stay blocked by triggers.
grant select, insert, update on all tables in schema public to service_role;

-- RPCs and helpers.
grant execute on all functions in schema public to authenticated, service_role;

-- Anon: no table access (login happens against the auth schema).
revoke select, insert, update, delete on all tables in schema public from anon;

-- Future tables/sequences/functions created by postgres get the same shape.
alter default privileges in schema public
  grant select, insert, update on tables to authenticated, service_role;
alter default privileges in schema public
  grant usage, select on sequences to authenticated, service_role;
alter default privileges in schema public
  grant execute on functions to authenticated, service_role;
