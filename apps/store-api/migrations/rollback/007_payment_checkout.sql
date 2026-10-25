begin;
do $$ begin
  if exists(select 1 from orders) or exists(select 1 from payment_events) then
    raise exception 'Rollback refused: payment records exist; restore backup or roll forward';
  end if;
end $$;
drop index orders_reconciliation_idx;
alter table licenses drop constraint licenses_order_id_unique;
alter table payment_events drop column event_payload, drop column received_at;
alter table orders drop column product_code, drop column expires_at, drop column bank_bin,
  drop column account_number, drop column account_name, drop column description, drop column reconciled_at;
alter table orders drop constraint orders_status_check;
alter table orders add constraint orders_status_check check (status in ('PENDING','PAID','FAILED','CANCELLED'));
delete from schema_migrations where name='007_payment_checkout.sql';
commit;
