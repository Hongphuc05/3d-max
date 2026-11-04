-- MANUAL ONLY. Migration 024 drops per-model prices/entitlements, MXL1, purchase_order_items and OAuth Drive tables irreversibly.
-- Muon quay lai: khoi phuc tu ban sao luu (deploy/restore-drill.sh).
begin;
do $$ begin
  raise exception 'Rollback refused: 024 drops columns and tables irreversibly; restore from backup instead.';
end $$;
rollback;
