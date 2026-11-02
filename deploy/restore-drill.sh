#!/usr/bin/env bash
# P6.4 (plan §P6.4, E3): DIEN TAP RESTORE. Phuc hoi mot ban dump vao CSDL tam tren may sach, doi chieu so dong voi file .counts di kem,
# roi xoa CSDL tam. Thoat 0 = PASS. KHONG bao gio dung toi CSDL production.
#   DRILL_ADMIN_URL=postgres://user:pass@host/postgres ./restore-drill.sh /var/backups/3dsmood/3dsmood-XXXX.dump
# DRILL_ADMIN_URL: ket noi co quyen CREATE DATABASE tren MAY SACH (khong phai production).
set -euo pipefail
dump="${1:?usage: restore-drill.sh <dump-file>}"
: "${DRILL_ADMIN_URL:?DRILL_ADMIN_URL is required (a server that is NOT production)}"
[ -f "$dump" ] || { echo "FAIL: no such dump: $dump" >&2; exit 1; }
[ -f "$dump.counts" ] || { echo "FAIL: missing $dump.counts" >&2; exit 1; }
if [ -n "${DATABASE_URL:-}" ] && [ "$DRILL_ADMIN_URL" = "$DATABASE_URL" ]; then echo "FAIL: DRILL_ADMIN_URL equals DATABASE_URL (production)" >&2; exit 1; fi

name="drill_$(date -u +%Y%m%d%H%M%S)_$$"
# URL cua CSDL tam = URL admin voi ten CSDL doi thanh $name (giu nguyen user/host/port/query).
drill_url="$(printf '%s' "$DRILL_ADMIN_URL" | sed -E "s#^([a-z]+://[^/]+)/[^?]*#\1/$name#")"
cleanup() { psql "$DRILL_ADMIN_URL" -At -c "drop database if exists \"$name\"" > /dev/null 2>&1 || true; }
trap cleanup EXIT

psql "$DRILL_ADMIN_URL" -At -v ON_ERROR_STOP=1 -c "create database \"$name\""
pg_restore --no-owner --exit-on-error --dbname="$drill_url" "$dump"

fail=0
while read -r table expected; do
  actual="$(psql "$drill_url" -At -v ON_ERROR_STOP=1 -c "select count(*) from \"$table\"")"
  if [ "$actual" = "$expected" ]; then echo "ok   $table $actual"; else echo "DIFF $table expected=$expected actual=$actual" >&2; fail=1; fi
done < "$dump.counts"
migrations="$(psql "$drill_url" -At -c "select count(*) from schema_migrations")"
echo "migrations applied in the restored copy: $migrations"
[ "$fail" = 0 ] && echo "PASS: restore drill" || { echo "FAIL: restore drill" >&2; exit 1; }
