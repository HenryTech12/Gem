import { $, h, api, sats, poll } from './common.js';

poll(async () => {
  const net = await api('GET', '/api/network');
  $('#netmode').textContent = net.mode === 'mock' ? 'simulated' : 'regtest LND';
  const grid = $('#netgrid');
  grid.replaceChildren(
    ...['buyer', 'seller', 'rider'].map((role) => {
      const b = net.balances[role] || {};
      const locked = (b.lockedOut || 0) + (b.lockedIn || 0);
      return h('div', {},
        h('b', {}, { buyer: '🙋 Buyer', seller: '🛍️ Seller', rider: '🛵 Rider' }[role]),
        b.error ? 'offline' : sats(b.sats || 0),
        locked ? h('div', { class: 'lockedln' }, `🔒 ${sats(locked)}`) : null,
      );
    }),
  );
}, 3000);
