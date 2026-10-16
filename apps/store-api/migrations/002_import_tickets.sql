-- Ticket 1 lan de host 3ds Max tai goi: host tai bang HttpClient rieng, khong co cookie cua WebView.
create table import_tickets (
  id         bytea primary key,  -- sha256 cua ticket, giong sessions
  user_id    uuid not null references users(id) on delete cascade,
  product_id text not null,
  expires_at timestamptz not null,
  used_at    timestamptz
);
