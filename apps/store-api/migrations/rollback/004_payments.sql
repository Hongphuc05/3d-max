-- MANUAL ONLY. Roll back 005 first. Never erase real payment history.
begin;
do $$ begin
  if exists(select 1 from orders) or exists(select 1 from payment_events) then
    raise exception 'Rollback refused: payment records exist. Use a reviewed forward migration.';
  end if;
end $$;
alter table licenses drop constraint licenses_order_id_fk;
drop table payment_events;
drop table orders;
drop sequence payment_order_code_seq;
delete from schema_migrations where name='004_payments.sql';
commit;
