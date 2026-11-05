-- One active Telegram identity per admin, with a short-lived one-time bot deep-link token.
-- Earlier builds allowed several Telegram identities per admin. Keep the oldest
-- active connection and revoke the extras to enforce the new one-account rule.
with ranked as (
  select id, row_number() over (partition by admin_user_id order by linked_at, id) as position
  from telegram_admin_accounts where revoked_at is null
)
update telegram_admin_accounts a set revoked_at=now()
from ranked r where r.id=a.id and r.position > 1;

create unique index telegram_admin_accounts_admin_active_idx
  on telegram_admin_accounts (admin_user_id) where revoked_at is null;

create table telegram_link_attempts (
  token_hash bytea primary key check (octet_length(token_hash) = 32),
  admin_user_id uuid not null unique references users(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  check (expires_at <= created_at + interval '10 minutes')
);
create index telegram_link_attempts_expiry_idx on telegram_link_attempts (expires_at);
