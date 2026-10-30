-- MANUAL ONLY. Refuses while two preview rows share a file: restoring UNIQUE(local_path) would fail or force data loss.
begin;
do $$ begin
  if exists(select 1 from model_previews group by local_path having count(*) > 1) then
    raise exception 'Rollback refused: preview rows share a file.';
  end if;
end $$;
drop index model_previews_local_path_idx;
alter table model_previews add constraint model_previews_local_path_key unique (local_path);
delete from schema_migrations where name='020_preview_shared_files.sql';
commit;
