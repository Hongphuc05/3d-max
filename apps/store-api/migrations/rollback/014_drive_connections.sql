-- MANUAL ONLY. Refuses once a Drive connection exists: deleting it destroys the encrypted refresh token
-- and every source bound to it. Use a reviewed forward migration instead.
begin;
do $$ begin
  if exists(select 1 from drive_connections) or exists(select 1 from drive_sources) then
    raise exception 'Rollback refused: Drive connections or sources exist.';
  end if;
end $$;
drop table oauth_states;
drop table drive_sources;
drop table drive_connections;
delete from schema_migrations where name='014_drive_connections.sql';
commit;
