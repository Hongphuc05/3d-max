-- A3: tai khoan + phien dang nhap
create table users (
  id            uuid primary key default gen_random_uuid(),
  email         text not null unique check (email = lower(email)),
  password_hash text not null,
  created_at    timestamptz not null default now()
);

-- id = sha256 cua token trong cookie: lo DB khong lo duoc phien dang dang nhap
create table sessions (
  id         bytea primary key,
  user_id    uuid not null references users(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  user_agent text
);
create index sessions_user_id_idx on sessions (user_id);
create index sessions_expires_at_idx on sessions (expires_at);
