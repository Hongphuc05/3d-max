-- D28.1/D28.2/D28.5: don hang = license CA THU VIEN (entitlement, source ORDER), mot gia duy nhat trong app_settings.
-- "1 license = 1 may": mot quyen dang hieu luc cho moi thiet bi (entitlements_active_idx); chuyen may = thu hoi + cap moi.
-- Don dep: gia tung model, quyen tung model, MXL1, bang don hang theo item, OAuth Drive va cac vat the sot lai tu migration 003-010.
do $$ begin
  if exists(select 1 from entitlements where scope = 'MODEL' or source = 'MXL1') then
    raise exception 'Migration 024 refused: per-model or MXL1 entitlements exist; resolve them first (D28.1).';
  end if;
end $$;

-- entitlements: chi con quyen ca thu vien.
do $$ declare c text; begin
  for c in select conname from pg_constraint where conrelid = 'entitlements'::regclass and contype = 'c' loop
    execute format('alter table entitlements drop constraint %I', c);
  end loop;
end $$;
drop index if exists entitlements_model_active_idx, entitlements_all_active_idx, entitlements_mxl1_idx;
alter table entitlements drop column scope, drop column model_id, drop column mxl1_license_id;
alter table entitlements add constraint entitlements_source_check check (source in ('ORDER', 'ADMIN'));
create unique index entitlements_active_idx on entitlements (device_id) where revoked_at is null;

drop table purchase_order_items;

-- gia: mot gia thu vien
alter table app_settings add column library_price_vnd integer not null default 500000 check (library_price_vnd >= 0);
alter table app_settings drop column default_model_price_vnd;
alter table models drop column price_vnd, drop column price_overridden;

-- OAuth Drive da bo (D26/D28.5)
drop table oauth_states;
alter table drive_sources drop constraint drive_sources_access_mode_connection_chk;
alter table drive_sources drop column connection_id;
drop table drive_connections;

-- vat the sot lai tu license MXL1 / payOS
drop function if exists protect_license_device_binding() cascade;
drop function if exists protect_license_identity() cascade;
drop sequence if exists payment_order_code_seq;
