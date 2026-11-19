// Public shop page with verified reviews. Anyone can re-check each proof in their own browser.
import { $, h, api, sha256Hex } from './common.js';

const root = $('#root');
const id = location.pathname.split('/').pop();

async function load() {
  const s = await api('GET', `/api/sellers/${id}`);
  root.replaceChildren(
    h('h1', {}, `🛍️ ${s.name}`),
    h('div', { class: 'card' },
      h('p', { class: 'amount' }, s.rating ? `★ ${s.rating.toFixed(1)}` : 'New shop'),
      h('p', {}, `✅ ${s.delivered} verified ${s.delivered === 1 ? 'delivery' : 'deliveries'} · ${s.reviews.length} ${s.reviews.length === 1 ? 'review' : 'reviews'}`),
      h('p', { class: 'small muted' }, 'Each review carries the secret that released a real payment. It cannot be faked or bought.'),
    ),
    ...(s.reviews.length ? s.reviews.map((r) => {
      const out = h('span', { class: 'small' });
      const b = h('button', { class: 'small secondary' }, '🔍 Verify proof');
      b.addEventListener('click', async () => {
        const ok = (await sha256Hex(r.preimage)) === r.paymentHash;
        out.textContent = ok ? ' ✅ Proof valid: sha256(secret) matches the payment.' : ' ❌ Proof invalid';
      });
      return h('div', { class: 'card' },
        h('p', {}, `${'★'.repeat(r.stars)}${'☆'.repeat(5 - r.stars)}`),
        r.text ? h('p', {}, `“${r.text}”`) : null,
        h('p', { class: 'small muted' }, `${new Date(r.at).toLocaleDateString()} · Nostr event ${r.eventId.slice(0, 10)}… · ${r.selfSigned ? 'signed by buyer' : 'notarized'}`),
        h('div', { class: 'row' }, b, out),
      );
    }) : [h('p', { class: 'muted' }, 'No reviews yet.')]),
  );
}

load().catch((e) => root.replaceChildren(h('p', {}, e.message)));
