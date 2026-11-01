-- v3 P4.1 (v3-database.md §3.4): thiet bi, thu thach, token, quyen, don hang.
-- LECH TEN SO VOI PLAN (da duoc chu du an duyet): 2 bang cua plan trung ten bang cu con dung (004 `orders`, 003 `device_challenges`)
-- nen dung ten khac: device_challenges -> device_auth_challenges, orders -> purchase_orders, order_items -> purchase_order_items.
-- Doi ve ten cua plan bang mot migration nho sau khi don bang cu. (017 chi giu app_settings nen so nay la 021.)
-- Bang don hang duoc tao tu bay gio du P5 moi dung: entitlements.order_id tham chieu no.

create table devices (
  id uuid primary key default gen_random_uuid(),
  device_uuid uuid not null unique,
  public_key text not null,                                   -- JWK RSA (JSON)
  public_key_hash bytea not null unique check (octet_length(public_key_hash) = 32),
  key_protection text not null check (key_protection in ('TPM', 'SOFTWARE')),   -- client tu bao, khong co attestation
  machine_code text not null check (machine_code ~ '^MAX-[A-F0-9]{64}$'),       -- NHAN, khong phai bang chung; khong duy nhat
  device_name text not null check (length(device_name) between 1 and 120),
  status text not null default 'ACTIVE' check (status in ('ACTIVE', 'BLOCKED')),
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);
create index devices_machine_code_idx on devices (machine_code);

-- Danh tinh (uuid, khoa, bam khoa) khong bao gio doi; ten, nhan may, trang thai, last_seen thi duoc.
create function protect_device_identity() returns trigger language plpgsql as $$
begin
  if new.device_uuid is distinct from old.device_uuid or new.public_key is distinct from old.public_key
     or new.public_key_hash is distinct from old.public_key_hash then
    raise exception 'device identity is immutable';
  end if;
  return new;
end $$;
create trigger devices_identity_immutable before update on devices for each row execute function protect_device_identity();

-- Thu thach dung mot lan, song toi da 2 phut. Thiet bi chi duoc DANG KY sau khi ky dung (khong tao hang devices luc xin thu thach).
create table device_auth_challenges (
  id uuid primary key,
  device_uuid uuid not null,
  public_key text not null,
  public_key_hash bytea not null check (octet_length(public_key_hash) = 32),
  key_protection text not null check (key_protection in ('TPM', 'SOFTWARE')),
  machine_code text not null check (machine_code ~ '^MAX-[A-F0-9]{64}$'),
  device_name text not null check (length(device_name) between 1 and 120),
  message text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  check (expires_at <= created_at + interval '2 minutes')
);
create index device_auth_challenges_expiry_idx on device_auth_challenges (expires_at);

-- Token thiet bi: DB chi giu sha256; song toi da 15 phut.
create table device_tokens (
  id bytea primary key check (octet_length(id) = 32),
  device_id uuid not null references devices(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  check (expires_at <= created_at + interval '15 minutes')
);
create index device_tokens_device_idx on device_tokens (device_id);

create table purchase_orders (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (length(code) between 4 and 32),
  device_id uuid not null references devices(id) on delete restrict,
  amount_vnd integer not null check (amount_vnd >= 0),
  status text not null default 'PENDING_PAYMENT' check (status in ('PENDING_PAYMENT', 'AWAITING_OWNER', 'CONFIRMED', 'REJECTED', 'EXPIRED', 'CANCELLED')),
  telegram_chat_id bigint,
  telegram_message_id bigint,
  claimed_paid_at timestamptz,
  decided_at timestamptz,
  expires_at timestamptz not null,
  decided_by_telegram_user bigint,
  bank_snapshot jsonb not null,                               -- thong tin ngan hang tai thoi diem tao don
  created_at timestamptz not null default now()
);
create index purchase_orders_device_status_idx on purchase_orders (device_id, status);

create table purchase_order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references purchase_orders(id) on delete cascade,
  model_id uuid not null references models(id) on delete restrict,
  price_vnd integer not null check (price_vnd >= 0),          -- gia chup luc tao don
  unique (order_id, model_id)
);

create table entitlements (
  id uuid primary key default gen_random_uuid(),
  device_id uuid not null references devices(id) on delete cascade,
  scope text not null check (scope in ('MODEL', 'ALL_MODELS')),
  model_id uuid references models(id) on delete restrict,     -- model da ban thi khong xoa duoc
  source text not null check (source in ('ORDER', 'ADMIN', 'MXL1')),
  order_id uuid references purchase_orders(id) on delete set null,
  mxl1_license_id text,
  granted_by uuid references users(id) on delete set null,
  granted_at timestamptz not null default now(),
  revoked_at timestamptz,
  check ((scope = 'MODEL') = (model_id is not null)),
  check (scope = 'MODEL' or source in ('MXL1', 'ADMIN'))      -- ban chi tao quyen tung model (D18)
);
create unique index entitlements_model_active_idx on entitlements (device_id, model_id) where scope = 'MODEL' and revoked_at is null;
create unique index entitlements_all_active_idx on entitlements (device_id) where scope = 'ALL_MODELS' and revoked_at is null;
create index entitlements_mxl1_idx on entitlements (mxl1_license_id) where mxl1_license_id is not null;
