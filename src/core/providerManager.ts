import fs from 'fs';
import path from 'path';
import chokidar from 'chokidar';
import { Provider } from '../types';

export class ProviderManager {
  private providers: Map<string, Provider> = new Map();
  private providersPath: string;

  constructor(providersPath: string) {
    this.providersPath = providersPath;
    if (!fs.existsSync(this.providersPath)) {
      fs.mkdirSync(this.providersPath, { recursive: true });
    }
  }

  public async loadAll() {
    const files = fs.readdirSync(this.providersPath);
    for (const file of files) {
      if (file.endsWith('.js') || file.endsWith('.ts')) {
        await this.loadProvider(path.join(this.providersPath, file));
      }
    }
    this.setupWatcher();
  }

  private async loadProvider(filePath: string) {
    try {
      // Clear cache for hot-reload
      const resolvedPath = require.resolve(filePath);
      delete require.cache[resolvedPath];
      const module = require(resolvedPath);
      const provider: Provider = module.default || module;

      if (provider && provider.id && typeof provider.getStreams === 'function') {
        this.providers.set(provider.id, provider);
        console.log(`[ProviderManager] Loaded: ${provider.name} (${provider.id})`);
      } else {
        console.warn(`[ProviderManager] Invalid provider at ${filePath}`);
      }
    } catch (err) {
      console.error(`[ProviderManager] Failed to load provider at ${filePath}:`, err);
    }
  }

  private setupWatcher() {
    chokidar.watch(this.providersPath).on('change', (filePath) => {
      console.log(`[ProviderManager] File changed: ${filePath}, reloading...`);
      this.loadProvider(filePath);
    });
  }

  public getEnabledProviders(): Provider[] {
    return Array.from(this.providers.values())
      .filter((p) => p.enabled)
      .sort((a, b) => (b.weight || 0) - (a.weight || 0));
  }
}

export const providerManager = new ProviderManager(path.join(__dirname, '../providers'));
