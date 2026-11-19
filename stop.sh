#!/usr/bin/env bash
# ./stop.sh          stop everything (keeps data)
# ./stop.sh --reset  stop and wipe the regtest chain, nodes and orders
cd "$(dirname "$0")"
P="--profile https --profile tunnel"   # also stop Caddy / the tunnel if they were started
if [ "${1:-}" = "--reset" ]; then docker compose $P down -v; else docker compose $P down; fi
