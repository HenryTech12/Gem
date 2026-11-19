#!/usr/bin/env bash
# Funds the buyer node and opens channels buyer->seller and buyer->rider. Idempotent.
set -euo pipefail
cd "$(dirname "$0")/.."

bcli() { docker compose exec -T bitcoind bitcoin-cli -regtest -rpcuser=gem -rpcpassword=gem "$@"; }
lncli() { local node=$1; shift; docker compose exec -T "lnd-$node" lncli --network=regtest "$@"; }
json() { python3 -c "import sys,json; d=json.load(sys.stdin); print($1)"; }
mine() { local addr; addr=$(lncli buyer newaddress p2wkh | json "d['address']"); bcli generatetoaddress "$1" "$addr" >/dev/null; }

wait_for() { # name, command...
  local name=$1; shift
  printf "⏳ waiting for %s" "$name"
  for _ in $(seq 1 90); do
    if "$@" >/dev/null 2>&1; then echo " ✔"; return 0; fi
    printf "."; sleep 2
  done
  echo " ✖ timeout"; exit 1
}

wait_for bitcoind bcli getblockchaininfo
for n in buyer seller rider; do wait_for "lnd-$n" lncli "$n" getinfo; done

ACTIVE=$(lncli buyer listchannels | json "len(d['channels'])")
if [ "$ACTIVE" -ge 2 ]; then
  echo "✔ channels already open"
  exit 0
fi

echo "⛏  mining 101 blocks to the buyer wallet"
mine 101
wait_for "buyer sync" bash -c "docker compose exec -T lnd-buyer lncli --network=regtest getinfo | grep -q '\"synced_to_chain\": true'"
wait_for "buyer funds" bash -c "[ \$(docker compose exec -T lnd-buyer lncli --network=regtest walletbalance | python3 -c 'import sys,json;print(json.load(sys.stdin)[\"confirmed_balance\"])') -gt 0 ]"

SELLER=$(lncli seller getinfo | json "d['identity_pubkey']")
RIDER=$(lncli rider getinfo | json "d['identity_pubkey']")
for n in seller rider; do wait_for "$n sync" bash -c "docker compose exec -T lnd-$n lncli --network=regtest getinfo | grep -q '\"synced_to_chain\": true'"; done

echo "⚡ opening channels"
lncli buyer openchannel --node_key="$SELLER" --connect=lnd-seller:9735 --local_amt=5000000 >/dev/null
lncli buyer openchannel --node_key="$RIDER" --connect=lnd-rider:9735 --local_amt=1000000 >/dev/null
mine 6
wait_for "active channels" bash -c "[ \$(docker compose exec -T lnd-buyer lncli --network=regtest listchannels --active_only | python3 -c 'import sys,json;print(len(json.load(sys.stdin)[\"channels\"]))') -ge 2 ]"
echo "✔ regtest Lightning network ready: buyer ⇄ seller (5M sats), buyer ⇄ rider (1M sats)"
