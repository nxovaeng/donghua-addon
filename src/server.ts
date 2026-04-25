
import { serveHTTP } from 'stremio-addon-sdk';
import { addonInterface } from './addon';
import { providerManager } from './core/providerManager';
import { config } from './config';
import { purgeExpired } from './utils/db';

async function start() {
  console.log('[Server] Initializing...');

  // Load providers
  await providerManager.loadAll();

  // Start periodic cleanup
  setInterval(purgeExpired, 3600 * 1000);

  // Start Stremio Addon server
  serveHTTP(addonInterface, { port: parseInt(config.PORT) });

  console.log(`[Server] Addon active at http://localhost:${config.PORT}/manifest.json`);
}

start().catch(err => {
  console.error('[Server] Critical failure:', err);
  process.exit(1);
});
