-- First accepted MXL1 is permanently bound to one registered device and machine label.
-- Existing entitlements remain intact, including any historical conflicts.
create table mxl1_bindings (
  license_id text primary key check (license_id ~ '^[A-Za-z0-9_-]{1,80}$'),
  device_id uuid not null unique references devices(id) on delete restrict,
  machine_code text not null unique check (machine_code ~ '^MAX-[A-F0-9]{64}$'),
  created_at timestamptz not null default now()
);
