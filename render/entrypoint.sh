#!/usr/bin/env bash
# Starts bitcoind + 3 LND nodes + Gëm in one container. First boot mines blocks, funds the buyer
# and opens channels (~1-3 min); later boots reuse everything on the /data disk.
set -euo pipefail
D=${DATA_DIR:-/data}
mkdir -p "$D/bitcoin" "$D/lnd"

# Open the web port right away with a "starting" page: hosts like Render kill a deploy that
# doesn't open a port within ~5 minutes, and the Lightning nodes can take longer on a slow CPU.
cat > /tmp/starting.js <<'JS'
require('http').createServer((req, res) => {
  if (req.url.startsWith('/api/')) {
    const health = req.url === '/api/health';
    res.writeHead(health ? 200 : 503, { 'content-type': 'application/json' });
    return res.end(JSON.stringify({ ok: health, starting: true }));
  }
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', refresh: '15' });
  res.end('<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Gëm</title>'
    + '<body style="font:18px system-ui;padding:24px"><h1>Gëm is starting its Lightning nodes…</h1>'
    + '<p>This takes 1–3 minutes after a deploy. This page refreshes by itself.</p>');
}).listen(Number(process.env.PORT || 10000), '0.0.0.0');
JS
node /tmp/starting.js &
STARTING_PID=$!
RPC=(-regtest -datadir="$D/bitcoin" -rpcuser=gem -rpcpassword=gem)
bcli() { bitcoin-cli "${RPC[@]}" "$@"; }
port() { case $1 in buyer) echo 0;; seller) echo 1;; rider) echo 2;; esac; }
lncli_() { local n=$1; shift; lncli --network=regtest --lnddir="$D/lnd/$n" --rpcserver="127.0.0.1:$((10009 + $(port "$n")))" "$@"; }
js() { node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const d=JSON.parse(s);console.log($1)})"; }
log() { echo "[gem] $*"; }
wait_for() { local what=$1; shift; for _ in $(seq 1 150); do "$@" >/dev/null 2>&1 && return 0; sleep 2; done; log "timeout waiting for $what"; return 1; }
# Print a node's recent log so failures are diagnosable from the host's log viewer.
dump() { [ -f "$D/lnd/$1.log" ] && { log "last lines of lnd-$1 log:"; tail -n 25 "$D/lnd/$1.log" | sed "s/^/[lnd-$1] /"; } || true; }

# Clean shutdown on SIGTERM (every Render deploy/restart): stop the app, then each LND node, then
# bitcoind so it flushes its chain to disk. Without this the container is killed and bitcoind
# loses its newest blocks, which LND then refuses to sync to.
APP_PID="" MINER_PID="" BTC_PID="" LND_PIDS=() TAIL_PIDS=()
stop_all() {
  for p in $MINER_PID $APP_PID $STARTING_PID "${TAIL_PIDS[@]}"; do kill "$p" 2>/dev/null || true; done
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
reset_network() { log "regtest chain or wallets are damaged (unclean stop?): resetting the Lightning network"; trap - TERM INT; stop_all; rm -rf "$D/bitcoin" "$D/lnd"; exit 1; }
# A step failed: on an existing disk, assume damaged data and reset; on a fresh disk, give up (host restarts us).
fail() { log "failed: $1"; for n in buyer seller rider; do dump "$n"; done; [ $EXISTING = 1 ] && reset_network; trap - TERM INT; stop_all; exit 1; }

# A node folder without its admin.macaroon means LND was killed while creating its wallet (e.g. out of
# memory). LND then hangs forever on that folder, so start the regtest network over right away.
for n in buyer seller rider; do
  if [ -d "$D/lnd/$n" ] && [ ! -f "$D/lnd/$n/data/chain/bitcoin/regtest/admin.macaroon" ]; then
    log "lnd-$n wallet was never finished (killed during setup?): resetting the Lightning network"
    rm -rf "$D/bitcoin" "$D/lnd"; mkdir -p "$D/bitcoin" "$D/lnd"; EXISTING=0
    break
  fi
done

log "starting bitcoind (regtest)"
bitcoind "${RPC[@]}" -server=1 -txindex=1 -fallbackfee=0.0002 -dnsseed=0 -upnp=0 -listen=0 \
  -rpcbind=127.0.0.1 -rpcallowip=127.0.0.1 \
  -zmqpubrawblock=tcp://127.0.0.1:28332 -zmqpubrawtx=tcp://127.0.0.1:28333 -printtoconsole=0 &
BTC_PID=$!
wait_for bitcoind bcli getblockchaininfo || fail "bitcoind did not start"

# One node at a time: creating/unlocking an LND wallet is deliberately CPU- and memory-heavy (scrypt).
for n in buyer seller rider; do
  i=$(port "$n")
  log "starting lnd-$n"
  lnd --lnddir="$D/lnd/$n" --alias="$n" --noseedbackup --bitcoin.regtest --bitcoin.node=bitcoind \
    --bitcoind.rpchost=127.0.0.1:18443 --bitcoind.rpcuser=gem --bitcoind.rpcpass=gem \
    --bitcoind.zmqpubrawblock=tcp://127.0.0.1:28332 --bitcoind.zmqpubrawtx=tcp://127.0.0.1:28333 \
    --rpclisten=127.0.0.1:$((10009 + i)) --restlisten=127.0.0.1:$((8080 + i)) --listen=127.0.0.1:$((9735 + i)) \
    --tlsextradomain=localhost --trickledelay=1000 --debuglevel=warn > "$D/lnd/$n.log" 2>&1 &
  LND_PIDS+=($!)
  # Show LND warnings/errors in the host's logs.
  tail -n +1 -F "$D/lnd/$n.log" 2>/dev/null | sed -u "s/^/[lnd-$n] /" &
  TAIL_PIDS+=($!)
  # Up to 2 minutes; give up at once if LND exits (e.g. a half-written wallet from a killed boot).
  up=0
  for _ in $(seq 1 60); do
    lncli_ "$n" getinfo >/dev/null 2>&1 && { up=1; break; }
    kill -0 "${LND_PIDS[-1]}" 2>/dev/null || fail "lnd-$n exited during startup"
    sleep 2
  done
  [ $up = 1 ] || fail "lnd-$n did not start"
  log "lnd-$n is up"
done

mine() { bcli generatetoaddress "$1" "$(lncli_ buyer newaddress p2wkh | js "d.address")" >/dev/null; }
synced() { lncli_ "$1" getinfo | js "d.synced_to_chain" | grep -q true; }

# Self-heal: if bitcoind lost blocks (e.g. killed before flushing), LND refuses to sync and logs
# "Block height out of range" within seconds. Watch all nodes for up to 30 s: reset on that error,
# carry on as soon as all are synced (a never-mined chain is never "synced": the 30 s just pass).
if [ $EXISTING = 1 ]; then
  for _ in $(seq 1 15); do
    grep -qs "Block height out of range" "$D/lnd/buyer.log" "$D/lnd/seller.log" "$D/lnd/rider.log" && reset_network
    synced buyer && synced seller && synced rider && break
    sleep 2
  done
fi

if [ "$(lncli_ buyer listchannels | js "d.channels.length")" -lt 2 ]; then
  log "first boot: mining, funding the buyer, opening channels"
  [ "$(bcli getblockcount)" -ge 101 ] || mine 101
  for n in buyer seller rider; do wait_for "$n sync" synced "$n" || fail "lnd-$n did not sync"; done
  wait_for "buyer funds" bash -c "[ \$(lncli --network=regtest --lnddir=$D/lnd/buyer --rpcserver=127.0.0.1:10009 walletbalance | node -e \"let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.parse(s).confirmed_balance))\") -gt 0 ]" || fail "buyer wallet not funded"
  for n in seller rider; do
    pk=$(lncli_ "$n" getinfo | js "d.identity_pubkey")
    amt=$([ "$n" = seller ] && echo 5000000 || echo 1000000)
    if [ "$(lncli_ buyer listchannels | js "d.channels.filter(c=>c.remote_pubkey==='$pk').length")" = 0 ] \
       && [ "$(lncli_ buyer pendingchannels | js "d.pending_open_channels.filter(c=>c.channel.remote_node_pub==='$pk').length")" = 0 ]; then
      lncli_ buyer openchannel --node_key="$pk" --connect="127.0.0.1:$((9735 + $(port "$n")))" --local_amt="$amt" >/dev/null
    fi
  done
  mine 6
  wait_for "active channels" bash -c "[ \$(lncli --network=regtest --lnddir=$D/lnd/buyer --rpcserver=127.0.0.1:10009 listchannels --active_only | node -e \"let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.parse(s).channels.length))\") -ge 2 ]" || fail "channels did not open"
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
kill "$STARTING_PID" 2>/dev/null || true; wait "$STARTING_PID" 2>/dev/null || true; STARTING_PID=""
node src/server.js &
APP_PID=$!

# If any process dies, stop the rest cleanly and exit so the host restarts the container.
wait -n || true
log "a process exited; restarting container"
trap - TERM INT
stop_all
exit 1
