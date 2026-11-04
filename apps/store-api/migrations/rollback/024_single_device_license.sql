-- Manual rollback restores the earlier activation policy without deleting bindings.
begin;
drop trigger enforce_new_license_device_binding on license_devices;
drop function enforce_new_license_device_binding();
delete from schema_migrations where name = '024_single_device_license.sql';
commit;
