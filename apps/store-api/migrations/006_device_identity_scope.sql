-- The entitlement boundary is a license. A Windows identity may legitimately use
-- two separately purchased accounts; it cannot occupy two slots of the SAME license.
alter table license_devices drop constraint license_devices_device_id_key;
alter table license_devices drop constraint license_devices_public_key_hash_key;
alter table license_devices add constraint license_devices_license_identity_key unique(license_id,device_id);
alter table license_devices add constraint license_devices_license_public_key_key unique(license_id,public_key_hash);
