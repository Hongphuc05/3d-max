-- MANUAL ONLY. Refuse if any admin account has been disabled.
begin;
do $$ begin
  if exists(select 1 from users where admin_disabled_at is not null) then
    raise exception 'Rollback refused: disabled admin accounts exist.';
  end if;
end $$;
drop index users_single_admin_owner_idx;
alter table users drop column admin_disabled_at;
alter table users drop column is_admin_owner;
delete from schema_migrations where name='031_admin_account_management.sql';
commit;
