-- AgentJira — local-dev seed. Applied by `supabase db reset` after migrations.
-- NOT for cloud: create real users there (see supabase/README.md).
--
-- Users (password for both: agentjira-dev):
--   dan@agentjira.local   — owner
--   agent@agentjira.local — the dedicated agent user
-- One sample project owned by dan; the projects AFTER INSERT trigger creates
-- the owner membership + vision node; agent is added as an 'agent' member.

-- ---------------------------------------------------------------------------
-- Auth users
-- ---------------------------------------------------------------------------

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change
)
values
  (
    '00000000-0000-0000-0000-000000000000',
    '11111111-1111-1111-1111-111111111111',
    'authenticated', 'authenticated', 'dan@agentjira.local',
    extensions.crypt('agentjira-dev', extensions.gen_salt('bf')),
    now(),
    '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
    now(), now(), '', '', '', ''
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '22222222-2222-2222-2222-222222222222',
    'authenticated', 'authenticated', 'agent@agentjira.local',
    extensions.crypt('agentjira-dev', extensions.gen_salt('bf')),
    now(),
    '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
    now(), now(), '', '', '', ''
  );

insert into auth.identities (
  id, user_id, provider_id, identity_data, provider,
  last_sign_in_at, created_at, updated_at
)
values
  (
    gen_random_uuid(),
    '11111111-1111-1111-1111-111111111111',
    '11111111-1111-1111-1111-111111111111',
    jsonb_build_object(
      'sub', '11111111-1111-1111-1111-111111111111',
      'email', 'dan@agentjira.local',
      'email_verified', true
    ),
    'email', now(), now(), now()
  ),
  (
    gen_random_uuid(),
    '22222222-2222-2222-2222-222222222222',
    '22222222-2222-2222-2222-222222222222',
    jsonb_build_object(
      'sub', '22222222-2222-2222-2222-222222222222',
      'email', 'agent@agentjira.local',
      'email_verified', true
    ),
    'email', now(), now(), now()
  );

-- ---------------------------------------------------------------------------
-- Sample project (trigger creates owner membership + vision node)
-- ---------------------------------------------------------------------------

insert into public.projects (id, name, webhook_secret, created_by)
values (
  '33333333-3333-3333-3333-333333333333',
  'AgentJira Sample Project',
  'agentjira-dev-webhook-secret',  -- fixed for local github-sync testing
  '11111111-1111-1111-1111-111111111111'
);

insert into public.project_members (project_id, user_id, role)
values (
  '33333333-3333-3333-3333-333333333333',
  '22222222-2222-2222-2222-222222222222',
  'agent'
);
