import { addonBuilder } from 'stremio-addon-sdk';
import { aggregator } from './core/aggregator';
import { metadataService } from './core/metadataService';
import { getDonghuafunCatalog, getDonghuafunMeta, getDonghuafunStreams } from './providers/donghuafun';

const manifest = {
  id: 'community.aggregator.node',
  version: '1.0.0',
  name: '聚合搜索 (Node)',
  description: '支持动漫、电影、电视剧的优质在线源聚合 (DonghuaFun/Donghuaworld/Animekhor/Donghuastream)',
  resources: [
    'stream',
    'meta',
    'catalog'
  ],
  types: ['movie', 'series'],
  idPrefixes: ['tt', 'bgm', 'dhf:', 'agg:'],
  catalogs: [
    {
      type: 'series',
      id: 'donghua_hot',
      name: '热门国漫',
      extra: [{ name: 'search', isRequired: false }]
    }
  ]
};


const builder = new addonBuilder(manifest);

builder.defineStreamHandler(async ({ type, id }) => {
  console.log(`[Addon] Stream request: ${type} ${id}`);

  // Handle dhf: IDs — format: dhf:<vodId>:<dmVideoId>
  if (id.startsWith('dhf:')) {
    const parts = id.split(':');
    if (parts.length < 3) return { streams: [] };
    const vodId = parts[1];
    const dmVideoId = parts[2];
    const streams = await getDonghuafunStreams(vodId, dmVideoId);
    return { streams };
  }

  // Handle IMDB/BGM IDs through the aggregator
  const streams = await aggregator.getStreams(type, id);
  return { streams };
});

builder.defineMetaHandler(async ({ type, id }) => {
  console.log(`[Addon] Meta request: ${type} ${id}`);

  // Handle dhf: IDs
  if (id.startsWith('dhf:')) {
    const vodId = id.replace('dhf:', '').split(':')[0];
    const meta = await getDonghuafunMeta(vodId);
    if (!meta) return { meta: null };
    return { meta };
  }

  // Handle agg: IDs
  if (id.startsWith('agg:')) {
    const meta = await aggregator.getMeta(type, id);
    if (!meta) return { meta: null };
    return { meta };
  }

  // Handle IMDB/BGM IDs
  const meta = await metadataService.getMeta(id, type);
  if (!meta) return { meta: null };

  return {
    meta: {
      id: meta.id,
      type: meta.type,
      name: meta.title,
      poster: '', 
      background: '',
      description: '',
    }
  };
});

builder.defineCatalogHandler(async ({ type, id, extra }) => {
  console.log(`[Addon] Catalog request: ${type} ${id} ${JSON.stringify(extra)}`);

  // Aggregated catalog (and search)
  if (id === 'donghua_hot' || (extra && extra.search)) {
    const metas = await aggregator.getCatalog(type, id, extra);
    return { metas };
  }
  return { metas: [] };
});

export const addonInterface = builder.getInterface();
