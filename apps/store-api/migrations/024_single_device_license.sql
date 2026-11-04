-- Preserve historical bindings. Enforce one device per license and one license
-- per device identity only for new bindings, including concurrent inserts.
create function enforce_new_license_device_binding() returns trigger language plpgsql as $$
declare lock_key text;
begin
  for lock_key in select x from unnest(array[
    '3dm-license:' || NEW.license_id::text,
    '3dm-device:' || NEW.device_id::text,
    '3dm-device-key:' || encode(NEW.public_key_hash, 'hex')
  ]) as keys(x) order by x loop
    perform pg_advisory_xact_lock(hashtextextended(lock_key, 0));
  end loop;
  if exists (select 1 from license_devices where device_id = NEW.device_id or public_key_hash = NEW.public_key_hash) then
    raise exception 'DEVICE_IDENTITY_ALREADY_BOUND' using errcode = '23514', constraint = 'single_device_identity';
  end if;
  if exists (select 1 from license_devices where license_id = NEW.license_id) then
    raise exception 'DEVICE_LIMIT_REACHED' using errcode = '23514', constraint = 'single_device_per_license';
  end if;
  return NEW;
end $$;
create trigger enforce_new_license_device_binding before insert on license_devices
for each row execute function enforce_new_license_device_binding();
