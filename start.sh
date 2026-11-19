#!/usr/bin/env bash
# One command: ./start.sh
set -euo pipefail
cd "$(dirname "$0")"
command -v docker >/dev/null || { echo "Docker is required: https://docs.docker.com/get-docker/"; exit 1; }
[ -f .env ] || cp .env.example .env
echo "🐳 starting bitcoind + 3 LND nodes + Gëm"
docker compose up -d --build
./scripts/setup-regtest.sh
echo ""
echo "✅ Gëm is running:  http://localhost:3000"
echo "   Seller: /seller    Rider: /rider    Logs: docker compose logs -f backend"
