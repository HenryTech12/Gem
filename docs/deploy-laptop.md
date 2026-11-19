# Run Gëm on your laptop with a public link (real Lightning, free)

Your laptop runs the real stack (bitcoind + 3 LND nodes + Gëm). A free Cloudflare quick tunnel gives it a
public `https://….trycloudflare.com` link that judges can open on their phones. No account, no domain, no VPS.

**The catch:** the link works only while your laptop is **on, awake and online**, and the link **changes**
if the tunnel restarts (laptop sleep, reboot, `./stop.sh`). Submit the link only once judging setup is final,
and keep a backup link (the Render simulated deploy) in your submission.

## What you need

- 8 GB RAM or more, ~5 GB free disk
- **Docker Desktop**: https://docs.docker.com/get-docker/ (start it and wait until it says "running")
- **Mac**: nothing else (if asked to install "command line developer tools", accept: it provides `python3` and `git`)
- **Windows**: use **WSL 2 with Ubuntu** (`wsl --install` in PowerShell as administrator, reboot), turn on
  Docker Desktop → Settings → Resources → WSL integration → Ubuntu, then run every command below in the Ubuntu terminal
- **Linux**: Docker Engine + `python3` + `git`

## Start

```bash
git clone https://github.com/HenryTech12/Gem.git
cd Gem
cp .env.example .env     # then edit: CURRENCY, BTC_PRICE_LOCAL, GROQ_API_KEY (optional)
./tunnel.sh
```

First run takes 5–10 minutes (downloads, then mines blocks and opens channels). It ends with:

```
✅ Gëm is live on real Lightning (regtest):  https://some-random-words.trycloudflare.com
```

Run `./tunnel.sh` again any time to print the current link (it doesn't restart anything).

## Keep it alive during judging

- Plug in the charger.
- Turn off sleep: **Mac** System Settings → Battery/Energy → prevent sleeping when the display is off
  (or run `caffeinate -d` in a terminal); **Windows** Settings → System → Power → Sleep: Never.
- Don't close the lid (unless your laptop is set to stay awake with the lid closed).
- Stay on a stable connection (Wi-Fi or ethernet; a phone hotspot works but can drop).

## Stop / reset

```bash
./stop.sh            # stop (keeps channels and orders); the link stops working
./stop.sh --reset    # wipe everything and start from zero next time
```

## Troubleshooting

- **"Install Docker Desktop first"** or `Cannot connect to the Docker daemon`: open Docker Desktop and wait for it to start.
- **The link shows an error page**: a brand-new link can take a minute; run `./tunnel.sh` again.
  Logs: `docker compose --profile tunnel logs tunnel`.
- **Your network blocks it** (some campus or office networks): try a phone hotspot.
