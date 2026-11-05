-- Link Telegram identities to existing admin accounts after explicit Telegram Login consent.
create table telegram_admin_accounts (
  id uuid primary key default gen_random_uuid(),
  admin_user_id uuid not null references users(id) on delete cascade,
  telegram_subject text not null check (length(telegram_subject) between 1 and 128),
  telegram_user_id bigint not null check (telegram_user_id > 0),
  telegram_username text check (telegram_username is null or length(telegram_username) between 1 and 64),
  display_name text not null check (length(display_name) between 1 and 128),
  linked_at timestamptz not null default now(),
  last_notified_at timestamptz,
  revoked_at timestamptz
);
create unique index telegram_admin_accounts_user_active_idx
  on telegram_admin_accounts (telegram_user_id) where revoked_at is null;
create unique index telegram_admin_accounts_subject_active_idx
  on telegram_admin_accounts (telegram_subject) where revoked_at is null;
create index telegram_admin_accounts_admin_idx
  on telegram_admin_accounts (admin_user_id, linked_at desc) where revoked_at is null;

-- One-time OIDC state and encrypted PKCE verifier; rows expire after ten minutes.
create table telegram_login_attempts (
  state_hash bytea primary key check (octet_length(state_hash) = 32),
  admin_user_id uuid not null references users(id) on delete cascade,
  nonce text not null check (length(nonce) between 32 and 128),
  encrypted_code_verifier text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  check (expires_at <= created_at + interval '10 minutes')
);
create index telegram_login_attempts_expiry_idx on telegram_login_attempts (expires_at);

-- A claimed order is delivered to every linked admin; keep all message IDs so web decisions
-- can close every Telegram copy, not just the first recipient's message.
create table purchase_order_telegram_messages (
  order_id uuid not null references purchase_orders(id) on delete cascade,
  chat_id bigint not null check (chat_id <> 0),
  message_id bigint not null check (message_id > 0),
  sent_at timestamptz not null default now(),
  primary key (order_id, chat_id, message_id)
);
create index purchase_order_telegram_messages_order_idx on purchase_order_telegram_messages (order_id);
