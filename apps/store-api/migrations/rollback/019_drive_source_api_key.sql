-- MANUAL ONLY. Refuses while any API-key source exists: restoring NOT NULL on connection_id would orphan it,
-- and deleting the source would cascade to its jobs, inventory and model files.
begin;
do $$ begin
  if exists(select 1 from drive_sources where access_mode = 'API_KEY') then
    raise exception 'Rollback refused: API-key sources exist.';
  end if;
end $$;
drop index drive_sources_api_key_root_idx;
alter table drive_sources drop constraint drive_sources_access_mode_connection_chk;
alter table drive_sources drop column access_mode;
alter table drive_sources alter column connection_id set not null;
delete from schema_migrations where name='019_drive_source_api_key.sql';
commit;
