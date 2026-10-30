-- v3 P2 (D26): scanning uses a Google API key over a publicly shared folder, not OAuth.
-- Such a source has no drive_connections row. OAuth sources from P1 keep working unchanged.
alter table drive_sources alter column connection_id drop not null;
alter table drive_sources add column access_mode text not null default 'OAUTH' check (access_mode in ('OAUTH','API_KEY'));
-- An OAuth source needs its connection; an API-key source must not be bound to one.
alter table drive_sources add constraint drive_sources_access_mode_connection_chk
  check ((access_mode = 'OAUTH') = (connection_id is not null));
-- (connection_id, root_folder_id) cannot dedupe rows whose connection_id is null.
create unique index drive_sources_api_key_root_idx on drive_sources (root_folder_id) where access_mode = 'API_KEY';
