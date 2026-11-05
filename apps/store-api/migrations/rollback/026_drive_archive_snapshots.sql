drop table if exists drive_archive_snapshot_files;
drop table if exists drive_archive_snapshot_runs;
drop index if exists drive_sync_jobs_latest_full_idx;
delete from schema_migrations where name = '026_drive_archive_snapshots.sql';
