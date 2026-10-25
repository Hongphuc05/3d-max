-- payOS VND orders. A pending order survives ambiguous network failures.
create sequence payment_order_code_seq start with 1000000000000 maxvalue 9007199254740991 no cycle;
create table orders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id),
  order_code bigint not null unique default nextval('payment_order_code_seq') check (order_code between 1 and 9007199254740991),
  amount_vnd bigint not null check (amount_vnd between 1 and 9007199254740991),
  currency text not null default 'VND' check (currency = 'VND'),
  status text not null default 'PENDING' check (status in ('PENDING', 'PAID', 'FAILED', 'CANCELLED')),
  payos_payment_link_id text unique,
  checkout_url text,
  qr_code text,
  creation_attempted boolean not null default false,
  fulfillment_result text check (fulfillment_result in ('LICENSE_ISSUED', 'ALREADY_LICENSED')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  paid_at timestamptz,
  check ((status = 'PAID') = (paid_at is not null)),
  check ((status = 'PAID') = (fulfillment_result is not null))
);
create unique index orders_one_pending_per_user on orders(user_id) where status = 'PENDING';
create index orders_user_created_idx on orders(user_id, created_at desc);
create table payment_events (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders(id),
  provider_reference text not null unique,
  event_type text not null check (event_type in ('WEBHOOK', 'RECONCILIATION')),
  processed_at timestamptz not null default now(),
  result text not null check (result in ('LICENSE_ISSUED', 'ALREADY_LICENSED', 'ALREADY_PAID'))
);
alter table licenses add constraint licenses_order_id_fk foreign key(order_id) references orders(id);
