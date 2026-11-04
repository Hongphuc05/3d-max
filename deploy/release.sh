#!/bin/bash
# Chay boi root qua sudo tu user `ci` (GitHub Actions). Ban cai o /usr/local/bin/3dsmood-release la ban do root chep,
# KHONG tu cap nhat tu repo: ci khong sua duoc lenh chay quyen root. Doi file nay -> chay lai deploy/vps-bootstrap.sh.
set -euo pipefail
cd /opt/3dsmood/apps/store-api
runuser -u dsmood -- bash -c 'set -a; . /etc/3dsmood/store.env; set +a; exec node scripts/migrate.js'
systemctl restart store-api store-worker
sleep 3
systemctl is-active store-api store-worker
