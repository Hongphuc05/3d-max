#!/bin/sh
# Kiem tra cau hinh Nginx KHONG can VPS: chay trong container nginx:stable (xem deploy/README.md).
#   docker run --rm -v "$PWD/deploy/nginx:/t:ro" -v "$PWD/deploy/nginx/3dsmood.conf:/etc/nginx/conf.d/default.conf:ro" nginx:stable sh /t/smoke-test.sh
# Upstream (store-api) khong chay trong bai nay: 502 = "yeu cau da duoc chuyen cho API", dung cho cac ca can chung minh dieu do.
set -u
fail=0
check() { # ten, mong doi, thuc te
  if [ "$2" = "$3" ]; then echo "ok   $1 ($3)"; else echo "FAIL $1: expected $2 got $3"; fail=1; fi
}
H1=$(printf 'a%.0s' $(seq 64)); H2=$(printf 'b%.0s' $(seq 64))
mkdir -p /etc/letsencrypt/live/api.example.com /var/lib/3dsmood/previews-v3 /var/www/3dsmood /var/www/certbot
openssl req -x509 -nodes -newkey rsa:2048 -days 1 -subj /CN=api.example.com -keyout /etc/letsencrypt/live/api.example.com/privkey.pem -out /etc/letsencrypt/live/api.example.com/fullchain.pem 2>/dev/null
echo webpdata > /var/lib/3dsmood/previews-v3/$H1.webp
echo '<html>admin</html>' > /var/www/3dsmood/index.html
nginx -t 2>&1 || exit 1
nginx; sleep 1
R="--resolve api.example.com:443:127.0.0.1"
code() { curl -sk -o /dev/null -w '%{http_code}' $R "$@"; }

check "preview on disk"              200 "$(code https://api.example.com/previews/$H1.webp)"
hdr=$(curl -sk -D- -o /dev/null $R https://api.example.com/previews/$H1.webp)
echo "$hdr" | grep -qi 'cache-control: public, max-age=31536000, immutable' && echo "ok   preview cache header" || { echo "FAIL preview cache header"; fail=1; }
echo "$hdr" | grep -qi 'content-type: image/webp' && echo "ok   preview content-type" || { echo "FAIL preview content-type"; fail=1; }
check "preview missing -> API"       502 "$(code https://api.example.com/previews/$H2.webp)"
check "not a hash -> API, not disk"  502 "$(code https://api.example.com/previews/not-a-hash.webp)"
check "encoded traversal refused"   400 "$(code --path-as-is https://api.example.com/previews/..%2f..%2fetc%2fpasswd)"
check "/internal blocked"            404 "$(code https://api.example.com/internal/r2/events)"
check "admin SPA fallback"           200 "$(code https://api.example.com/some/route)"
check "body 20k refused"             413 "$(head -c 20000 /dev/zero | curl -sk -o /dev/null -w '%{http_code}' $R -X POST --data-binary @- https://api.example.com/api/v1/orders)"
check "body 1k goes to API"          502 "$(head -c 1000 /dev/zero | curl -sk -o /dev/null -w '%{http_code}' $R -X POST --data-binary @- https://api.example.com/api/v1/orders)"
check "http redirects to https"      "301 https://api.example.com/x" "$(curl -s -o /dev/null -w '%{http_code} %{redirect_url}' --resolve api.example.com:80:127.0.0.1 http://api.example.com/x)"
check "acme path stays on http"      404 "$(curl -s -o /dev/null -w '%{http_code}' --resolve api.example.com:80:127.0.0.1 http://api.example.com/.well-known/acme-challenge/x)"
for p in some/route previews/$H1.webp api/health; do
  hsts=$(curl -sk -D- -o /dev/null $R https://api.example.com/$p | grep -ci 'strict-transport-security')
  nosniff=$(curl -sk -D- -o /dev/null $R https://api.example.com/$p | grep -ci 'x-content-type-options: nosniff')
  check "HSTS on /$p" 1 "$hsts"; check "nosniff on /$p" 1 "$nosniff"
done
[ "$fail" = 0 ] && echo "PASS: nginx smoke test" || { echo "FAIL: nginx smoke test"; exit 1; }
