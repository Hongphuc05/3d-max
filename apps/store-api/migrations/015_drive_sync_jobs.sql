-- v3 P2: durable job queue (PostgreSQL is the queue, no Redis) + latest Drive snapshot.
-- Drive file ids live here and in model_files only; they never reach customer-facing responses.
create table drive_sync_jobs (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references drive_sources(id) on delete cascade,
  mode text not null check (mode in ('FULL','INCREMENTAL')),
  status text not null check (status in ('QUEUED','RUNNING','CANCELLING','CANCELLED','COMPLETED','COMPLETED_WITH_ERRORS','FAILED')),
  stage text check (stage in ('SCANNING','COMPARING','DOWNLOADING_PREVIEWS','PUBLISHING')),
  scanned_folders integer not null default 0 check (scanned_folders >= 0),
  scanned_files integer not null default 0 check (scanned_files >= 0),
  new_count integer not null default 0 check (new_count >= 0),
  updated_count integer not null default 0 check (updated_count >= 0),
  unchanged_count integer not null default 0 check (unchanged_count >= 0),
  missing_count integer not null default 0 check (missing_count >= 0),
  review_count integer not null default 0 check (review_count >= 0),
  skipped_count integer not null default 0 check (skipped_count >= 0),
  error_count integer not null default 0 check (error_count >= 0),
  bytes_downloaded bigint not null default 0 check (bytes_downloaded >= 0),
  checkpoint jsonb not null default '{}'::jsonb,
  lease_owner text,
  lease_expires_at timestamptz,
  heartbeat_at timestamptz,
  cancel_requested boolean not null default false,
  attempt integer not null default 0 check (attempt >= 0),
  requested_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz,
  -- Classification only. Provider text can echo credentials, so it is never stored here.
  error_code text check (error_code ~ '^[A-Z][A-Z0-9_]{1,60}$'),
  error_message text check (error_message is null or length(error_message) <= 500)
);
-- Two admins pressing "sync" at once: the second insert fails and the API answers SYNC_ALREADY_RUNNING.
create unique index drive_sync_jobs_one_active_idx on drive_sync_jobs (source_id) where status in ('QUEUED','RUNNING','CANCELLING');
create index drive_sync_jobs_claim_idx on drive_sync_jobs (status, lease_expires_at);
create index drive_sync_jobs_history_idx on drive_sync_jobs (created_at desc, id);

create table drive_sync_job_items (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references drive_sync_jobs(id) on delete cascade,
  drive_file_id text not null,
  action text not null check (action in ('SCAN','PREVIEW','PUBLISH','REVIEW')),
  status text not null check (status in ('PENDING','DONE','FAILED','SKIPPED')),
  retry_count integer not null default 0 check (retry_count >= 0),
  error_code text check (error_code ~ '^[A-Z][A-Z0-9_]{1,60}$'),
  error_message text check (error_message is null or length(error_message) <= 500),
  unique (job_id, drive_file_id, action)
);

create table drive_inventory (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references drive_sources(id) on delete cascade,
  drive_file_id text not null,
  parent_drive_id text,
  path text not null,
  filename text not null,
  mime_type text not null,
  is_folder boolean not null default false,
  is_shortcut boolean not null default false,
  shortcut_target_id text,
  size_bytes bigint check (size_bytes is null or size_bytes >= 0),
  modified_time timestamptz,
  md5_checksum text check (md5_checksum is null or md5_checksum ~ '^[0-9a-f]{32}$'),
  resource_key text,
  can_download boolean,
  -- Only meaningful once that job finished SCANNING; missing detection must ignore partial scans.
  last_seen_job_id uuid references drive_sync_jobs(id) on delete set null,
  unique (source_id, drive_file_id)
);
create index drive_inventory_parent_idx on drive_inventory (source_id, parent_drive_id);
