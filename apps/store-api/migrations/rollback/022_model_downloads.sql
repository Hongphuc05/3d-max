-- MANUAL ONLY. Refuses while any download log exists: it is the record of what was delivered to whom.
begin;
do $$ begin
  if exists(select 1 from model_download_logs) then
    raise exception 'Rollback refused: download logs exist.';
  end if;
end $$;
drop table model_download_logs;
drop table model_download_sessions;
delete from schema_migrations where name = '022_model_downloads.sql';
commit;
