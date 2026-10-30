-- v3 P2: published catalog. models.id is the only public model id (never a Drive id).
create table categories (
  id uuid primary key default gen_random_uuid(),
  parent_id uuid references categories(id) on delete restrict,
  name text not null check (length(name) between 1 and 200),
  slug text not null check (length(slug) between 1 and 300),
  full_path text not null unique check (length(full_path) between 1 and 1000),
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index categories_parent_idx on categories (parent_id);

create table models (
  id uuid primary key default gen_random_uuid(),
  legacy_id text unique,
  category_id uuid not null references categories(id) on delete restrict,
  name text not null check (length(name) between 1 and 300),
  status text not null check (status in ('DRAFT','PUBLISHED','NEEDS_REVIEW','HIDDEN')),
  price_vnd integer not null check (price_vnd >= 0),
  -- An admin edit wins over later Drive syncs.
  name_overridden boolean not null default false,
  price_overridden boolean not null default false,
  primary_file_id uuid,
  missing_scans integer not null default 0 check (missing_scans >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  published_at timestamptz
);
create index models_status_category_idx on models (status, category_id);

create table model_files (
  id uuid primary key default gen_random_uuid(),
  model_id uuid not null references models(id) on delete cascade,
  source_id uuid not null references drive_sources(id) on delete cascade,
  drive_file_id text not null,
  filename text not null,
  file_type text not null check (file_type in ('zip','rar','7z','max','fbx','obj')),
  size_bytes bigint check (size_bytes is null or size_bytes >= 0),
  md5_checksum text check (md5_checksum is null or md5_checksum ~ '^[0-9a-f]{32}$'),
  -- Drive gives no sha256: filled in while streaming the first download (P4).
  sha256 text check (sha256 is null or sha256 ~ '^[0-9a-f]{64}$'),
  entry_file text,
  can_download boolean,
  download_status text not null default 'OK' check (download_status in ('OK','RESTRICTED','MISSING','ERROR')),
  unique (source_id, drive_file_id)
);
create index model_files_model_idx on model_files (model_id);

-- Circular reference (models <-> model_files): deferred so both rows can be written in one transaction.
alter table models add constraint models_primary_file_fk
  foreign key (primary_file_id) references model_files(id) on delete set null deferrable initially deferred;

create table model_previews (
  id uuid primary key default gen_random_uuid(),
  model_id uuid not null references models(id) on delete cascade,
  source text not null check (source in ('DRIVE_IMAGE','ARCHIVE_ENTRY')),
  source_drive_file_id text,
  source_md5 text check (source_md5 is null or source_md5 ~ '^[0-9a-f]{32}$'),
  local_path text not null unique check (length(local_path) between 1 and 300),
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  file_size integer not null check (file_size > 0),
  width integer not null check (width > 0),
  height integer not null check (height > 0),
  variant text not null check (variant in ('sm','lg')),
  version integer not null default 1 check (version >= 1),
  is_primary boolean not null default false
);
create unique index model_previews_primary_idx on model_previews (model_id, variant) where is_primary;
create index model_previews_model_idx on model_previews (model_id);

create table review_items (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references drive_sources(id) on delete cascade,
  kind text not null check (kind in ('AMBIGUOUS_PAIR','ORPHAN_IMAGE','ORPHAN_MODEL','SUGGESTED_PAIR','REMAP_CANDIDATE','PREVIEW_IN_ARCHIVE')),
  -- Names and relative paths only; Drive ids stay in the inventory.
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'OPEN' check (status in ('OPEN','RESOLVED','DISMISSED')),
  model_id uuid references models(id) on delete set null,
  resolved_by uuid references users(id) on delete set null,
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);
create index review_items_open_idx on review_items (status, kind);

create table catalog_state (
  id smallint primary key check (id = 1),
  active_version bigint not null default 0 check (active_version >= 0),
  manifest_checksum text check (manifest_checksum is null or manifest_checksum ~ '^[0-9a-f]{64}$'),
  published_at timestamptz,
  published_by_job uuid references drive_sync_jobs(id) on delete set null
);
insert into catalog_state (id) values (1);
