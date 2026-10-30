-- MANUAL ONLY. Refuses once the catalog holds models, categories, review items or a published version.
begin;
do $$ begin
  if exists(select 1 from models) or exists(select 1 from categories) or exists(select 1 from review_items)
     or exists(select 1 from catalog_state where active_version > 0) then
    raise exception 'Rollback refused: catalog data exists.';
  end if;
end $$;
drop table review_items;
drop table model_previews;
alter table models drop constraint models_primary_file_fk;
drop table model_files;
drop table models;
drop table categories;
drop table catalog_state;
delete from schema_migrations where name='016_catalog.sql';
commit;
