// Verified-delivery reviews as Nostr events.
// A review carries the payment preimage. Anyone can check sha256(preimage) == payment hash,
// which proves the reviewer held the secret, i.e. actually paid and received the goods.
// Fake reviews are impossible without a real, settled delivery.
import { finalizeEvent, generateSecretKey, getPublicKey, verifyEvent } from 'nostr-tools/pure';
import { Relay } from 'nostr-tools/relay';
import * as nip19 from 'nostr-tools/nip19';
import { sha256Hex } from './validate.js';

const hexToBytes = (h) => Uint8Array.from(Buffer.from(h, 'hex'));

export const REVIEW_KIND = 1; // plain note so any Nostr client shows it; tagged for filtering
export const REVIEW_TAG = 'gem-verified-delivery';

export function createNostr(config) {
  // Notary key: used only when the buyer has no Nostr extension (NIP-07).
  const sk = config.nostrNotarySecretHex ? hexToBytes(config.nostrNotarySecretHex) : generateSecretKey();
  const notaryPubkey = getPublicKey(sk);

  function buildTemplate({ order, sellerName, stars, text, preimage }) {
    return {
      kind: REVIEW_KIND,
      created_at: Math.floor(Date.now() / 1000),
      tags: [
        ['t', REVIEW_TAG],
        ['x', order.paymentHash],
        ['preimage', preimage],
        ['rating', String(stars), '5'],
        ['seller', order.sellerId, sellerName],
      ],
      content: `${'★'.repeat(stars)}${'☆'.repeat(5 - stars)} ${text}\n\nVerified delivery via Gëm. Check: sha256(preimage) == x`,
    };
  }

  // Validates a review event, whoever signed it.
  function verifyReview(ev, order) {
    if (!ev || typeof ev !== 'object' || !verifyEvent(ev)) return 'invalid signature';
    const tag = (k) => ev.tags?.find((t) => t[0] === k)?.[1];
    if (tag('t') !== REVIEW_TAG) return 'missing gem tag';
    if (tag('x') !== order.paymentHash) return 'wrong payment hash';
    const pre = tag('preimage');
    if (!pre || sha256Hex(pre) !== order.paymentHash) return 'preimage does not match payment hash';
    return null;
  }

  async function publish(ev) {
    const results = [];
    for (const url of config.nostrRelays) {
      try {
        const relay = await Promise.race([
          Relay.connect(url),
          new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 5000)),
        ]);
        await Promise.race([relay.publish(ev), new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 5000))]);
        relay.close();
        results.push({ url, ok: true });
      } catch (e) {
        results.push({ url, ok: false, error: e.message });
      }
    }
    return results;
  }

  return {
    notaryPubkey,
    notaryNpub: nip19.npubEncode(notaryPubkey),
    buildTemplate,
    signAsNotary: (tpl) => finalizeEvent(tpl, sk),
    verifyReview,
    publish,
    npub: (hex) => nip19.npubEncode(hex),
  };
}
