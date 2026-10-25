-- Lifetime keys and permanent device bindings. Application role must not own schema
-- or have TRUNCATE/DDL rights in production; superusers can bypass any trigger.
create table licenses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references users(id),
  order_id uuid,
  key_hash bytea not null unique check (octet_length(key_hash) = 32),
  key_ciphertext bytea not null,
  key_iv bytea not null check (octet_length(key_iv) = 12),
  key_auth_tag bytea not null check (octet_length(key_auth_tag) = 16),
  key_last4 text not null check (key_last4 ~ '^[A-F0-9]{4}$'),
  license_type text not null default 'LIFETIME' check (license_type = 'LIFETIME'),
  status text not null default 'ACTIVE' check (status in ('ACTIVE','SUSPENDED','REVOKED')),
  issued_at timestamptz not null default now(),
  revoked_at timestamptz,
  check ((status = 'REVOKED') = (revoked_at is not null))
);

create table license_devices (
  id uuid primary key default gen_random_uuid(),
  license_id uuid not null references licenses(id),
  slot_number smallint not null check (slot_number in (1,2)),
  device_id uuid not null unique,
  device_public_key text not null,
  public_key_hash bytea not null unique check (octet_length(public_key_hash) = 32),
  device_name text not null check (length(device_name) between 1 and 120),
  -- Reported by native client; no TPM attestation is claimed by the server.
  key_protection text not null check (key_protection in ('TPM','SOFTWARE')),
  activated_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  unique (license_id, slot_number)
);

create function protect_license_device_binding() returns trigger language plpgsql as $$
begin
  if TG_OP = 'DELETE' then raise exception 'DEVICE_BINDING_IMMUTABLE' using errcode = '23514'; end if;
  if (to_jsonb(NEW) - 'last_seen_at') is distinct from (to_jsonb(OLD) - 'last_seen_at') then
    raise exception 'DEVICE_BINDING_IMMUTABLE' using errcode = '23514';
  end if;
  return NEW;
end $$;
create trigger license_devices_immutable before update or delete on license_devices
for each row execute function protect_license_device_binding();

create function protect_license_identity() returns trigger language plpgsql as $$
begin
  if TG_OP = 'DELETE' then raise exception 'LICENSE_IDENTITY_IMMUTABLE' using errcode = '23514'; end if;
  if (to_jsonb(NEW) - 'status' - 'revoked_at') is distinct from (to_jsonb(OLD) - 'status' - 'revoked_at') then
    raise exception 'LICENSE_IDENTITY_IMMUTABLE' using errcode = '23514';
  end if;
  if OLD.status = 'REVOKED' and NEW.status <> 'REVOKED' then
    raise exception 'LICENSE_REVOCATION_PERMANENT' using errcode = '23514';
  end if;
  return NEW;
end $$;
create trigger licenses_immutable before update or delete on licenses
for each row execute function protect_license_identity();

create table device_challenges (
  id uuid primary key,
  user_id uuid not null references users(id),
  auth_session_id bytea not null references sessions(id) on delete cascade,
  device_id uuid not null,
  purpose text not null check (purpose in ('ACTIVATE','VERIFY')),
  device_public_key text not null,
  public_key_hash bytea not null check (octet_length(public_key_hash) = 32),
  device_name text not null,
  key_protection text not null check (key_protection in ('TPM','SOFTWARE')),
  message text not null,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);
create index device_challenges_expiry_idx on device_challenges(expires_at);

create table device_sessions (
  id bytea primary key check (octet_length(id) = 32),
  auth_session_id bytea not null references sessions(id) on delete cascade,
  user_id uuid not null references users(id),
  license_id uuid not null references licenses(id),
  device_id uuid not null references license_devices(id),
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  unique (auth_session_id, device_id)
);
create index device_sessions_expiry_idx on device_sessions(expires_at);

create table license_audit_logs (
  id bigint generated always as identity primary key,
  actor_user_id uuid references users(id),
  license_id uuid references licenses(id),
  event_type text not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index license_audit_created_idx on license_audit_logs(created_at);

create table license_rate_limits (
  bucket text primary key,
  hits integer not null,
  expires_at timestamptz not null
);
create index license_rate_limits_expiry_idx on license_rate_limits(expires_at);
