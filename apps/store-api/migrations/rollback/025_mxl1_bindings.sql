begin;
do $$ begin
  if exists (select 1 from mxl1_bindings) then
    raise exception 'Rollback refused: MXL1 bindings exist';
  end if;
end $$;
drop table mxl1_bindings;
delete from schema_migrations where name = '025_mxl1_bindings.sql';
commit;
