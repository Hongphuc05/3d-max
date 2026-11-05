-- MANUAL ONLY. Refuse while Telegram accounts or notification records are in use.
begin;
do $$ begin
  if exists(select 1 from telegram_admin_accounts) or exists(select 1 from purchase_order_telegram_messages) then
    raise exception 'Rollback refused: linked Telegram accounts or order notifications exist.';
  end if;
end $$;
drop table purchase_order_telegram_messages;
drop table telegram_login_attempts;
drop table telegram_admin_accounts;
delete from schema_migrations where name='029_telegram_admin_links.sql';
commit;
