// Real LND client over the REST API.
//
// Least privilege:
//   - seller & rider nodes: invoice.macaroon  (can create/settle/cancel invoices, CANNOT send funds)
//   - all nodes, balances:   readonly.macaroon
//   - buyer node:            admin.macaroon, ONLY for the built-in demo wallet. In production the
//                            buyer pays from their own wallet by scanning the invoice QR.
import https from 'node:https';
import fs from 'node:fs';
import path from 'node:path';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const hexToB64 = (hex) => Buffer.from(hex, 'hex').toString('base64');

class LndNode {
  constructor({ role, host, port, dir }, network) {
    this.role = role;
    this.host = host;
    this.port = port;
    this.dir = dir;
    this.macDir = path.join(dir, 'data', 'chain', 'bitcoin', network);
    this.mac = {};
  }

  async load(timeoutMs = 180_000) {
    const certPath = path.join(this.dir, 'tls.cert');
    const want = ['invoice', 'readonly', ...(this.role === 'buyer' ? ['admin'] : [])];
    const start = Date.now();
    for (;;) {
      const ok = fs.existsSync(certPath) && want.every((m) => fs.existsSync(path.join(this.macDir, `${m}.macaroon`)));
      if (ok) break;
      if (Date.now() - start > timeoutMs) throw new Error(`LND ${this.role}: credentials not found in ${this.dir}`);
      await sleep(1000);
    }
    this.ca = fs.readFileSync(certPath);
    for (const m of want) this.mac[m] = fs.readFileSync(path.join(this.macDir, `${m}.macaroon`)).toString('hex');
  }

  request(method, urlPath, body, macaroon = 'readonly') {
    return new Promise((resolve, reject) => {
      const payload = body ? JSON.stringify(body) : undefined;
      const req = https.request(
        {
          host: this.host,
          port: this.port,
          path: urlPath,
          method,
          ca: this.ca,
          servername: this.host,
          headers: {
            'Grpc-Metadata-macaroon': this.mac[macaroon],
            ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}),
          },
          timeout: 20_000,
        },
        (res) => {
          let data = '';
          res.on('data', (c) => (data += c));
          res.on('end', () => {
            let json = {};
            try { json = data ? JSON.parse(data) : {}; } catch { /* non-JSON */ }
            if (res.statusCode >= 200 && res.statusCode < 300) resolve(json);
            else reject(new Error(`LND ${this.role} ${urlPath}: ${json.message || res.statusCode}`));
          });
        },
      );
      req.on('timeout', () => req.destroy(new Error(`LND ${this.role} timeout`)));
      req.on('error', reject);
      if (payload) req.write(payload);
      req.end();
    });
  }

  // SendPaymentV2 is a server stream. A hold-invoice payment stays IN_FLIGHT until the receiver
  // settles or cancels, so we resolve on the first update and keep draining the stream.
  payStream(bolt11) {
    return new Promise((resolve, reject) => {
      const payload = JSON.stringify({ payment_request: bolt11, timeout_seconds: 60, fee_limit_sat: '1000' });
      let settled = false;
      const done = (fn, v) => { if (!settled) { settled = true; fn(v); } };
      const req = https.request(
        {
          host: this.host, port: this.port, path: '/v2/router/send', method: 'POST',
          ca: this.ca, servername: this.host,
          headers: {
            'Grpc-Metadata-macaroon': this.mac.admin,
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(payload),
          },
        },
        (res) => {
          let buf = '';
          res.on('data', (chunk) => {
            buf += chunk;
            let i;
            while ((i = buf.indexOf('\n')) >= 0) {
              const line = buf.slice(0, i).trim();
              buf = buf.slice(i + 1);
              if (!line) continue;
              try {
                const msg = JSON.parse(line);
                if (msg.error) done(reject, new Error(msg.error.message || 'payment error'));
                else if (msg.result) {
                  const st = msg.result.status;
                  if (st === 'FAILED') done(reject, new Error(`payment failed: ${msg.result.failure_reason}`));
                  else if (st === 'IN_FLIGHT' || st === 'SUCCEEDED') done(resolve, { status: st });
                }
              } catch { /* partial line */ }
            }
          });
          res.on('end', () => done(reject, new Error(`payment stream closed (HTTP ${res.statusCode}) ${buf.slice(0, 300)}`)));
        },
      );
      req.on('error', (e) => done(reject, e));
      req.write(payload);
      req.end();
    });
  }
}

export async function createLndBackend(config) {
  const nodes = {};
  for (const role of ['seller', 'rider', 'buyer']) {
    nodes[role] = new LndNode(config.lnd[role], config.network);
    await nodes[role].load();
  }

  return {
    mode: 'lnd',

    async createHoldInvoice(role, { hashHex, sats, memo, expirySec }) {
      const r = await nodes[role].request('POST', '/v2/invoices/hodl', {
        hash: hexToB64(hashHex),
        value: String(sats),
        memo: memo.slice(0, 120),
        expiry: String(expirySec),
        cltv_expiry: '144',
      }, 'invoice');
      return { bolt11: r.payment_request };
    },

    async lookup(role, hashHex) {
      const r = await nodes[role].request('GET', `/v1/invoice/${hashHex}`, null, 'invoice');
      return r.state || 'OPEN'; // OPEN | ACCEPTED | SETTLED | CANCELED
    },

    async settle(role, preimageHex) {
      await nodes[role].request('POST', '/v2/invoices/settle', { preimage: hexToB64(preimageHex) }, 'invoice');
    },

    async cancel(role, hashHex) {
      await nodes[role].request('POST', '/v2/invoices/cancel', { payment_hash: hexToB64(hashHex) }, 'invoice');
    },

    async demoPay(bolt11) {
      return nodes.buyer.payStream(bolt11);
    },

    async balances() {
      const out = {};
      for (const role of Object.keys(nodes)) {
        try {
          const { channels = [] } = await nodes[role].request('GET', '/v1/channels');
          let local = 0; let lockedOut = 0; let lockedIn = 0;
          for (const c of channels) {
            local += Number(c.local_balance || 0);
            for (const htlc of c.pending_htlcs || []) {
              if (htlc.incoming) lockedIn += Number(htlc.amount); else lockedOut += Number(htlc.amount);
            }
          }
          out[role] = { sats: local, lockedOut, lockedIn };
        } catch (e) {
          out[role] = { error: e.message };
        }
      }
      return out;
    },

    async info() {
      const list = [];
      for (const role of Object.keys(nodes)) {
        try {
          const i = await nodes[role].request('GET', '/v1/getinfo');
          list.push({ role, alias: i.alias, pubkey: i.identity_pubkey, synced: i.synced_to_chain, channels: i.num_active_channels });
        } catch (e) {
          list.push({ role, error: e.message });
        }
      }
      return list;
    },
  };
}
