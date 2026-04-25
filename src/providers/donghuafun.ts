import axios from 'axios';
import * as cheerio from 'cheerio';
import { Provider, MediaItem, Stream, Meta } from '../types';
import { resolveDailymotionHLS } from '../utils/dailymotion';
import { buildHlsProxyUrl } from '../utils/mediaflow';

const SITE_CONFIG = {
  id: 'donghuafun',
  name: 'DonghuaFun',
  mainUrl: 'https://donghuafun.com',
  apiBase: 'https://donghuafun.com/api.php/provide/vod/at/json',
  lang: 'zh',
};

const DEFAULT_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
  'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
};

// ── MacCMS API types ──────────────────────────────────────────────────────────

interface MacCmsItem {
  vod_id: number;
  vod_name: string;
  vod_pic?: string;
  vod_pic_slide?: string;
  vod_content?: string;
  vod_blurb?: string;
  vod_year?: string;
  vod_class?: string;
  vod_remarks?: string;
  vod_play_from?: string;
  vod_play_url?: string;
  vod_time_add?: number;
}

interface MacCmsResponse {
  list: MacCmsItem[];
  total: number;
  pagecount: number;
  page: number;
}

// ── MacCMS API helpers ────────────────────────────────────────────────────────

async function maccmsSearch(query: string): Promise<MacCmsResponse> {
  const url = `${SITE_CONFIG.apiBase}?ac=list&t=20&wd=${encodeURIComponent(query)}`;
  const res = await axios.get(url, { headers: DEFAULT_HEADERS, timeout: 10000 });

  if (res.data && res.data.list && res.data.list.length > 0) {
    return res.data;
  }

  // Fallback to HTML search for Chinese queries
  try {
    const htmlUrl = `${SITE_CONFIG.mainUrl}/index.php/vod/search.html?wd=${encodeURIComponent(query)}`;
    const htmlRes = await axios.get(htmlUrl, { headers: DEFAULT_HEADERS, timeout: 10000 });
    const $ = cheerio.load(htmlRes.data);
    const list: MacCmsItem[] = [];

    $('.public-list-exp').each((_, el) => {
      const href = $(el).attr('href');
      const title = $(el).attr('title') || '';
      if (href && href.includes('/vod/detail/id/')) {
        const idMatch = href.match(/id\/(\d+)\.html/);
        if (idMatch) {
          list.push({
            vod_id: parseInt(idMatch[1]),
            vod_name: title
          });
        }
      }
    });

    if (list.length > 0) {
      return { list, total: list.length, pagecount: 1, page: 1 };
    }
  } catch (err) {
    console.error(`[${SITE_CONFIG.name}] HTML search fallback failed:`, err);
  }

  return res.data;
}

async function maccmsDetail(ids: number | number[]): Promise<MacCmsResponse> {
  const idStr = Array.isArray(ids) ? ids.join(',') : String(ids);
  const url = `${SITE_CONFIG.apiBase}?ac=detail&ids=${idStr}`;
  const res = await axios.get(url, { headers: DEFAULT_HEADERS, timeout: 10000 });
  return res.data;
}

async function maccmsList(page: number = 1): Promise<MacCmsResponse> {
  const url = `${SITE_CONFIG.apiBase}?ac=detail&t=20&pg=${page}`;
  const res = await axios.get(url, { headers: DEFAULT_HEADERS, timeout: 10000 });
  return res.data;
}

// ── Episode parsing ───────────────────────────────────────────────────────────

interface ParsedEpisode {
  name: string;
  dmVideoId: string;
  episodeNumber: number;
}

function parseEpNumber(epName: string): number {
  if (!epName) return 0;
  const m = epName.match(/(\d+)/);
  return m ? parseInt(m[1]) : 0;
}

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]*>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();
}

/**
 * Parse Dailymotion episodes from a MacCMS detail item.
 * Returns episodes from the 'dailymotion' source only.
 */
function parseDailymotionEpisodes(item: MacCmsItem): ParsedEpisode[] {
  const sources = (item.vod_play_from || '').split('$$$');
  const urlBlocks = (item.vod_play_url || '').split('$$$');

  const dmIndex = sources.findIndex(s => s.toLowerCase() === 'dailymotion');
  if (dmIndex === -1) return [];

  const dmBlock = urlBlocks[dmIndex] || '';
  const episodes = dmBlock.split('#').filter(Boolean);

  return episodes.map(ep => {
    const [epName, dmId] = ep.split('$');
    return {
      name: epName || dmId,
      dmVideoId: dmId,
      episodeNumber: parseEpNumber(epName),
    };
  });
}

// ── Catalog & Meta helpers ────────────────────────────────────────────────────

async function getCatalog(search?: string, skip: number = 0): Promise<Meta[]> {
  try {
    let listData: MacCmsResponse;

    if (search) {
      listData = await maccmsSearch(search);
    } else {
      const page = Math.floor(skip / 200) + 1;
      listData = await maccmsList(page);
    }

    const items = listData.list || [];
    if (items.length === 0) return [];

    // videolist already returns full detail including vod_pic,
    // but search fallback (HTML) only returns IDs — fetch detail if needed
    let finalItems = items;
    if (!finalItems[0]?.vod_pic) {
      const ids = finalItems.map(i => i.vod_id);
      const detailData = await maccmsDetail(ids);
      finalItems = detailData.list || [];
    }

    return finalItems.map(item => ({
      id: `dhf:${item.vod_id}`,
      type: 'series',
      name: item.vod_name,
      poster: item.vod_pic || undefined,
      posterShape: 'poster',
      description: item.vod_remarks || '',
    }));
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[${SITE_CONFIG.name}] Catalog error: ${message}`);
    return [];
  }
}

async function getMetaById(vodId: string): Promise<Meta | null> {
  try {
    const data = await maccmsDetail(parseInt(vodId));
    const item = (data.list || [])[0];
    if (!item) return null;

    const meta: any = {
      id: `dhf:${item.vod_id}`,
      type: 'series',
      name: item.vod_name,
      poster: item.vod_pic || undefined,
      posterShape: 'poster',
      background: item.vod_pic_slide
        ? (item.vod_pic_slide.startsWith('http')
          ? item.vod_pic_slide
          : `${SITE_CONFIG.mainUrl}/${item.vod_pic_slide.replace(/^\//, '')}`)
        : undefined,
      description: stripHtml(item.vod_content || item.vod_blurb || ''),
      year: item.vod_year ? parseInt(item.vod_year) : undefined,
      videos: [],
    };

    const episodes = parseDailymotionEpisodes(item);
    const baseTs = item.vod_time_add ? item.vod_time_add * 1000 : Date.now();

    meta.videos = episodes.map((ep, idx) => ({
      id: `dhf:${item.vod_id}:${ep.dmVideoId}`,
      title: ep.name || ep.dmVideoId,
      season: 1,
      episode: ep.episodeNumber,
      released: new Date(baseTs + idx * 86400000).toISOString(),
    })).reverse();

    return meta;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[${SITE_CONFIG.name}] Meta error: ${message}`);
    return null;
  }
}

// ── Provider implementation ───────────────────────────────────────────────────

const donghuafunProvider: Provider = {
  id: SITE_CONFIG.id,
  name: SITE_CONFIG.name,
  enabled: true,
  weight: 100,

  async search(query: string, type: string): Promise<MediaItem[]> {
    const metas = await getCatalog(query);
    return metas.map(m => ({
      id: m.id,
      type: 'series' as const,
      title: m.name,
    }));
  },

  async getCatalog(type: string, extra: any): Promise<Meta[]> {
    return await getCatalog(extra?.search, extra?.skip ? parseInt(extra.skip) : 0);
  },

  async getMeta(id: string, type: string): Promise<Meta | null> {
    const vodId = id.split(':')[0];
    return await getMetaById(vodId);
  },

  async getStreams(item: MediaItem): Promise<Stream[]> {
    const epLog = item.episode ? ` S${item.season || 1}E${item.episode}` : '';
    console.log(`[${SITE_CONFIG.name}] Requesting streams for: ${item.title}${epLog} (ID: ${item.id})`);

    try {
      // Step 1: Search by title (with fallback aliases)
      let searchData: MacCmsResponse | null = null;
      const searchQueries = [item.title, ...(item.aliases || [])];

      for (const query of searchQueries) {
        if (!query) continue;
        const data = await maccmsSearch(query);
        if (data.list && data.list.length > 0) {
          searchData = data;
          break;
        }
      }

      if (!searchData || !searchData.list || searchData.list.length === 0) {
        console.log(`[${SITE_CONFIG.name}] No results for: ${item.title}`);
        return [];
      }

      // Step 2: Get detail for all matching items
      const ids = searchData.list.map(i => i.vod_id);
      const detailData = await maccmsDetail(ids);
      if (!detailData.list || detailData.list.length === 0) {
        return [];
      }

      // Step 3: Find the best match and parse episodes
      const streams: Stream[] = [];

      for (const vodItem of detailData.list) {
        const episodes = parseDailymotionEpisodes(vodItem);
        if (episodes.length === 0) continue;

        const targetEp = item.episode || 1;
        const matchedEp = episodes.find(ep => ep.episodeNumber === targetEp);
        if (!matchedEp) {
          // If no exact episode match and it's a movie/no episode specified, use first
          if (!item.episode && episodes.length > 0) {
            const firstEp = episodes[0];
            const resolved = await resolveDailymotionHLS(firstEp.dmVideoId);
            if (resolved) {
              streams.push({
                url: buildHlsProxyUrl(resolved.url, {
                  referer: 'https://www.dailymotion.com/',
                  origin: 'https://www.dailymotion.com',
                  userAgent: DEFAULT_HEADERS['User-Agent'],
                  maxRes: true,
                }),
                name: `[${resolved.quality}] ${SITE_CONFIG.name}`,
                description: `Dailymotion · via MediaFlow`,
              });
            } else {
              console.log(`[${SITE_CONFIG.name}] Could not resolve DM stream for ${firstEp.dmVideoId}`);
            }
          }
          continue;
        }

        // Step 4: Resolve Dailymotion HLS
        const resolved = await resolveDailymotionHLS(matchedEp.dmVideoId);
        if (resolved) {
          streams.push({
            url: buildHlsProxyUrl(resolved.url, {
              referer: 'https://www.dailymotion.com/',
              origin: 'https://www.dailymotion.com',
              userAgent: DEFAULT_HEADERS['User-Agent'],
              maxRes: true,
            }),
            name: `[${resolved.quality}] ${SITE_CONFIG.name}`,
            description: `Dailymotion · via MediaFlow`,
          });
        } else {
          console.log(`[${SITE_CONFIG.name}] Could not resolve DM stream for ${matchedEp.dmVideoId}`);
        }
      }

      return streams;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[${SITE_CONFIG.name}] Error:`, message);
      return [];
    }
  },
};

// ── Exported aliases for addon.ts ─────────────────────────────────────────────

export { getCatalog as getDonghuafunCatalog };
export { getMetaById as getDonghuafunMeta };

export async function getDonghuafunStreams(vodId: string, dmVideoId: string): Promise<Stream[]> {
  try {
    const resolved = await resolveDailymotionHLS(dmVideoId);
    if (!resolved) {
      console.error(`[${SITE_CONFIG.name}] Could not resolve DM stream for ${dmVideoId}`);
      return [];
    }

    const streamUrl = buildHlsProxyUrl(resolved.url, {
      referer: 'https://www.dailymotion.com/',
      origin: 'https://www.dailymotion.com',
      userAgent: DEFAULT_HEADERS['User-Agent'],
      maxRes: true,
    });

    return [{
      url: streamUrl,
      name: `[${resolved.quality}] ${SITE_CONFIG.name}`,
      description: `Dailymotion · via MediaFlow`,
    }];
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[${SITE_CONFIG.name}] Stream error: ${message}`);
    return [];
  }
}

export default donghuafunProvider;
