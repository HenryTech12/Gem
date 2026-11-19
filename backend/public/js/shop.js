// Public shop page with verified reviews. Anyone can re-check each proof in their own browser.
import { $, h, api, sha256Hex, t } from './common.js';
import { locale } from './i18n.js';

const root = $('#root');
const id = location.pathname.split('/').pop();

async function load() {
  const s = await api('GET', `/api/sellers/${id}`);
  root.replaceChildren(
    h('h1', {}, `🛍️ ${s.name}`),
    h('div', { class: 'card' },
      h('p', { class: 'amount' }, s.rating ? `★ ${s.rating.toFixed(1)}` : t('shop.new')),
      h('p', {}, `${t(s.delivered === 1 ? 'trust.one' : 'trust.many', { n: s.delivered })} · ${t(s.reviews.length === 1 ? 'shop.review.one' : 'shop.review.many', { n: s.reviews.length })}`),
      h('p', { class: 'small muted' }, t('shop.sub')),
    ),
    ...(s.reviews.length ? s.reviews.map((r) => {
      const out = h('span', { class: 'small' });
      const b = h('button', { class: 'small secondary' }, t('shop.verify'));
      b.addEventListener('click', async () => {
        const ok = (await sha256Hex(r.preimage)) === r.paymentHash;
        out.textContent = ` ${t(ok ? 'shop.valid' : 'shop.invalid')}`;
      });
      return h('div', { class: 'card' },
        h('p', {}, `${'★'.repeat(r.stars)}${'☆'.repeat(5 - r.stars)}`),
        r.text ? h('p', {}, `“${r.text}”`) : null,
        h('p', { class: 'small muted' }, `${new Date(r.at).toLocaleDateString(locale)} · Nostr ${r.eventId.slice(0, 10)}… · ${t(r.selfSigned ? 'shop.selfsigned' : 'shop.notarized')}`),
        h('div', { class: 'row' }, b, out),
      );
    }) : [h('p', { class: 'muted' }, t('shop.noreviews'))]),
  );
}

load().catch((e) => root.replaceChildren(h('p', {}, e.message)));
