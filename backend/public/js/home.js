import { $, h, api, sats, poll, t } from './common.js';

poll(async () => {
  const net = await api('GET', '/api/network');
  $('#netmode').textContent = t(net.mode === 'mock' ? 'home.net.mock' : 'home.net.lnd');
  const grid = $('#netgrid');
  grid.replaceChildren(
    ...['buyer', 'seller', 'rider'].map((role) => {
      const b = net.balances[role] || {};
      const locked = (b.lockedOut || 0) + (b.lockedIn || 0);
      return h('div', {},
        h('b', {}, t(`role.${role}`)),
        b.error ? t('offline') : sats(b.sats || 0),
        locked ? h('div', { class: 'lockedln' }, `🔒 ${sats(locked)}`) : null,
      );
    }),
  );
}, 3000);
