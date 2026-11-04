-- D28.5: go bang cua cac huong da bo (license Lifetime theo tai khoan, payOS, R2, catalog cu, import ticket cu).
-- Khong con code nao doc/ghi cac bang nay. Giu: users + sessions (dang nhap admin), drive_connections + oauth_states
-- (drive_sources va chuoi rollback 014/019 con tham chieu; bang rong, khong chua du lieu moi).
-- Khong dung CASCADE: neu bang song nao con FK toi bang cu thi migration dung lai thay vi am tham mat rang buoc.
drop table if exists
  license_rate_limits, license_audit_logs, device_sessions, device_challenges, license_devices,
  payment_events, import_tickets, licenses, orders,
  r2_event_inbox, r2_objects,
  catalog_models, catalog_folders, catalog_sync_runs, catalog_sources;
