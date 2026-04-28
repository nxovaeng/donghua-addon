import { addonBuilder } from 'stremio-addon-sdk';
import { getAggregatorByName, getAggregatorByType, getAggregatorByProviderId } from './core/aggregator';
import { getEnabledAggregatorConfigs } from './core/providerRegistry';
import { metadataService } from './core/metadataService';
import { allowedAccessTokens } from './config';

const manifest = {
  id: 'community.aggregator.node',
  version: '1.0.0',
  name: '聚合搜索 (Node)',
  description: '提供动漫、电影、电视剧的优质在线源聚合',
  resources: [
    'stream',
    'meta',
    'catalog'
  ],
  types: ['movie', 'series'],
  idPrefixes: ['tt', 'bgm', 'agg:'],
  catalogs: [
    ...getEnabledAggregatorConfigs().map(config => ({
      type: config.supportedTypes[0],
      id: config.name,
      name: config.displayName,
      extra: [
        { name: 'search', isRequired: false },
        { name: 'skip', isRequired: false }
      ]
    }))
  ],
  behaviorHints: {
    configurable: true,
    configurationRequired: true,
  },
  config: [
    {
      key: 'accessToken',
      type: 'password' as const,
      title: '访问 Token',
      required: true,
    }
  ]
};


const builder = new addonBuilder(manifest);

function isValidAccessToken(config: any): boolean {
  if (!Array.isArray(allowedAccessTokens) || allowedAccessTokens.length === 0) {
    return false;
  }
  if (!config || typeof config.accessToken !== 'string') {
    return false;
  }
  return allowedAccessTokens.includes(config.accessToken);
}

builder.defineStreamHandler(async (args: any) => {
  const { type, id, config } = args;
  console.log(`[Addon] Stream request: ${type} ${id}`);
  if (!isValidAccessToken(config)) {
    console.warn('[Addon] Invalid access token for stream request');
    return { streams: [] };
  }

  let aggregatorRef = getAggregatorByType(type);

  if (!aggregatorRef) {
    console.error(`[Addon] No aggregator found for type: ${type}`);
    return { streams: [] };
  }

  if (id.startsWith('agg:')) {
    const providerId = id.slice('agg:'.length).split(':')[0];
    const providerAgg = getAggregatorByProviderId(providerId);
    if (providerAgg) aggregatorRef = providerAgg;
  }

  const streams = await aggregatorRef.getStreams(type, id);
  return { streams };
});

builder.defineMetaHandler(async ({ type, id }) => {
  console.log(`[Addon] Meta request: ${type} ${id}`);

  if (id.startsWith('agg:')) {
    const providerId = id.slice('agg:'.length).split(':')[0];
    const aggregatorRef = getAggregatorByProviderId(providerId) || getAggregatorByType(type);
    if (!aggregatorRef) return { meta: null };
    const meta = await aggregatorRef.getMeta(type, id);
    if (!meta) return { meta: null };
    return { meta };
  }

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

  let aggregatorRef = getAggregatorByType(type);

  if (!aggregatorRef) {
    console.error(`[Addon] No aggregator found for type: ${type}`);
    return { metas: [] };
  }

  // 对特定目录使用专门的聚合器
  if (id === 'donghua_hot') {
    const donghuaAgg = getAggregatorByName('mainland-anime') || getAggregatorByName('mixed-anime');
    if (donghuaAgg) aggregatorRef = donghuaAgg;
  } else if (id === 'tmdb_popular') {
    const movieAgg = getAggregatorByName('mainstream-movies');
    if (movieAgg) aggregatorRef = movieAgg;
  } else {
    const namedAgg = getAggregatorByName(id);
    if (namedAgg) {
      aggregatorRef = namedAgg;
    }
  }

  if (id === 'donghua_hot' || id === 'tmdb_popular' || getAggregatorByName(id) || (extra && extra.search)) {
    const metas = await aggregatorRef.getCatalog(type, id, extra);
    return { metas };
  }
  return { metas: [] };
});

export const addonInterface = builder.getInterface();
