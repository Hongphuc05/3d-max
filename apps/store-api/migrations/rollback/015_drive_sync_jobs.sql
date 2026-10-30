-- MANUAL ONLY. Refuses once any sync job exists: job history and the inventory snapshot would be lost.
-- Roll back 018 and 016 first (016 references drive_sync_jobs).
begin;
do $$ begin
  if exists(select 1 from drive_sync_jobs) or exists(select 1 from drive_inventory) or exists(select 1 from drive_sync_job_items) then
    raise exception 'Rollback refused: sync jobs or inventory exist.';
  end if;
end $$;
drop table drive_sync_job_items;
drop table drive_inventory;
drop table drive_sync_jobs;
delete from schema_migrations where name='015_drive_sync_jobs.sql';
commit;
