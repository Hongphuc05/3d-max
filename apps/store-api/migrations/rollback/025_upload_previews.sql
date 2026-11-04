-- MANUAL ONLY. Refuses while uploaded previews, preview-only models or ownerless review items exist (rolling back would lose admin data).
begin;
do $$ begin
  if exists(select 1 from model_previews where source = 'UPLOAD') then raise exception 'Rollback refused: uploaded previews exist.'; end if;
  if exists(select 1 from review_items where source_id is null) then raise exception 'Rollback refused: review items without source exist.'; end if;
end $$;
alter table review_items alter column source_id set not null;
alter table model_previews drop constraint model_previews_source_check;
alter table model_previews add constraint model_previews_source_check check (source in ('DRIVE_IMAGE','ARCHIVE_ENTRY'));
drop index models_stem_idx;
alter table models drop column drive_category_id, drop column stem;
delete from schema_migrations where name = '025_upload_previews.sql';
commit;
