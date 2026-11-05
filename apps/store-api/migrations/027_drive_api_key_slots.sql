-- Store up to five server-side Google Drive API keys. The key material is encrypted by the API/worker
-- with a key derived from JWT_SECRET; raw API keys are never persisted or returned by the API.
create table drive_api_key_slots (
  slot smallint primary key check (slot between 1 and 5),
  project_id text not null check (length(project_id) between 1 and 100),
  encrypted_key text not null,
  enabled boolean not null default true,
  is_active boolean not null default false,
  last_checked_at timestamptz,
  last_check_status text check (last_check_status in ('HEALTHY', 'RATE_LIMITED', 'FAILED')),
  last_check_reason text,
  cooldown_until timestamptz,
  rate_limit_count integer not null default 0 check (rate_limit_count >= 0),
  updated_at timestamptz not null default now()
);

create index drive_api_key_slots_project_cooldown_idx
  on drive_api_key_slots (project_id, cooldown_until)
  where enabled;

create unique index drive_api_key_slots_one_active_idx
  on drive_api_key_slots (is_active)
  where is_active;
