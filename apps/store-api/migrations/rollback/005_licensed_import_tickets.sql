-- Maintenance-only rollback: deploy compatible application first. Revokes tickets.
begin;
delete from import_tickets;
alter table import_tickets drop column device_id;
alter table import_tickets drop column license_id;
alter table import_tickets drop column auth_session_id;
delete from schema_migrations where name='005_licensed_import_tickets.sql';
commit;
