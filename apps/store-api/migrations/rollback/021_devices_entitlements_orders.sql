-- MANUAL ONLY. Refuses while any entitlement or any CONFIRMED order exists: dropping them would erase what customers bought.
begin;
do $$ begin
  if exists(select 1 from entitlements) or exists(select 1 from purchase_orders where status = 'CONFIRMED') then
    raise exception 'Rollback refused: entitlements or confirmed orders exist.';
  end if;
end $$;
drop table entitlements;
drop table purchase_order_items;
drop table purchase_orders;
drop table device_tokens;
drop table device_auth_challenges;
drop table devices;
drop function protect_device_identity();
delete from schema_migrations where name = '021_devices_entitlements_orders.sql';
commit;
