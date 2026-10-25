-- Extend existing durable checkout records without rewriting customer payments.
alter table orders drop constraint orders_status_check;
alter table orders add constraint orders_status_check check (status in ('PENDING','PAID','FAILED','CANCELLED','EXPIRED'));
alter table orders add column product_code text not null default '3DSMOOD_LIFETIME' check (product_code='3DSMOOD_LIFETIME');
alter table orders add column expires_at timestamptz not null default (now() + interval '15 minutes');
alter table orders add column bank_bin text;
alter table orders add column account_number text;
alter table orders add column account_name text;
alter table orders add column description text;
alter table orders add column reconciled_at timestamptz;
alter table licenses add constraint licenses_order_id_unique unique(order_id);
alter table payment_events add column event_payload jsonb not null default '{}'::jsonb;
alter table payment_events add column received_at timestamptz not null default now();
create index orders_reconciliation_idx on orders(reconciled_at nulls first) where status <> 'PAID';
