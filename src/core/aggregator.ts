import { providerManager } from './providerManager';
import { metadataService } from './metadataService';
import { wrapProxyUrl } from '../utils/mediaflow';
import { db } from '../utils/db';
import { MediaItem, Stream, Meta } from '../types';

export class Aggregator {
  public async getStreams(type: string, id: string): Promise<Stream[]> {
    const cached = this.getFromCache(`streams:${id}`);
    if (cached) return cached;

    let mediaItem: MediaItem;

    if (id.startsWith('agg:')) {
      const afterAgg = id.slice('agg:'.length);
      const colonIdx = afterAgg.indexOf(':');
      if (colonIdx === -1) return [];
      const providerId = afterAgg.slice(0, colonIdx);

      const providers = providerManager.getEnabledProviders();
      const provider = providers.find(p => p.id === providerId);
      if (!provider) return [];

      if (!provider.resolveMediaItem) return [];
      const resolved = await provider.resolveMediaItem(id, type).catch(() => null);
      if (!resolved) return [];
      mediaItem = resolved;
    } else {
      // IMDB/BGM IDs — look up via metadataService
      const meta = await metadataService.getMeta(id, type);
      if (!meta) return [];

      mediaItem = { ...meta } as MediaItem;

      if (type !== 'movie') {
        const idParts = id.split(':');
        if (idParts.length > 2) {
          mediaItem.season = parseInt(idParts[1]) || 1;
          mediaItem.episode = parseInt(idParts[2]) || 1;
        }
      }
    }

    const providers = providerManager.getEnabledProviders();
    const streamPromises = providers.map(async (p) => {
      try {
        const streams = await p.getStreams(mediaItem);
        return streams.map(s => {
          if (s.url && s.headers) {
            return {
              ...s,
              url: wrapProxyUrl(s.url, s.headers)
            };
          }
          return s;
        });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`[Aggregator] Provider ${p.id} failed:`, message);
        return [];
      }
    });

    const results = await Promise.all(streamPromises);
    const flattened = results.flat();

    const filtered = flattened.filter(s => {
      const match = s.name?.match(/\[(\d+)p/);
      if (match) {
        const res = parseInt(match[1]);
        return res >= 720;
      }
      // If no quality tag found, keep it if it's 'Auto' or similar, but 
      // generally we expect our providers to tag them now.
      return true;
    });

    const sorted = filtered.sort((a, b) => {
      const getRes = (name: string) => {
        const match = name.match(/\[(\d+)p/);
        return match ? parseInt(match[1]) : 0;
      };
      const resA = getRes(a.name || '');
      const resB = getRes(b.name || '');

      if (resA !== resB) return resB - resA; // Higher resolution first

      // Fallback for 4K etc
      if ((a.name || '').includes('4K')) return -1;
      if ((b.name || '').includes('4K')) return 1;

      return 0;
    });

    if (sorted.length > 0) {
      this.saveToCache(`streams:${id}`, sorted);
    }

    return sorted;
  }

  public async getCatalog(type: string, id: string, extra: any): Promise<Meta[]> {
    const providers = providerManager.getEnabledProviders();

    // For search queries, aggregate across all providers
    if (extra?.search) {
      const catalogPromises = providers.map(async (p) => {
        if (p.getCatalog) {
          try {
            return await p.getCatalog(type, extra);
          } catch (err) {
            console.error(`[Aggregator] Provider ${p.id} catalog failed:`, err);
            return [];
          }
        }
        return [];
      });

      const results = await Promise.all(catalogPromises);
      const flattened = results.flat();

      // Deduplicate by name
      const seen = new Set<string>();
      return flattened.filter(m => {
        if (seen.has(m.name)) return false;
        seen.add(m.name);
        return true;
      });
    }

    // For homepage catalog, use only animekhor (popular page)
    const animekhor = providers.find(p => p.id === 'animekhor');
    if (animekhor?.getCatalog) {
      try {
        return await animekhor.getCatalog(type, extra);
      } catch (err) {
        console.error(`[Aggregator] Animekhor catalog failed:`, err);
        return [];
      }
    }

    return [];
  }

  public async getMeta(type: string, id: string): Promise<Meta | null> {
    const cached = db.get(`meta:${id}`) as Meta | null;
    if (cached) return cached;

    const providers = providerManager.getEnabledProviders();
    if (id.startsWith('agg:')) {
      const afterAgg = id.slice('agg:'.length);
      const colonIdx = afterAgg.indexOf(':');
      if (colonIdx === -1) return null;
      const providerId = afterAgg.slice(0, colonIdx);
      const internalId = afterAgg.slice(colonIdx + 1);

      const provider = providers.find(p => p.id === providerId);
      if (provider && provider.getMeta) {
        try {
          const meta = await provider.getMeta(internalId, type);
          if (meta) db.set(`meta:${id}`, meta, 3600);
          return meta;
        } catch (err) {
          console.error(`[Aggregator] Provider ${providerId} getMeta failed:`, err);
          return null;
        }
      }
    }
    return null;
  }

  private getFromCache(id: string): Stream[] | null {
    return db.get(id) as Stream[] | null;
  }

  private saveToCache(id: string, data: Stream[]) {
    const ttl = 3600; // 1 hour
    db.set(id, data, ttl);
  }
}

export const aggregator = new Aggregator();
