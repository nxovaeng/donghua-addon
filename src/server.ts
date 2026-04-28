
import { serveHTTP } from 'stremio-addon-sdk';
import { addonInterface } from './addon';
import { config } from './config';
import { initializeAggregators } from './core/providerRegistry';

async function start() {
  console.log('[Server] Initializing...');

  // 初始化所有聚合器
  initializeAggregators();

  // Start Stremio Addon server
  serveHTTP(addonInterface, { port: parseInt(config.PORT) });

  console.log(`[Server] Addon active at http://localhost:${config.PORT}/manifest.json`);
}

start().catch(err => {
  console.error('[Server] Critical failure:', err);
  process.exit(1);
});
