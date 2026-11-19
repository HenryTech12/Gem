#!/usr/bin/env bash
# Starts bitcoind + 3 LND nodes + Gëm in one container. First boot mines blocks, funds the buyer
# and opens channels (~1-2 min); later boots reuse everything on the /data disk.
set -euo pipefail
D=${DATA_DIR:-/data}
mkdir -p "$D/bitcoin" "$D/lnd"
RPC=(-regtest -datadir="$D/bitcoin" -rpcuser=gem -rpcpassword=gem)
bcli() { bitcoin-cli "${RPC[@]}" "$@"; }
port() { case $1 in buyer) echo 0;; seller) echo 1;; rider) echo 2;; esac; }
lncli_() { local n=$1; shift; lncli --network=regtest --lnddir="$D/lnd/$n" --rpcserver="127.0.0.1:$((10009 + $(port "$n")))" "$@"; }
js() { node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const d=JSON.parse(s);console.log($1)})"; }
log() { echo "[gem] $*"; }
wait_for() { local what=$1; shift; for _ in $(seq 1 150); do "$@" >/dev/null 2>&1 && return 0; sleep 2; done; log "timeout waiting for $what"; exit 1; }

# Clean shutdown on SIGTERM (every Render deploy/restart): stop the app, then each LND node, then
# bitcoind so it flushes its chain to disk. Without this the container is killed and bitcoind
# loses its newest blocks, which LND then refuses to sync to.
APP_PID="" MINER_PID="" BTC_PID="" LND_PIDS=()
stop_all() {
  for p in $MINER_PID $APP_PID; do kill "$p" 2>/dev/null || true; done
  for n in buyer seller rider; do lncli_ "$n" stop >/dev/null 2>&1 || true; done
  for p in "${LND_PIDS[@]}"; do wait "$p" 2>/dev/null || true; done
  bcli stop >/dev/null 2>&1 || true
  [ -n "$BTC_PID" ] && wait "$BTC_PID" 2>/dev/null || true
}
shutdown() { log "stopping cleanly"; stop_all; log "stopped"; exit 0; }
trap shutdown TERM INT

# Existing node data = not the first boot (used by the self-heal check below).
EXISTING=0; [ -d "$D/lnd/buyer/data" ] && EXISTING=1

# Wipe the regtest network and start over (shops/orders file is kept; open orders refund at their deadline).
reset_network() { log "regtest chain is damaged (unclean stop?): resetting the Lightning network"; trap - TERM INT; stop_all; rm -rf "$D/bitcoin" "$D/lnd"; exit 1; }

log "starting bitcoind (regtest)"
bitcoind "${RPC[@]}" -server=1 -txindex=1 -fallbackfee=0.0002 -dnsseed=0 -upnp=0 -listen=0 \
  -rpcbind=127.0.0.1 -rpcallowip=127.0.0.1 \
  -zmqpubrawblock=tcp://127.0.0.1:28332 -zmqpubrawtx=tcp://127.0.0.1:28333 -printtoconsole=0 &
BTC_PID=$!
wait_for bitcoind bcli getblockchaininfo

for n in buyer seller rider; do
  i=$(port "$n")
  log "starting lnd-$n"
  lnd --lnddir="$D/lnd/$n" --alias="$n" --noseedbackup --bitcoin.regtest --bitcoin.node=bitcoind \
    --bitcoind.rpchost=127.0.0.1:18443 --bitcoind.rpcuser=gem --bitcoind.rpcpass=gem \
    --bitcoind.zmqpubrawblock=tcp://127.0.0.1:28332 --bitcoind.zmqpubrawtx=tcp://127.0.0.1:28333 \
    --rpclisten=127.0.0.1:$((10009 + i)) --restlisten=127.0.0.1:$((8080 + i)) --listen=127.0.0.1:$((9735 + i)) \
    --tlsextradomain=localhost --trickledelay=1000 --debuglevel=warn > "$D/lnd/$n.log" 2>&1 &
  LND_PIDS+=($!)
done
for n in buyer seller rider; do wait_for "lnd-$n" lncli_ "$n" getinfo; done

mine() { bcli generatetoaddress "$1" "$(lncli_ buyer newaddress p2wkh | js "d.address")" >/dev/null; }
synced() { lncli_ "$1" getinfo | js "d.synced_to_chain" | grep -q true; }

# Self-heal: if a node can't sync (e.g. bitcoind lost blocks after a crash), reset and let the host restart us.
if [ $EXISTING = 1 ]; then
  for n in buyer seller rider; do
    ok=0; for _ in $(seq 1 45); do synced "$n" && { ok=1; break; }; sleep 2; done
    if [ $ok = 0 ] && grep -q "Block height out of range" "$D/lnd/$n.log"; then reset_network; fi
  done
fi

if [ "$(lncli_ buyer listchannels | js "d.channels.length")" -lt 2 ]; then
  log "first boot: mining, funding the buyer, opening channels"
  [ "$(bcli getblockcount)" -ge 101 ] || mine 101
  for n in buyer seller rider; do wait_for "$n sync" synced "$n"; done
  wait_for "buyer funds" bash -c "[ \$(lncli --network=regtest --lnddir=$D/lnd/buyer --rpcserver=127.0.0.1:10009 walletbalance | node -e \"let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.parse(s).confirmed_balance))\") -gt 0 ]"
  for n in seller rider; do
    pk=$(lncli_ "$n" getinfo | js "d.identity_pubkey")
    amt=$([ "$n" = seller ] && echo 5000000 || echo 1000000)
    if [ "$(lncli_ buyer listchannels | js "d.channels.filter(c=>c.remote_pubkey==='$pk').length")" = 0 ] \
       && [ "$(lncli_ buyer pendingchannels | js "d.pending_open_channels.filter(c=>c.channel.remote_node_pub==='$pk').length")" = 0 ]; then
      lncli_ buyer openchannel --node_key="$pk" --connect="127.0.0.1:$((9735 + $(port "$n")))" --local_amt="$amt" >/dev/null
    fi
  done
  mine 6
  wait_for "active channels" bash -c "[ \$(lncli --network=regtest --lnddir=$D/lnd/buyer --rpcserver=127.0.0.1:10009 listchannels --active_only | node -e \"let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.parse(s).channels.length))\") -ge 2 ]"
fi
log "Lightning ready: buyer -> seller 5M sats, buyer -> rider 1M sats"

# One block every 10 minutes keeps LND from seeing a stale chain (coinbase to an anyone-can-spend script).
( while sleep 600; do bcli generatetodescriptor 1 'raw(51)' >/dev/null || true; done ) &
MINER_PID=$!

export LN_BACKEND=lnd LND_NETWORK=regtest DATA_FILE="${DATA_FILE:-$D/gem.json}"
for n in buyer seller rider; do
  U=${n^^}
  export "LND_${U}_HOST=localhost" "LND_${U}_REST_PORT=$((8080 + $(port "$n")))" "LND_${U}_DIR=$D/lnd/$n"
done
log "starting Gëm on port ${PORT:-10000}"
node src/server.js &
APP_PID=$!

# If any process dies, stop the rest cleanly and exit so the host restarts the container.
wait -n || true
log "a process exited; restarting container"
trap - TERM INT
stop_all
exit 1
