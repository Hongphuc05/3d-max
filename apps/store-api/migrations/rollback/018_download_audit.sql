-- MANUAL ONLY. Refuses once audit events exist: the audit trail must not be dropped.
begin;
do $$ begin
  if exists(select 1 from audit_events) then
    raise exception 'Rollback refused: audit events exist.';
  end if;
end $$;
drop table audit_events;
delete from schema_migrations where name='018_download_audit.sql';
commit;
