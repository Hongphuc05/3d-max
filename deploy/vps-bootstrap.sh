#!/bin/bash
# Cai dat VPS MOT LAN (chay lai an toan). Can: Node, PostgreSQL (DB `store`, mat khau o /etc/3dsmood/db.pw), nginx, certbot da cap cert.
#   sudo bash deploy/vps-bootstrap.sh <domain> "<public key cua user ci>"
# Sau do GitHub Actions (.github/workflows/deploy.yml) chep code len va goi /usr/local/bin/3dsmood-release.
set -euo pipefail
DOMAIN=$1; CI_PUBKEY=$2; SRC=$(cd "$(dirname "$0")" && pwd)

id ci >/dev/null 2>&1 || adduser --disabled-password --gecos "" ci >/dev/null
install -d -m700 -o ci -g ci /home/ci/.ssh
grep -qxF "$CI_PUBKEY" /home/ci/.ssh/authorized_keys 2>/dev/null || echo "$CI_PUBKEY" >> /home/ci/.ssh/authorized_keys
chown ci:ci /home/ci/.ssh/authorized_keys; chmod 600 /home/ci/.ssh/authorized_keys
install -d -o ci -g ci /opt/3dsmood /opt/3dsmood/apps /opt/3dsmood/apps/store-api /opt/3dsmood/deploy /var/www/3dsmood /var/www/3dsmood-download
install -d -o dsmood -g dsmood /var/lib/3dsmood /var/backups/3dsmood

install -m755 -o root -g root "$SRC/release.sh" /usr/local/bin/3dsmood-release
echo 'ci ALL=(root) NOPASSWD: /usr/local/bin/3dsmood-release' > /etc/sudoers.d/91-ci && chmod 440 /etc/sudoers.d/91-ci
visudo -cq

ENV=/etc/3dsmood/store.env
if [ ! -f $ENV ]; then
  cat > $ENV <<E
NODE_ENV=production
DATABASE_URL=postgres://store:$(cat /etc/3dsmood/db.pw)@localhost:5432/store
CORS_ORIGINS=https://$DOMAIN
JWT_SECRET=$(node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))")
STORAGE_DIR=/var/lib/3dsmood
BACKUP_DIR=/var/backups/3dsmood
DRIVE_API_KEY=
# Telegram Bot API; TELEGRAM_OWNER_CHAT_IDS la tuy chon khi admin da lien ket trong giao dien.
TELEGRAM_BOT_TOKEN=
TELEGRAM_OWNER_CHAT_IDS=
TELEGRAM_WEBHOOK_SECRET=
TELEGRAM_WEBHOOK_PATH=
TELEGRAM_WEBHOOK_BASE_URL=https://$DOMAIN
E
fi
chown root:dsmood $ENV; chmod 640 $ENV

cp "$SRC"/systemd/*.service "$SRC"/systemd/*.timer /etc/systemd/system/
systemctl daemon-reload
systemctl enable store-api store-worker store-backup.timer store-monitor.timer >/dev/null 2>&1

sed "s/api\.example\.com/$DOMAIN/g" "$SRC/nginx/3dsmood.conf" > /etc/nginx/sites-available/3dsmood.conf
ln -sf /etc/nginx/sites-available/3dsmood.conf /etc/nginx/sites-enabled/3dsmood.conf
rm -f /etc/nginx/sites-enabled/acme /etc/nginx/sites-enabled/default
nginx -t
systemctl reload nginx
echo "bootstrap OK"
