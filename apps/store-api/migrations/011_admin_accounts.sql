-- Admin identity is stored in PostgreSQL; public registration cannot assign it.
-- This migration only creates the schema. An operator must explicitly provision
-- the first administrator through LICENSE_ADMIN_USER_IDS after verifying the account.
alter table users add column role text not null default 'USER' check (role in ('USER','ADMIN'));
alter table users add column username text unique;
alter table users add column must_change_credentials boolean not null default false;
alter table users add constraint users_username_format check (
  username is null or (role='ADMIN' and username ~ '^[a-z0-9][a-z0-9_.-]{2,63}$')
);
