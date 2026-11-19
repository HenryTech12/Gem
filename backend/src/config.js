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

  anthropicKey: process.env.ANTHROPIC_API_KEY || '',
  anthropicModel: process.env.ANTHROPIC_MODEL || 'claude-haiku-5-5',

  nostrRelays: (process.env.NOSTR_RELAYS || '').split(',').map((s) => s.trim()).filter(Boolean),
  nostrNotarySecretHex: process.env.NOSTR_NOTARY_SECRET_HEX || '',

  lnd: {
    seller: lndNode('seller'),
    rider: lndNode('rider'),
    buyer: lndNode('buyer'),
  },
};
