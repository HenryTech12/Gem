#!/usr/bin/env bash
# ./stop.sh          stop (keeps data)
# ./stop.sh --reset  stop and wipe the regtest chain, nodes and orders
cd "$(dirname "$0")"
if [ "${1:-}" = "--reset" ]; then docker compose down -v; else docker compose down; fi
