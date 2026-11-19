#!/usr/bin/env bash
# Public deploy on a VPS: real regtest Lightning (bitcoind + 3 LND nodes) + Gëm + HTTPS.
#   ./deploy.sh                    uses a free <your-ip>.sslip.io address
#   ./deploy.sh gem.example.com    uses your own domain (point its A record at this server first)
# Needs: Docker, ports 80 and 443 open. Safe to run again (keeps data).
set -euo pipefail
cd "$(dirname "$0")"
command -v docker >/dev/null || { echo "Install Docker first:  curl -fsSL https://get.docker.com | sh"; exit 1; }

DOMAIN="${1:-}"
if [ -z "$DOMAIN" ]; then
  IP=$(curl -4fsS https://api.ipify.org) || { echo "Could not detect this server's public IP. Run: ./deploy.sh your.domain"; exit 1; }
  DOMAIN="$(echo "$IP" | tr . -).sslip.io"
fi

[ -f .env ] || cp .env.example .env
setenv() { if grep -q "^$1=" .env; then sed -i.bak "s|^$1=.*|$1=$2|" .env && rm -f .env.bak; else echo "$1=$2" >> .env; fi; }
getenv() { grep "^$1=" .env | cut -d= -f2- || true; }
setenv DOMAIN "$DOMAIN"
setenv TRUST_PROXY 1          # Caddy is one proxy hop: rate limits see the real visitor IP
setenv GEM_BIND 127.0.0.1     # the app port is not exposed; only HTTPS is
[ -n "$(getenv NOSTR_NOTARY_SECRET_HEX)" ] || setenv NOSTR_NOTARY_SECRET_HEX "$(openssl rand -hex 32)"

./start.sh
docker compose --profile https up -d caddy

echo ""
echo "⏳ getting the HTTPS certificate for $DOMAIN"
for _ in $(seq 1 30); do
  if curl -fsS -o /dev/null "https://$DOMAIN/api/health"; then
    echo "✅ Gëm is live:  https://$DOMAIN"
    echo "   Seller: https://$DOMAIN/seller   Rider: https://$DOMAIN/rider"
    exit 0
  fi
  sleep 4
done
echo "⚠️  Not reachable over HTTPS yet. Check that ports 80 and 443 are open, then:  docker compose logs caddy"
exit 1
