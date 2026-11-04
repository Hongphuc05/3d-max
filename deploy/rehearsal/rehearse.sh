#!/usr/bin/env bash
# P6: dien tap deploy production tren may dev bang Docker. Bat duoc loi "thieu bien, sai duong dan, sai quyen ghi, sai thu tu khoi dong"
# TRUOC khi thue VPS. KHONG thay the VPS that (khong co systemd, TLS that, mang that, Drive that).
#   bash deploy/rehearsal/rehearse.sh            # chay + kiem tra, de stack chay
#   bash deploy/rehearsal/rehearse.sh down       # tat va xoa du lieu dien tap
set -uo pipefail
export MSYS_NO_PATHCONV=1
cd "$(dirname "$0")"
DC="docker compose -f docker-compose.yml"
BASE="https://localhost:8443"
fail=0
ok()   { echo "ok   $1"; }
bad()  { echo "FAIL $1"; fail=1; }
check() { if [ "$2" = "$3" ]; then ok "$1 ($3)"; else bad "$1: expected '$2' got '$3'"; fi; }
code() { curl -sk -o /dev/null -w '%{http_code}' --max-time 20 "$@"; }

if [ "${1:-}" = "down" ]; then $DC down -v --remove-orphans; rm -rf .state; exit 0; fi

# 1. bi mat + chung chi tu ky (chi cho dien tap; xoa khi `down`)
if [ ! -f .state/store.env ]; then
  mkdir -p .state/tls
  b64() { openssl rand -base64 32; }
  pw="$(openssl rand -hex 16)"
  printf 'POSTGRES_PASSWORD=%s\n' "$pw" > .state/pg.env
  cat > .state/store.env <<EOF
DATABASE_URL=postgres://store:$pw@postgres:5432/store
JWT_SECRET=$(b64)
DRIVE_API_KEY=$(openssl rand -hex 20)
CORS_ORIGINS=https://api.example.com
EOF
  openssl req -x509 -nodes -newkey rsa:2048 -days 7 -subj /CN=api.example.com -keyout .state/tls/privkey.pem -out .state/tls/fullchain.pem 2>/dev/null
fi

echo "== build + start"
$DC build api worker 2>&1 | tail -3
$DC up -d postgres 2>&1 | tail -2
until [ "$($DC ps postgres --format '{{.Health}}')" = "healthy" ]; do sleep 1; done

# 2. production KHONG tu migrate: neu khong chay migrate, API phai len nhung bang thieu -> health 503 (kiem hanh vi thuc te)
echo "== migrate (nhu runbook: npm run migrate)"
$DC run --rm api npm run migrate 2>&1 | tail -3
$DC up -d api worker nginx 2>&1 | tail -3
for i in $(seq 1 40); do [ "$(code $BASE/api/health)" = "200" ] && break; sleep 1; done

echo "== kiem tra qua Nginx (TLS tu ky)"
check "health"                           200 "$(code $BASE/api/health)"
body="$(curl -sk $BASE/api/health)"; echo "     health body: $body"
case "$body" in *'"db":true'*) ok "database reachable";; *) bad "database not reachable";; esac
check "admin orders needs login"         401 "$(code $BASE/api/admin/orders)"
check "device endpoint needs token"      401 "$(code $BASE/api/v1/me/entitlements)"
check "orders need token"                401 "$(code -X POST -H 'content-type: application/json' -d '{}' $BASE/api/v1/orders)"
check "telegram webhook absent (bot off)" 404 "$(code -X POST $BASE/api/telegram/webhook/anything_at_all_1234567)"
check "r2 webhook not exposed"           404 "$(code $BASE/internal/r2/events)"
check "SPA fallback"                     200 "$(code $BASE/some/route)"
check "catalog version answers"          "200" "$(code $BASE/api/v1/catalog/version)"
echo "     catalog version body: $(curl -sk $BASE/api/v1/catalog/version | head -c 200)"
check "API port not published"           "000" "$(code --connect-timeout 2 http://localhost:4000/api/health)"

echo "== preview: API va Nginx dung chung thu muc"
H="$(printf 'c%.0s' $(seq 64))"
$DC exec -T api sh -c "mkdir -p /var/lib/3dsmood/previews-v3 && echo webp > /var/lib/3dsmood/previews-v3/$H.webp"
check "preview served by nginx from disk" 200 "$(code $BASE/previews/$H.webp)"

echo "== SSE qua Nginx (khong dem)"
hdr="$(curl -sk -N --max-time 3 -D- -o .state/sse.out $BASE/api/v1/catalog/events 2>/dev/null)"
echo "$hdr" | grep -qi 'content-type: text/event-stream' && ok "SSE content-type" || bad "SSE content-type"
echo "$hdr" | head -1 | grep -q '200' && ok "SSE status 200" || bad "SSE status ($(echo "$hdr" | head -1))"
[ -s .state/sse.out ] && ok "SSE sent bytes within 3s (no proxy buffering)" || bad "SSE sent nothing within 3s"

echo "== quyen ghi va tien trinh"
check "api runs as non-root"             node "$($DC exec -T api whoami | tr -d '\r')"
check "worker started"                   1 "$($DC logs worker 2>&1 | grep -c 'store-worker started')"
$DC exec -T api sh -c 'touch /var/lib/3dsmood/.w && rm /var/lib/3dsmood/.w' && ok "api can write STORAGE_DIR" || bad "api cannot write STORAGE_DIR"

echo "== giam sat (scripts/monitor.js) trong container"
$DC exec -T -e MONITOR_UNITS= api node scripts/monitor.js; rc=$?
[ "$rc" = 0 ] || [ "$rc" = 2 ] && ok "monitor ran (exit $rc: 0=binh thuong, 2=co van de)" || bad "monitor crashed (exit $rc)"

echo "== backup + dien tap restore (dung script that, DB cua stack nay)"
$DC cp ../backup.sh postgres:/tmp/backup.sh >/dev/null 2>&1; $DC cp ../restore-drill.sh postgres:/tmp/restore-drill.sh >/dev/null 2>&1
pw="$(sed 's/.*=//' .state/pg.env)"
U="postgres://store:$pw@localhost:5432/store"
$DC exec -T -e DATABASE_URL="$U" -e BACKUP_DIR=/tmp/bk postgres bash /tmp/backup.sh | tail -1
f="$($DC exec -T postgres sh -c 'ls /tmp/bk/*.dump | head -1' | tr -d '\r')"
$DC exec -T -e DRILL_ADMIN_URL="postgres://store:$pw@localhost:5432/postgres" postgres bash /tmp/restore-drill.sh "$f" | tail -2 | grep -q "PASS" && ok "restore drill PASS" || bad "restore drill"

echo "== job Drive that bai (API key gia): catalog giu nguyen, worker song, giam sat bao"
psql_() { $DC exec -T postgres psql -U store -d store -At -v ON_ERROR_STOP=1 "$@" | tr -d '\r'; }
sid="$(psql_ -c "insert into drive_sources(access_mode,root_folder_id,root_folder_name,source_type) values('API_KEY','rehearsal$(openssl rand -hex 12)','root','MY_DRIVE') returning id" | head -1)"
psql_ -c "insert into drive_sync_jobs(source_id,mode,status) values ('$sid','FULL','QUEUED')" >/dev/null
st=QUEUED
for i in $(seq 1 90); do
  st="$(psql_ -c "select status from drive_sync_jobs where source_id='$sid' order by created_at desc limit 1")"
  case "$st" in QUEUED|RUNNING) sleep 1;; *) break;; esac
done
echo "     job status after worker run: $st ($(psql_ -c "select coalesce(error_code,'-') from drive_sync_jobs where source_id='$sid' order by created_at desc limit 1"))"
case "$st" in FAILED|COMPLETED_WITH_ERRORS) ok "bad key ends the job as $st (not stuck)";; *) bad "job status $st";; esac
ver="$(curl -sk $BASE/api/v1/catalog/version | node -p "JSON.parse(require('fs').readFileSync(0,'utf8')).catalogVersion")"
check "catalog unchanged after failed job" 0 "$ver"
check "worker still running"             running "$($DC ps worker --format '{{.State}}')"
$DC exec -T -e MONITOR_UNITS= api node scripts/monitor.js; rc=$?
check "monitor reports the failed job (exit 2)" 2 "$rc"

echo "== Postgres sap roi len lai"
$DC stop postgres >/dev/null 2>&1
check "health while DB is down"          503 "$(code $BASE/api/health)"
out="$($DC exec -T -e MONITOR_UNITS= api node scripts/monitor.js)"   # bien, khong pipe vao grep -q (pipefail + SIGPIPE)
case "$out" in *"] db:"*) ok "monitor reports db down";; *) bad "monitor did not report db down: $out";; esac
$DC start postgres >/dev/null 2>&1
for i in $(seq 1 60); do [ "$(code $BASE/api/health)" = "200" ] && break; sleep 1; done
check "health after DB is back (api not restarted)" 200 "$(code $BASE/api/health)"
sleep 12
check "worker survived the DB outage"     running "$($DC ps worker --format '{{.State}}')"
check "worker resumed polling (no crash loop)" 0 "$($DC ps worker --format '{{.ExitCode}}')"

echo "== khoi dong lai khong mat dich vu"
$DC restart api >/dev/null 2>&1
for i in $(seq 1 30); do [ "$(code $BASE/api/health)" = "200" ] && break; sleep 1; done
check "health after api restart"         200 "$(code $BASE/api/health)"

echo "== dung luong RAM (gioi han 900 MB)"
docker stats --no-stream --format '     {{.Name}}  {{.MemUsage}}' $($DC ps -q api worker postgres nginx)

echo "== canh bao trong log (production)"
for s in api worker; do echo "  -- $s"; $DC logs $s 2>&1 | grep -iE "warn|error|fatal|unhandled|ECONN|EACCES|ENOENT" | sort | uniq -c | head -8; done

[ "$fail" = 0 ] && echo "PASS: rehearsal" || { echo "FAIL: rehearsal"; exit 1; }
