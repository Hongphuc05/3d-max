-- Reuse catalog identities and category/model tables; retain historical Drive rows.
alter table catalog_folders add column depth integer not null default 1;
alter table catalog_models alter column archive_file_id drop not null;
alter table catalog_models alter column archive_extension drop not null;
alter table catalog_models add column basename text;
alter table catalog_models add column model_status text not null default 'ready'
  check(model_status in ('ready','missing_preview','missing_archive','conflict'));
create unique index catalog_r2_model_identity_idx on catalog_models(provider,root_folder_id,folder_id,basename)
  where provider='r2';
create unique index catalog_r2_category_path_idx on catalog_folders(provider,root_folder_id,folder_path)
  where provider='r2';

create table r2_objects (
  bucket text not null,
  object_key text not null,
  category_path text not null,
  object_type text not null check(object_type in ('marker','preview','archive','other')),
  size bigint not null check(size>=0),
  etag text,
  last_modified timestamptz,
  availability text not null default 'active' check(availability in ('active','removed')),
  updated_at timestamptz not null default now(),
  primary key(bucket,object_key)
);
create index r2_objects_category_idx on r2_objects(bucket,category_path) where availability='active';

create table r2_event_inbox (
  id text primary key,
  bucket text not null,
  root_prefix text not null,
  object_key text not null,
  payload jsonb not null,
  status text not null default 'pending' check(status in ('pending','processed','dead')),
  attempts integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  last_error text,
  received_at timestamptz not null default now(),
  processed_at timestamptz
);
create index r2_event_pending_idx on r2_event_inbox(bucket,root_prefix,next_attempt_at) where status='pending';
