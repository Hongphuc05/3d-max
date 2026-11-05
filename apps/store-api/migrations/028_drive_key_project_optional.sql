-- API-key slots rotate independently. Project grouping cannot be inferred from a Drive API key alone.
drop index drive_api_key_slots_project_cooldown_idx;
alter table drive_api_key_slots alter column project_id drop not null;
create index drive_api_key_slots_enabled_cooldown_idx
  on drive_api_key_slots (cooldown_until)
  where enabled;
