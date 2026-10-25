-- Old tickets lack a proof binding and are intentionally no longer redeemable.
alter table import_tickets add column auth_session_id bytea references sessions(id) on delete cascade;
alter table import_tickets add column license_id uuid references licenses(id);
alter table import_tickets add column device_id uuid references license_devices(id);
create index import_tickets_auth_idx on import_tickets(auth_session_id);
