-- v3 P4.2 (v3-database.md §3.5): phien tai model + nhat ky tai.
-- LECH SO VOI PLAN: plan ghi 018, nhung 018 da dung cho audit_events (khong co 2 bang nay vi chung phu thuoc devices/entitlements cua 021).

-- Token tra cho plugin la chuoi ngau nhien; DB chi giu sha256. Dung mot lan, ben o 5 phut de BAT DAU.
create table model_download_sessions (
  id uuid primary key default gen_random_uuid(),
  token_hash bytea not null unique check (octet_length(token_hash) = 32),
  model_id uuid not null references models(id) on delete restrict,
  device_id uuid not null references devices(id) on delete cascade,
  entitlement_id uuid references entitlements(id) on delete set null,   -- quyen bi xoa thi giu phien de doi soat
  status text not null default 'CREATED' check (status in ('CREATED', 'STREAMING', 'COMPLETED', 'FAILED', 'EXPIRED')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  started_at timestamptz,
  finished_at timestamptz,
  check (expires_at <= created_at + interval '5 minutes'),
  check (status not in ('STREAMING', 'COMPLETED') or started_at is not null),
  check (status not in ('COMPLETED', 'FAILED') or finished_at is not null)
);
create index model_download_sessions_device_idx on model_download_sessions (device_id, created_at);
create index model_download_sessions_expiry_idx on model_download_sessions (expires_at) where status = 'CREATED';

create table model_download_logs (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references model_download_sessions(id) on delete cascade,
  model_id uuid not null references models(id) on delete restrict,
  device_id uuid not null references devices(id) on delete cascade,
  bytes_sent bigint not null default 0 check (bytes_sent >= 0),
  status text not null check (status in ('COMPLETED', 'FAILED')),
  error_code text check (error_code is null or error_code ~ '^[A-Z][A-Z0-9_]{1,60}$'),   -- chi ma phan loai, khong luu loi tho cua Google
  created_at timestamptz not null default now()
);
create index model_download_logs_device_idx on model_download_logs (device_id, created_at);   -- gioi han toc do theo thiet bi
