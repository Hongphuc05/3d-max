-- MANUAL ONLY. Keep the single-account rule until all account links are deliberately removed.
begin;
do $$ begin
  if exists(select 1 from telegram_admin_accounts where revoked_at is null) then
    raise exception 'Rollback refused: active Telegram admin links exist.';
  end if;
end $$;
drop table telegram_link_attempts;
drop index telegram_admin_accounts_admin_active_idx;
delete from schema_migrations where name='030_telegram_start_link.sql';
commit;
