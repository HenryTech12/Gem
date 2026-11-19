#!/usr/bin/env bash
# Mine N regtest blocks (default 1).
cd "$(dirname "$0")/.."
ADDR=$(docker compose exec -T lnd-buyer lncli --network=regtest newaddress p2wkh | python3 -c "import sys,json;print(json.load(sys.stdin)['address'])")
docker compose exec -T bitcoind bitcoin-cli -regtest -rpcuser=gem -rpcpassword=gem generatetoaddress "${1:-1}" "$ADDR" >/dev/null && echo "mined ${1:-1} block(s)"
