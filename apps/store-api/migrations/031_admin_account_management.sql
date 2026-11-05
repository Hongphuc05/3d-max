-- Bootstrap one admin owner; subsequent admins are created and managed by this owner.
alter table users add column is_admin_owner boolean not null default false;
alter table users add column admin_disabled_at timestamptz;

update users set is_admin_owner=true
where id=(select id from users where role='ADMIN' order by created_at, id limit 1);

create unique index users_single_admin_owner_idx on users (is_admin_owner) where is_admin_owner;
