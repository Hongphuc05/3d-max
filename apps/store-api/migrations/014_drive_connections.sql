-- v3 P1: Google Drive connection (Gmail B OAuth, or a service account) and configured sources.
-- Refresh tokens are AES-256-GCM encrypted by the application (key: DRIVE_TOKEN_KEY, never stored here).
create table drive_connections (
  id uuid primary key default gen_random_uuid(),
  google_account_email text not null check (length(google_account_email) between 3 and 320),
  auth_kind text not null check (auth_kind in ('OAUTH_USER','SERVICE_ACCOUNT')),
  encrypted_refresh_token bytea,
  token_iv bytea,
  token_auth_tag bytea,
  status text not null check (status in ('CONNECTED','EXPIRED','RECONNECT_REQUIRED','DISABLED')),
  connected_at timestamptz not null default now(),
  last_token_refresh_at timestamptz,
  -- Classification only (e.g. DRIVE_AUTH_REVOKED). Never store provider messages: they can echo credentials.
  last_error_code text check (last_error_code ~ '^[A-Z][A-Z0-9_]{1,60}$'),
  created_by uuid references users(id) on delete set null,
  check ((encrypted_refresh_token is null) = (token_iv is null) and (token_iv is null) = (token_auth_tag is null)),
  check (token_iv is null or octet_length(token_iv) = 12),
  check (token_auth_tag is null or octet_length(token_auth_tag) = 16),
  check (auth_kind <> 'OAUTH_USER' or encrypted_refresh_token is not null)
);
create unique index drive_connections_account_idx on drive_connections (lower(google_account_email), auth_kind);

create table drive_sources (
  id uuid primary key default gen_random_uuid(),
  connection_id uuid not null references drive_connections(id) on delete cascade,
  root_folder_id text not null check (root_folder_id ~ '^[A-Za-z0-9_-]{10,200}$'),
  root_folder_name text not null check (length(root_folder_name) between 1 and 500),
  root_resource_key text check (root_resource_key is null or root_resource_key ~ '^[A-Za-z0-9_-]{1,100}$'),
  source_type text not null check (source_type in ('MY_DRIVE','SHARED_WITH_ME','SHARED_DRIVE')),
  drive_id text,
  enabled boolean not null default true,
  last_successful_sync_at timestamptz,
  change_page_token text,
  created_at timestamptz not null default now(),
  unique (connection_id, root_folder_id)
);

-- One row per OAuth attempt. id = sha256(state); the PKCE verifier is encrypted, never plain.
create table oauth_states (
  id bytea primary key check (octet_length(id) = 32),
  admin_user_id uuid not null references users(id) on delete cascade,
  verifier_ciphertext bytea not null,
  verifier_iv bytea not null check (octet_length(verifier_iv) = 12),
  verifier_auth_tag bytea not null check (octet_length(verifier_auth_tag) = 16),
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);
create index oauth_states_expires_idx on oauth_states (expires_at);
