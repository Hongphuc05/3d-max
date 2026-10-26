-- A legacy allowlisted administrator can choose a login name without being
-- promoted to a permanent database role. Removing its allowlist entry revokes
-- administrative access while keeping the chosen login identity usable.
alter table users drop constraint users_username_format;
alter table users add constraint users_username_format check (
  username is null or username ~ '^[a-z0-9][a-z0-9_.-]{2,63}$'
);
