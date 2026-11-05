-- MANUAL ONLY. This removes the display names entered for admin accounts.
begin;
alter table users drop column display_name;
delete from schema_migrations where name='032_admin_display_name.sql';
commit;
