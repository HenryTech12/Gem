// In-memory simulation of three Lightning nodes with real hold-invoice semantics:
// OPEN -> (buyer pays) -> ACCEPTED (funds locked) -> SETTLED (with preimage) | CANCELED (refund).
// Lets you run and demo the whole app with `npm start`, no Docker, no Bitcoin node.
import crypto from 'node:crypto';

const sha256Hex = (hex) => crypto.createHash('sha256').update(Buffer.from(hex, 'hex')).digest('hex');

export function createMockBackend() {
  const invoices = new Map(); // key `${role}:${hash}`
  const byBolt11 = new Map();
  const bal = {
    buyer: { sats: 5_000_000, lockedOut: 0, lockedIn: 0 },
    seller: { sats: 0, lockedOut: 0, lockedIn: 0 },
    rider: { sats: 0, lockedOut: 0, lockedIn: 0 },
  };

  const get = (role, hash) => {
    const inv = invoices.get(`${role}:${hash}`);
    if (!inv) throw new Error(`mock ${role}: invoice not found`);
    return inv;
  };

  return {
    mode: 'mock',

    async createHoldInvoice(role, { hashHex, sats }) {
      const key = `${role}:${hashHex}`;
      if (invoices.has(key)) throw new Error('invoice with that hash already exists');
      const bolt11 = `lnbcrt${sats}0n1mock${role}${hashHex.slice(0, 16)}${crypto.randomBytes(16).toString('hex')}`;
      const inv = { role, hash: hashHex, sats, state: 'OPEN', bolt11 };
      invoices.set(key, inv);
      byBolt11.set(bolt11, inv);
      return { bolt11 };
    },

    async lookup(role, hashHex) {
      return get(role, hashHex).state;
    },

    async settle(role, preimageHex) {
      const inv = get(role, sha256Hex(preimageHex));
      if (inv.state !== 'ACCEPTED') throw new Error(`cannot settle invoice in state ${inv.state}`);
      inv.state = 'SETTLED';
      bal.buyer.lockedOut -= inv.sats;
      bal[role].lockedIn -= inv.sats;
      bal[role].sats += inv.sats;
    },

    async cancel(role, hashHex) {
      const inv = get(role, hashHex);
      if (inv.state === 'SETTLED') throw new Error('invoice already settled');
      if (inv.state === 'ACCEPTED') {
        bal.buyer.lockedOut -= inv.sats;
        bal.buyer.sats += inv.sats; // refund
        bal[role].lockedIn -= inv.sats;
      }
      inv.state = 'CANCELED';
    },

    async demoPay(bolt11) {
      const inv = byBolt11.get(bolt11);
      if (!inv) throw new Error('unknown invoice');
      if (inv.state !== 'OPEN') throw new Error(`invoice is ${inv.state}`);
      if (bal.buyer.sats < inv.sats) throw new Error('insufficient balance');
      bal.buyer.sats -= inv.sats;
      bal.buyer.lockedOut += inv.sats;
      bal[inv.role].lockedIn += inv.sats;
      inv.state = 'ACCEPTED';
      return { status: 'IN_FLIGHT' };
    },

    async balances() {
      return structuredClone(bal);
    },

    async info() {
      return ['seller', 'rider', 'buyer'].map((role) => ({ role, alias: `${role} (mock)`, synced: true, channels: 1 }));
    },
  };
}
