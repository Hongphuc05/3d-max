-- Existing rows and public IDs remain Models. Blob relocation is deliberately not a database migration.
alter table categories add column content_domain text not null default '3dmodels' check (content_domain in ('3dmodels','3dscenes'));
alter table categories drop constraint categories_full_path_key;
alter table categories add unique (content_domain, full_path);
alter table models add column content_domain text not null default '3dmodels' check (content_domain in ('3dmodels','3dscenes'));
drop index models_stem_idx;
create unique index models_stem_idx on models (content_domain, stem) where stem is not null;
alter table drive_sync_jobs add column content_domain text not null default '3dmodels' check (content_domain in ('3dmodels','3dscenes'));
drop index drive_sync_jobs_one_active_idx;
create unique index drive_sync_jobs_one_active_idx on drive_sync_jobs(source_id, content_domain) where status in ('QUEUED','RUNNING','CANCELLING');
alter table drive_inventory add column content_domain text not null default '3dmodels' check (content_domain in ('3dmodels','3dscenes'));
alter table drive_inventory drop constraint drive_inventory_source_id_drive_file_id_key;
alter table drive_inventory add unique(source_id, content_domain, drive_file_id);
alter table drive_archive_snapshot_runs add column content_domain text not null default '3dmodels' check (content_domain in ('3dmodels','3dscenes'));
alter table review_items add column content_domain text not null default '3dmodels' check (content_domain in ('3dmodels','3dscenes'));
create table model_categories (
 model_id uuid not null references models(id) on delete cascade,
 category_id uuid not null references categories(id) on delete cascade,
 from_drive boolean not null default false,
 from_upload boolean not null default false,
 primary key(model_id, category_id)
);
insert into model_categories(model_id, category_id) select id, category_id from models;
create index model_categories_category_idx on model_categories(category_id, model_id);
-- Enforce domain boundaries even for maintenance SQL; synchronize legacy primary-category writers.
create function validate_catalog_domain() returns trigger language plpgsql as $$
begin
 if TG_TABLE_NAME = 'categories' then
  if exists(select 1 from categories where id=NEW.parent_id and content_domain<>NEW.content_domain) then raise exception 'category domain mismatch' using errcode='23514'; end if;
 elsif TG_TABLE_NAME = 'models' then
  if exists(select 1 from categories where id=NEW.category_id and content_domain<>NEW.content_domain) or
    exists(select 1 from categories where id=NEW.drive_category_id and content_domain<>NEW.content_domain) then raise exception 'model domain mismatch' using errcode='23514'; end if;
 else
  if exists(select 1 from models m join categories c on c.id=NEW.category_id where m.id=NEW.model_id and m.content_domain<>c.content_domain) then raise exception 'membership domain mismatch' using errcode='23514'; end if;
 end if;
 return NEW;
end $$;
create trigger categories_domain before insert or update on categories for each row execute function validate_catalog_domain();
create trigger models_domain before insert or update on models for each row execute function validate_catalog_domain();
create trigger model_categories_domain before insert or update on model_categories for each row execute function validate_catalog_domain();
create function sync_primary_category() returns trigger language plpgsql as $$
begin
 if TG_OP = 'UPDATE' and NEW.category_id is distinct from OLD.category_id and NEW.content_domain='3dmodels' then delete from model_categories where model_id=NEW.id; end if;
 insert into model_categories(model_id,category_id) values(NEW.id, NEW.category_id) on conflict do nothing;
 return NEW;
end $$;
create trigger models_primary_category after insert or update of category_id on models for each row execute function sync_primary_category();
