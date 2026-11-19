import { createMockBackend } from './mock.js';
import { createLndBackend } from './lnd.js';

export async function createLightning(config) {
  if (config.lnBackend === 'lnd') return createLndBackend(config);
  return createMockBackend();
}
