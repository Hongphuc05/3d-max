-- v3 P2: audit trail for admin/system actions (sync, review, publish).
-- model_download_sessions / model_download_logs are NOT here: they reference devices and entitlements,
-- which migration 017 (P4/P5) creates. They move to a later migration together with the device model.
create table audit_events (
  id uuid primary key default gen_random_uuid(),
  actor_kind text not null check (actor_kind in ('ADMIN','TELEGRAM_OWNER','SYSTEM')),
  actor_ref text,
  action text not null check (length(action) between 1 and 100),
  target_type text not null check (length(target_type) between 1 and 100),
  target_id text,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index audit_events_created_idx on audit_events (created_at desc);
create index audit_events_target_idx on audit_events (target_type, target_id);
