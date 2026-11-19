import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';
import { createStore } from './store.js';
import { createLightning } from './lightning/index.js';
import { createNostr } from './nostr.js';
import { createOrders } from './orders.js';
import { parseOrder } from './ai.js';
import { HttpError, str } from './validate.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export async function createApp(overrides = {}) {
  const cfg = { ...config, ...overrides };
  const store = createStore(cfg.dataFile);
  const ln = overrides.ln || (await createLightning(cfg));
  const nostr = createNostr(cfg);
  const orders = createOrders({ store, ln, config: cfg, nostr });

  const app = express();
  app.disable('x-powered-by');
  if (cfg.trustProxy) app.set('trust proxy', cfg.trustProxy); // real client IP for rate limits
  app.use(express.json({ limit: '16kb' }));

  // Security headers. No inline scripts, no third-party origins.
  app.use((req, res, next) => {
    res.set({
      'Content-Security-Policy': "default-src 'self'; img-src 'self' data: blob:; media-src 'self' blob:; style-src 'self'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      'Permissions-Policy': 'camera=(self), microphone=(), geolocation=()',
      'X-Frame-Options': 'DENY',
    });
    next();
  });

  // Logs method, route and status only: never bodies, addresses, names or secrets.
  app.use((req, res, next) => {
    const t = Date.now();
    res.on('finish', () => {
      if (req.path.startsWith('/api/')) {
        const route = req.route?.path || req.path.replace(/\/[A-Za-z0-9_-]{6,}/g, '/:id');
        console.log(`${req.method} ${route} ${res.statusCode} ${Date.now() - t}ms`);
      }
    });
    next();
  });

  // Simple per-IP rate limit for write endpoints.
  const hits = new Map();
  const limiter = (max, windowMs) => (req, res, next) => {
    const key = `${req.ip}:${req.baseUrl}${req.route?.path || req.path}`;
    const now = Date.now();
    const h = hits.get(key) || { n: 0, reset: now + windowMs };
    if (now > h.reset) { h.n = 0; h.reset = now + windowMs; }
    h.n += 1;
    hits.set(key, h);
    if (h.n > max) return res.status(429).json({ error: 'Too many requests, slow down' });
    next();
  };

  const wrap = (fn) => (req, res) =>
    Promise.resolve().then(() => fn(req, res)).then((out) => res.json(out)).catch((e) => {
      const status = e instanceof HttpError ? e.status : 500;
      if (status === 500) console.error('[error]', e.message);
      res.status(status).json({ error: status === 500 ? 'Something went wrong' : e.message });
    });

  const sellerToken = (req) => req.get('x-seller-token') || '';

  // ---------- API ----------
  app.get('/api/health', wrap(async () => ({ ok: true, mode: ln.mode, currency: cfg.currency, btcPriceLocal: cfg.btcPriceLocal, lockMinutes: cfg.lockMinutes, ai: cfg.groqKey ? 'groq' : 'rules', notary: nostr.notaryNpub })));
  app.get('/api/network', wrap(async () => ({ mode: ln.mode, nodes: await ln.info(), balances: await ln.balances() })));

  app.post('/api/sellers', limiter(10, 60_000), wrap((req) => orders.createSeller(req.body)));
  app.get('/api/sellers/:id', wrap((req) => orders.publicSeller(req.params.id)));
  app.get('/api/sellers/:id/orders', wrap(async (req) => {
    const list = orders.sellerOrders(req.params.id, sellerToken(req));
    return list;
  }));

  app.post('/api/sellers/:id/catalog', limiter(60, 60_000), wrap((req) => orders.addCatalogItem(req.params.id, sellerToken(req), req.body)));
  app.put('/api/sellers/:id/catalog/:itemId', limiter(60, 60_000), wrap((req) => orders.updateCatalogItem(req.params.id, sellerToken(req), req.params.itemId, req.body)));
  app.delete('/api/sellers/:id/catalog/:itemId', limiter(60, 60_000), wrap((req) => orders.deleteCatalogItem(req.params.id, sellerToken(req), req.params.itemId)));

  app.post('/api/ai/parse', limiter(30, 60_000), wrap(async (req) => {
    const seller = orders.authSeller(String(req.body.sellerId || ''), sellerToken(req));
    const text = str(req.body.text, { name: 'Message', min: 2, max: 1000, required: true });
    const parsed = await parseOrder(text, seller.catalog, cfg);
    return {
      ...parsed,
      items: parsed.items.map((i) => {
        const c = seller.catalog.find((x) => x.id === i.id);
        return { ...i, name: c.name, unitPrice: c.price };
      }),
    };
  }));

  app.post('/api/orders', limiter(30, 60_000), wrap((req) => orders.publicOrder(orders.createOrder(String(req.body.sellerId || ''), sellerToken(req), req.body))));
  app.get('/api/orders/:id', wrap(async (req) => orders.publicOrder(await orders.refresh(orders.getOrder(req.params.id)))));
  app.post('/api/orders/:id/lock', limiter(10, 60_000), wrap(async (req) => orders.publicOrder(await orders.lock(req.params.id, req.body))));
  app.post('/api/orders/:id/demo-pay', limiter(10, 60_000), wrap(async (req) => orders.publicOrder(await orders.demoPay(req.params.id))));
  app.post('/api/orders/:id/settle', limiter(20, 60_000), wrap(async (req) => orders.publicOrder(await orders.settle(req.params.id, req.body))));
  app.post('/api/orders/:id/cancel', limiter(10, 60_000), wrap(async (req) => orders.publicOrder(await orders.cancelBySeller(req.params.id, String(req.body.sellerId || ''), sellerToken(req)))));
  app.post('/api/orders/:id/review-template', limiter(10, 60_000), wrap((req) => orders.reviewTemplate(req.params.id, req.body)));
  app.post('/api/orders/:id/review', limiter(5, 60_000), wrap((req) => orders.review(req.params.id, req.body)));
  app.get('/api/rider/orders', wrap(() => orders.riderOrders()));

  app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));

  // ---------- Frontend ----------
  const pub = path.join(__dirname, '..', 'public');
  app.get('/vendor/qrcode.js', (req, res) => res.sendFile(path.join(__dirname, '..', 'node_modules', 'qrcode-generator', 'qrcode.js')));
  app.get('/o/:id', (req, res) => res.sendFile(path.join(pub, 'order.html')));
  app.get('/s/:id', (req, res) => res.sendFile(path.join(pub, 'shop.html')));
  app.use(express.static(pub, { extensions: ['html'], maxAge: '1h' }));

  const timer = setInterval(() => orders.tick(), cfg.watchdogMs);
  timer.unref();

  return { app, orders, ln, nostr, stop: () => clearInterval(timer) };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { app, ln } = await createApp();
  app.listen(config.port, () => {
    console.log(`Gëm running on http://localhost:${config.port}  (lightning: ${ln.mode}, currency: ${config.currency})`);
  });
}
