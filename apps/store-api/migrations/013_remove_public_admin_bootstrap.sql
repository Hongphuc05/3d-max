-- Revoke the shared bootstrap account created by earlier builds. Its synthetic
-- UUID email is immutable even if someone changed the public username. Preserve
-- the row and its related records, but remove admin access and active sessions.
delete from sessions s
using users u
where s.user_id=u.id
  and u.role='ADMIN'
  and u.email ~ '^admin-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}@admin[.]invalid$';

update users
set role='USER', username=null, must_change_credentials=false
where role='ADMIN'
  and email ~ '^admin-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}@admin[.]invalid$';
