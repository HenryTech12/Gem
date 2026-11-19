#!/usr/bin/env bash
# Run the real regtest Lightning stack on THIS computer and get a free public HTTPS link.
#   ./tunnel.sh          start (or re-print the link if already running)
#   ./stop.sh            stop everything
# The link works only while this computer is on, awake and online. It changes if the tunnel restarts.
set -euo pipefail
cd "$(dirname "$0")"
command -v docker >/dev/null || { echo "Install Docker Desktop first: https://docs.docker.com/get-docker/"; exit 1; }

[ -f .env ] || cp .env.example .env
setenv() { if grep -q "^$1=" .env; then sed -i.bak "s|^$1=.*|$1=$2|" .env && rm -f .env.bak; else echo "$1=$2" >> .env; fi; }
getenv() { grep "^$1=" .env | cut -d= -f2- || true; }
setenv TRUST_PROXY 1          # the tunnel is one proxy hop: rate limits see the real visitor IP
[ -n "$(getenv NOSTR_NOTARY_SECRET_HEX)" ] || setenv NOSTR_NOTARY_SECRET_HEX "$(openssl rand -hex 32)"

./start.sh
docker compose --profile tunnel up -d tunnel

printf "⏳ opening the public link"
for _ in $(seq 1 45); do
  URL=$(docker compose --profile tunnel logs tunnel 2>/dev/null | grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' | tail -1 || true)
  if [ -n "$URL" ] && curl -fsS -o /dev/null --max-time 10 "$URL/api/health" 2>/dev/null; then
    echo " ✔"
    echo ""
    echo "✅ Gëm is live on real Lightning (regtest):  $URL"
    echo "   Seller: $URL/seller   Rider: $URL/rider"
    echo "   Keep this computer awake and online. Turn off sleep while judges use the link."
    exit 0
  fi
  printf "."; sleep 2
done
echo ""
[ -n "${URL:-}" ] && echo "Link created but not answering yet (new links can take a minute): $URL"
echo "Check:  docker compose --profile tunnel logs tunnel"
exit 1
