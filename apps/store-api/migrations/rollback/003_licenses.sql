-- MANUAL ONLY. Backup first. Refuses rollback if any licenses have been issued;
-- permanent bindings must never be erased as an application reset mechanism.
-- Roll back 005_licensed_import_tickets, then 004_payments first.
begin;
do $$ begin
  if exists (select 1 from licenses) then
    raise exception 'Rollback refused: issued licenses exist. Restore a reviewed backup instead.';
  end if;
end $$;
drop table license_rate_limits;
drop table license_audit_logs;
drop table device_sessions;
drop table device_challenges;
drop table license_devices;
drop function protect_license_device_binding();
drop table licenses;
drop function protect_license_identity();
delete from schema_migrations where name = '003_licenses.sql';
commit;
