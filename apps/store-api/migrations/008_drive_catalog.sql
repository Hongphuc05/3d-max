-- Independent catalog tables: no changes to accounts, licenses, payments or tickets.
create table catalog_sources (
  provider text not null,
  root_folder_id text not null,
  catalog_version bigint not null default 0,
  snapshot_hash text,
  last_successful_sync timestamptz,
  last_sync_started_at timestamptz,
  last_error text,
  sync_report jsonb,
  updated_at timestamptz not null default now(),
  primary key (provider, root_folder_id)
);

create table catalog_sync_runs (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  root_folder_id text not null,
  status text not null check (status in ('running','succeeded','failed')),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  duration_ms bigint,
  report jsonb,
  error_code text
);
create index catalog_sync_runs_source_idx on catalog_sync_runs(provider,root_folder_id,started_at desc);

create table catalog_folders (
  provider text not null,
  root_folder_id text not null,
  folder_id text not null,
  parent_folder_id text,
  name text not null,
  folder_path text not null,
  resource_key text,
  status text not null default 'active' check (status in ('active','removed')),
  last_seen_sync_id uuid not null references catalog_sync_runs(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key(provider,root_folder_id,folder_id)
);

create table catalog_models (
  id text primary key check (id ~ '^[a-f0-9]{12}$'),
  provider text not null,
  root_folder_id text not null,
  folder_id text not null,
  archive_file_id text not null,
  name text not null,
  archive_extension text not null check (archive_extension in ('.zip','.rar','.7z')),
  file_size bigint check (file_size >= 0),
  modified_time timestamptz,
  checksum text,
  resource_key text,
  can_download boolean not null,
  preview_file_id text,
  preview_metadata jsonb,
  cached_preview_path text,
  preview_version text,
  content_hash text not null,
  status text not null default 'active' check (status in ('active','removed')),
  last_seen_sync_id uuid not null references catalog_sync_runs(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(provider,root_folder_id,archive_file_id)
);
create index catalog_models_active_idx on catalog_models(provider,root_folder_id,status);
