# Deploy Gëm on Render with real Lightning

`render.yaml` creates two services:

| Service | Lightning | Plan | Use it as |
|---|---|---|---|
| **gem-lnd** | **Real LND** (bitcoind regtest + 3 LND nodes, one container, persistent disk) | Starter (~$7/month) + 1 GB disk (~$0.25/month) | Main demo link |
| **gem** | Simulated (same app, in-memory Lightning) | Free | Backup link |

Render bills per second, so $50 of credit covers months of this.

## Steps

1. dashboard.render.com → **Sign in with GitHub**.
2. **New + → Blueprint** → pick **HenryTech12/Gem**, branch `main`.
3. Render shows both services. Fill in when asked (both optional):
   - `GROQ_API_KEY`: your `gsk_…` key from console.groq.com
   - `NOSTR_NOTARY_SECRET_HEX`: output of `openssl rand -hex 32`
4. **Apply.** gem-lnd's first deploy takes ~5–8 minutes: it builds the image, then on first boot mines blocks,
   funds the buyer and opens channels. In **gem-lnd → Logs** you'll see:
   ```
   [gem] first boot: mining, funding the buyer, opening channels
   [gem] Lightning ready: buyer -> seller 5M sats, buyer -> rider 1M sats
   Gëm running on http://localhost:10000  (lightning: lnd, currency: NGN)
   ```
5. Open the gem-lnd URL (`https://gem-lnd-xxxx.onrender.com`). The home page's **Live network** box shows
   **"regtest LND"** with the real node balances.

## Settings

**gem-lnd → Environment**, then **Save, rebuild and deploy**:
- `BTC_PRICE_LOCAL`: today's price of 1 BTC in your currency (the default is a placeholder)
- `CURRENCY=XOF` for Dakar
- `LOCK_MINUTES=2` before demoing the automatic refund live

## Good to know

- **Redeploys keep everything** (chain, channels, shops, orders) on the disk. The container shuts the nodes down
  cleanly first. While a redeploy runs (~1–2 min) the link is briefly down: avoid pushing to `main` while judges are using it.
- **If the chain is ever damaged** (e.g. the container is killed by an out-of-memory error), it resets the Lightning
  network automatically on the next boot and logs `regtest chain is damaged … resetting`. Shops are kept; orders that
  were open refund at their deadline.
- **Out of memory?** (Logs say "Ran out of memory".) Switch gem-lnd to the Standard plan.
- **Wipe and start fresh:** gem-lnd → **Disks** is not wipeable from the UI; instead set the env var `DATA_DIR=/data/v2`
  (any new folder) and redeploy.
