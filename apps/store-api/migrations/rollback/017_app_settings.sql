-- MANUAL ONLY. Refuses once the admin saved settings (bank details and prices would be lost).
begin;
do $$ begin
  if exists(select 1 from app_settings) then
    raise exception 'Rollback refused: app_settings has saved settings.';
  end if;
end $$;
drop table app_settings;
delete from schema_migrations where name='017_app_settings.sql';
commit;
