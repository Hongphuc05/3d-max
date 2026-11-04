-- MANUAL ONLY. Migration 023 xoa bang cua cac huong da bo; khong the dung lai du lieu bang SQL.
-- Muon quay lai: khoi phuc tu ban sao luu (deploy/restore-drill.sh) hoac chay lai 003_licenses..010_r2_full_sync tren DB trong.
begin;
do $$ begin
  raise exception 'Rollback refused: 023 drops legacy tables irreversibly; restore from backup instead.';
end $$;
rollback;
