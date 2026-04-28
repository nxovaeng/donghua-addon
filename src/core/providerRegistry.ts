import animekhorProvider from '../providers/animekhor';
import donghuafunProvider from '../providers/donghuafun';
import donghuastreamProvider from '../providers/donghuastream';
import donghuaworldProvider from '../providers/donghuaworld';
import netmirrorProvider from '../providers/netmirror';
import superstreamProvider from '../providers/superstream';
import vidlinkProvider from '../providers/vidlink';
import dadaquProvider from '../providers/dadaqu';
import pipishiProvider from '../providers/pipishi';
import { Provider, AggregatorConfig } from '../types';
import { registerAggregator } from './aggregator';
import { activeAggregators } from '../config';

/**
 * 供应商分类 - 按地域/类型组织
 */
export const movieProviders: Provider[] = [
  vidlinkProvider,
  dadaquProvider,
  pipishiProvider,
];

export const seriesProviders: Provider[] = [
  donghuafunProvider,
  donghuastreamProvider,
  donghuaworldProvider,
  animekhorProvider,
  superstreamProvider,
  netmirrorProvider,
  dadaquProvider,
  pipishiProvider,
];

export const providerMap = new Map<string, Provider>(
  [...movieProviders, ...seriesProviders].map((provider) => [provider.id, provider])
);

export function getProvidersByType(type: string): Provider[] {
  return type === 'movie' ? movieProviders : seriesProviders;
}

export function getProviderById(providerId: string): Provider | undefined {
  return providerMap.get(providerId);
}

export function getEnabledAggregatorConfigs(): AggregatorConfig[] {
  return activeAggregators.length > 0
    ? aggregatorConfigs.filter((config) => activeAggregators.includes(config.name))
    : [...aggregatorConfigs];
}

/**
 * 聚合器配置定义
 * 支持按地域/内容类型/来源进行不同的聚合策略
 */
const aggregatorConfigs: AggregatorConfig[] = [
  {
    name: 'overseas-anime',
    displayName: '海外动漫',
    supportedTypes: ['series'],
    providerIds: ['animekhor', 'superstream'],
    region: 'overseas',
    priority: 100,
  },
  {
    name: 'hot-anime',
    displayName: '热门动漫',
    supportedTypes: ['series'],
    providerIds: ['donghuafun', 'donghuastream', 'donghuaworld', 'animekhor'],
    region: 'mainland',
    priority: 100,
  },
  {
    name: 'hot-movies',
    displayName: '热门电影',
    supportedTypes: ['movie'],
    providerIds: ['superstream', 'vidlink'],
    region: 'auto',
    priority: 100,
    homeSource: 'tmdb',
  },
  {
    name: 'dadaqu',
    displayName: 'Dadaqu 影视',
    supportedTypes: ['movie', 'series'],
    providerIds: ['dadaqu'],
    region: 'mainland',
    priority: 90,
  },
  {
    name: 'pipishi',
    displayName: 'PiPiShi 影视',
    supportedTypes: ['movie', 'series'],
    providerIds: ['pipishi'],
    region: 'mainland',
    priority: 80,
  },
];

/**
 * 初始化所有聚合器
 */
export function initializeAggregators() {
  const aggregators: { movie: any; series: any } = { movie: null, series: null };
  const enabledConfigs = activeAggregators.length > 0
    ? aggregatorConfigs.filter((config) => activeAggregators.includes(config.name))
    : aggregatorConfigs;

  if (activeAggregators.length > 0) {
    const unknownNames = activeAggregators.filter((name) => !aggregatorConfigs.some((config) => config.name === name));
    if (unknownNames.length > 0) {
      console.warn(`[ProviderRegistry] Unknown active aggregator names: ${unknownNames.join(', ')}`);
    }
  }

  enabledConfigs.forEach(config => {
    const providers = config.providerIds
      .map(id => providerMap.get(id))
      .filter((p): p is Provider => p !== undefined);

    if (providers.length === 0) {
      console.warn(`[ProviderRegistry] No providers found for aggregator: ${config.name}`);
      return;
    }

    const agg = registerAggregator(config.name, config, providers);

    // 设置旧版向后兼容的引用
    if (config.name === 'mainland-anime' || config.name === 'mixed-anime') {
      if (!aggregators.series) aggregators.series = agg;
    }
    if (config.name === 'mainstream-movies') {
      aggregators.movie = agg;
    }
  });

  // 如果没有设置默认的 movie/series aggregator，使用第一个匹配的
  if (!aggregators.movie) {
    const movieAgg = aggregatorConfigs
      .find(c => c.supportedTypes.includes('movie'));
    if (movieAgg) {
      const providers = movieAgg.providerIds
        .map(id => providerMap.get(id))
        .filter((p): p is Provider => p !== undefined);
      aggregators.movie = registerAggregator(movieAgg.name, movieAgg, providers);
    }
  }

  if (!aggregators.series) {
    const seriesAgg = aggregatorConfigs
      .find(c => c.supportedTypes.includes('series') && c.region === 'auto');
    if (seriesAgg) {
      const providers = seriesAgg.providerIds
        .map(id => providerMap.get(id))
        .filter((p): p is Provider => p !== undefined);
      aggregators.series = registerAggregator(seriesAgg.name, seriesAgg, providers);
    }
  }

}
