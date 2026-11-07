begin;
do $$ begin
 if exists(select 1 from categories where content_domain='3dscenes')
 or exists(select 1 from models where content_domain='3dscenes')
 or exists(select 1 from drive_sync_jobs where content_domain='3dscenes')
 or exists(select 1 from drive_inventory where content_domain='3dscenes')
 or exists(select 1 from review_items where content_domain='3dscenes')
 or exists(select 1 from model_previews where local_path like '%/%') then
  raise exception 'Cannot rollback content domains while Scenes data or scoped preview paths exist';
 end if;
end $$;
drop trigger models_primary_category on models;
drop trigger models_domain on models;
drop trigger categories_domain on categories;
drop table model_categories;
drop function sync_primary_category();
drop function validate_catalog_domain();
alter table categories drop constraint categories_content_domain_full_path_key;
alter table categories drop column content_domain;
alter table categories add unique(full_path);
drop index models_stem_idx;
alter table models drop column content_domain;
create unique index models_stem_idx on models(stem) where stem is not null;
drop index drive_sync_jobs_one_active_idx;
alter table drive_sync_jobs drop column content_domain;
create unique index drive_sync_jobs_one_active_idx on drive_sync_jobs(source_id) where status in ('QUEUED','RUNNING','CANCELLING');
alter table drive_inventory drop constraint drive_inventory_source_id_content_domain_drive_file_id_key;
alter table drive_inventory drop column content_domain;
alter table drive_inventory add unique(source_id,drive_file_id);
alter table drive_archive_snapshot_runs drop column content_domain;
alter table review_items drop column content_domain;
delete from schema_migrations where name='033_content_domains.sql';
commit;
