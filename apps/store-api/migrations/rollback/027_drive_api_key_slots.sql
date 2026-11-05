-- MANUAL ONLY. Refuses while any encrypted Drive key is configured.
begin;
do $$ begin
  if exists(select 1 from drive_api_key_slots) then
    raise exception 'Rollback refused: drive_api_key_slots contains configured credentials.';
  end if;
end $$;
drop table drive_api_key_slots;
delete from schema_migrations where name='027_drive_api_key_slots.sql';
commit;
