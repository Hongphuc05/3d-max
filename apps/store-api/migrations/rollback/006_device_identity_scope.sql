-- Manual maintenance only. Refuses if reverting would invalidate legitimate bindings.
begin;
do $$ begin
  if exists(select device_id from license_devices group by device_id having count(*)>1)
    or exists(select public_key_hash from license_devices group by public_key_hash having count(*)>1) then
    raise exception 'Rollback refused: device identities are shared across independently owned licenses.';
  end if;
end $$;
alter table license_devices drop constraint license_devices_license_identity_key;
alter table license_devices drop constraint license_devices_license_public_key_key;
alter table license_devices add constraint license_devices_device_id_key unique(device_id);
alter table license_devices add constraint license_devices_public_key_hash_key unique(public_key_hash);
delete from schema_migrations where name='006_device_identity_scope.sql';
commit;
