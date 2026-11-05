-- Keep immutable per-job archive metadata for FULL-scan preview reconciliation.
-- drive_inventory is updated while a scan runs, so it cannot safely represent an older completed scan.
create index drive_sync_jobs_latest_full_idx on drive_sync_jobs (source_id, finished_at desc, id desc)
  where mode = 'FULL' and status = 'COMPLETED' and error_count = 0;

create table drive_archive_snapshot_runs (
  job_id uuid primary key references drive_sync_jobs(id) on delete cascade,
  source_id uuid not null references drive_sources(id) on delete cascade,
  archive_count integer not null check (archive_count >= 0),
  captured_at timestamptz not null default now()
);
create index drive_archive_snapshot_source_idx on drive_archive_snapshot_runs (source_id, captured_at desc);

create table drive_archive_snapshot_files (
  job_id uuid not null references drive_archive_snapshot_runs(job_id) on delete cascade,
  drive_file_id text not null,
  path text not null,
  filename text not null,
  size_bytes bigint check (size_bytes is null or size_bytes >= 0),
  md5_checksum text check (md5_checksum is null or md5_checksum ~ '^[0-9a-f]{32}$'),
  file_type text not null check (file_type in ('zip','rar','7z')),
  primary key (job_id, drive_file_id)
);
-- Backfill only when no later scan has touched this source's inventory. Otherwise require one clean FULL scan
-- to establish an immutable baseline instead of guessing from a partial scan.
with candidates as (
  select distinct on (j.source_id) j.id, j.source_id, j.finished_at
    from drive_sync_jobs j
   where j.mode = 'FULL' and j.status = 'COMPLETED' and j.error_count = 0
     and j.checkpoint #>> '{scan,done}' = 'true'
     and not exists (
       select 1 from drive_inventory i
       join drive_sync_jobs touched on touched.id = i.last_seen_job_id
        where i.source_id = j.source_id and touched.id <> j.id and touched.created_at > j.finished_at
     )
   order by j.source_id, j.finished_at desc
), inserted_runs as (
  insert into drive_archive_snapshot_runs (job_id, source_id, archive_count, captured_at)
  select c.id, c.source_id, count(i.drive_file_id)::int, c.finished_at
    from candidates c
    left join drive_inventory i on i.source_id = c.source_id and i.last_seen_job_id = c.id
      and not i.is_folder and not i.is_shortcut
      and (right(lower(i.filename), 4) in ('.zip', '.rar') or right(lower(i.filename), 3) = '.7z')
   group by c.id, c.source_id, c.finished_at
  returning job_id, source_id
)
insert into drive_archive_snapshot_files (job_id, drive_file_id, path, filename, size_bytes, md5_checksum, file_type)
select r.job_id, i.drive_file_id, i.path, i.filename, i.size_bytes, i.md5_checksum,
       case when right(lower(i.filename), 4) = '.zip' then 'zip'
            when right(lower(i.filename), 4) = '.rar' then 'rar' else '7z' end
  from inserted_runs r
  join drive_inventory i on i.source_id = r.source_id and i.last_seen_job_id = r.job_id
 where not i.is_folder and not i.is_shortcut
   and (right(lower(i.filename), 4) in ('.zip', '.rar') or right(lower(i.filename), 3) = '.7z');
