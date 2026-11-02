#!/usr/bin/env bash
# P6.4 (plan §P6.4, E3): sao luu PostgreSQL hang ngay. Giu BACKUP_KEEP ban moi nhat (mac dinh 14); neu dat BACKUP_RSYNC_TARGET
# (vd user@may-khac:/backups/3dsmood/) thi chep ra ngoai VPS. Moi ban dump co file .counts (so dong cac bang chinh) de restore-drill.sh doi chieu.
# Can: DATABASE_URL. Tuy chon: BACKUP_DIR, BACKUP_KEEP, BACKUP_RSYNC_TARGET.
set -euo pipefail
: "${DATABASE_URL:?DATABASE_URL is required}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/3dsmood}"
BACKUP_KEEP="${BACKUP_KEEP:-14}"
case "$BACKUP_KEEP" in ''|*[!0-9]*|0) echo "BACKUP_KEEP must be a positive integer" >&2; exit 1;; esac
TABLES="categories models model_files devices entitlements purchase_orders purchase_order_items audit_events app_settings"

umask 077
mkdir -p "$BACKUP_DIR"
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
dump="$BACKUP_DIR/3dsmood-$stamp.dump"
tmp="$dump.partial"
trap 'rm -f "$tmp" "$dump.counts.partial"' EXIT

pg_dump --format=custom --no-owner --file="$tmp" "$DATABASE_URL"
# Mot ban dump doc khong duoc con te hon khong co ban nao.
pg_restore --list "$tmp" > /dev/null

: > "$dump.counts.partial"
for t in $TABLES; do
  n="$(psql "$DATABASE_URL" -At -v ON_ERROR_STOP=1 -c "select count(*) from \"$t\"")"
  echo "$t $n" >> "$dump.counts.partial"
done
mv "$dump.counts.partial" "$dump.counts"
mv "$tmp" "$dump"
echo "backup ok: $dump ($(wc -c < "$dump") bytes)"

# Giu BACKUP_KEEP ban moi nhat (ten co dau thoi gian nen sap xep theo ten = theo thoi gian).
ls -1 "$BACKUP_DIR"/3dsmood-*.dump 2>/dev/null | sort | head -n "-$BACKUP_KEEP" | while read -r old; do rm -f -- "$old" "$old.counts"; echo "pruned: $old"; done

if [ -n "${BACKUP_RSYNC_TARGET:-}" ]; then
  rsync -a --delete-after --include='3dsmood-*.dump' --include='3dsmood-*.dump.counts' --exclude='*' "$BACKUP_DIR"/ "$BACKUP_RSYNC_TARGET"
  echo "copied off-site: $BACKUP_RSYNC_TARGET"
fi
