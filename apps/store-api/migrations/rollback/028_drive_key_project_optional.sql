-- MANUAL ONLY. Restore the old schema only if every saved key still has a project id.
begin;
do $$ begin
  if exists(select 1 from drive_api_key_slots where project_id is null) then
    raise exception 'Rollback refused: one or more Drive key slots have no project id.';
  end if;
end $$;
drop index drive_api_key_slots_enabled_cooldown_idx;
alter table drive_api_key_slots alter column project_id set not null;
create index drive_api_key_slots_project_cooldown_idx
  on drive_api_key_slots (project_id, cooldown_until)
  where enabled;
delete from schema_migrations where name='028_drive_key_project_optional.sql';
commit;
