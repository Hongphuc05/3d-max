-- v3 P3.7 (v3-database.md §3.4, phan app_settings): cai dat trang admin (D25). Theo thoa thuan voi chu du an, 017 CHI co app_settings;
-- 6 bang cua P4/P5 (devices, device_challenges, device_tokens, entitlements, orders, order_items) di cung migration sau (so >= 021, vi 018-020 da dung).
-- Mot dong duy nhat. KHONG co dong nao cho toi khi admin luu lan dau: chua co dong thi worker dung bien moi truong DEFAULT_MODEL_PRICE_VND.
-- Dinh dang (BIN 6 so, so tai khoan...) do API kiem; DB chi giu khoang so de doi dinh dang khong can migration.
create table app_settings (
  id smallint primary key default 1 check (id = 1),
  bank_name text,
  bank_bin text,
  account_no text,
  account_name text,
  default_model_price_vnd integer not null default 15000 check (default_model_price_vnd >= 0),
  order_ttl_minutes integer not null default 1440 check (order_ttl_minutes > 0),
  max_pending_orders_per_device integer not null default 3 check (max_pending_orders_per_device > 0),
  updated_by uuid references users(id) on delete set null,
  updated_at timestamptz not null default now()
);
