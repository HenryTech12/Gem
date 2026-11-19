// Central configuration. Every value can be overridden with an environment variable.
const num = (v, d) => (v !== undefined && v !== '' && !Number.isNaN(Number(v)) ? Number(v) : d);

const lndNode = (role) => ({
  role,
  host: process.env[`LND_${role.toUpperCase()}_HOST`] || `lnd-${role}`,
  port: num(process.env[`LND_${role.toUpperCase()}_REST_PORT`], 8080),
  // Directory that contains tls.cert and data/chain/bitcoin/<network>/*.macaroon
  dir: process.env[`LND_${role.toUpperCase()}_DIR`] || `/lnd/${role}`,
});

export const config = {
  port: num(process.env.PORT, 3000),
  // Number of reverse proxies in front of the app (Render/Railway/Fly = 1). 0 = none: then
  // X-Forwarded-For is ignored, so clients can't spoof their IP to dodge rate limits.
  trustProxy: num(process.env.TRUST_PROXY, 0),
  // "mock" = in-memory simulated Lightning (no Docker needed), "lnd" = real LND nodes
  lnBackend: (process.env.LN_BACKEND || 'mock').toLowerCase(),
  network: process.env.LND_NETWORK || 'regtest',

  // Local currency display. Rate is locked into each order at creation time.
  currency: process.env.CURRENCY || 'NGN',
  btcPriceLocal: num(process.env.BTC_PRICE_LOCAL, 150_000_000), // 1 BTC in local currency

  // How long the buyer's payment may stay locked before it auto-refunds.
  lockMinutes: num(process.env.LOCK_MINUTES, 60),
  watchdogMs: num(process.env.WATCHDOG_MS, 2000),

  dataFile: process.env.DATA_FILE || './data/gem.json',

  // Optional AI order reading via Groq (free tier). Without a key, the rule parser is used.
  groqKey: process.env.GROQ_API_KEY || '',
  groqModel: process.env.GROQ_MODEL || 'openai/gpt-oss-20b',

  nostrRelays: (process.env.NOSTR_RELAYS || '').split(',').map((s) => s.trim()).filter(Boolean),
  nostrNotarySecretHex: process.env.NOSTR_NOTARY_SECRET_HEX || '',

  lnd: {
    seller: lndNode('seller'),
    rider: lndNode('rider'),
    buyer: lndNode('buyer'),
  },
};
