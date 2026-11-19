# Deploy Gëm publicly on real Lightning (regtest) in ~20 minutes

This puts the **real stack** online: bitcoind + 3 LND nodes (buyer, seller, rider) + Gëm, behind HTTPS.
The coins are regtest coins (no value), but every lock, settle and refund is a real LND hold invoice.
The home page shows **"regtest LND"** and the live node balances.

## 1. Rent a server (~5 minutes)

Any VPS with **Ubuntu 24.04, 2 vCPU, 4 GB RAM, 40 GB disk** works: Hetzner (CX22), DigitalOcean, Vultr, Contabo…
- Add your SSH key when creating it (or note the root password).
- If the provider has a firewall, allow **TCP 22, 80, 443** (and UDP 443).

## 2. Install Docker and get the code (~5 minutes)

```bash
ssh root@YOUR_SERVER_IP
curl -fsSL https://get.docker.com | sh
git clone https://github.com/HenryTech12/Gem.git
cd Gem
```

## 3. Configure (~2 minutes)

```bash
cp .env.example .env
nano .env
```

Set at least:
- `CURRENCY=NGN` (Lagos) or `XOF` (Dakar), and `BTC_PRICE_LOCAL` to match (≈150000000 NGN, ≈55000000 XOF)
- `GROQ_API_KEY=` your free key from console.groq.com (optional; without it the rule parser reads orders)
- `LOCK_MINUTES=60` (use `2` before demoing the automatic refund live)

Leave `DOMAIN`, `TRUST_PROXY`, `GEM_BIND` and `NOSTR_NOTARY_SECRET_HEX`: `deploy.sh` fills them in.

## 4. Deploy (~5 minutes, mostly waiting)

```bash
./deploy.sh                    # free address: https://YOUR-IP-WITH-DASHES.sslip.io
# or
./deploy.sh gem.yourdomain.com # your own domain: point its A record at the server first
```

It builds the app, starts the Lightning network, mines blocks, funds the buyer, opens channels,
starts HTTPS (Caddy gets a Let's Encrypt certificate) and prints your link.

## Day-to-day

| Task | Command |
|---|---|
| Logs | `docker compose logs -f backend` |
| Update to the latest code | `git pull && ./deploy.sh` (same domain argument as before) |
| Restart everything | `docker compose --profile https restart` |
| Mine blocks manually | `./scripts/mine.sh 6` |
| Prove it's real LND | `docker compose exec backend node test/lnd.integration.js` |
| Stop | `./stop.sh` (keeps data) |
| Wipe and start over | `./stop.sh --reset && ./deploy.sh` |

A `miner` container adds one block every 10 minutes so the nodes never consider the chain stale.

## Troubleshooting

- **"Not reachable over HTTPS yet"**: ports 80/443 are closed (check the provider firewall and `ufw status`),
  or your domain doesn't point at the server yet. See `docker compose logs caddy`.
- **Let's Encrypt refused sslip.io** (rate limit on busy days): use your own domain, or a free one from duckdns.org.
- **Demo wallet fails to pay after hundreds of demos**: the buyer's channels (5M sats to the seller, 1M to the rider)
  ran low. Reset the network: `./stop.sh --reset && ./deploy.sh`.
