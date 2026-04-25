import axios from 'axios';
import * as cheerio from 'cheerio';
import { Provider, MediaItem, Stream, Meta } from '../types';
import { resolveEmbed } from '../utils/embedResolver';

const SITE_CONFIG = {
    id: 'animekhor',
    name: 'Animekhor',
    mainUrl: 'https://animekhor.org',
    lang: 'zh',
    serverSelector: '.mobius option',
    serverAttr: 'value',
};

const DEFAULT_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
    'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
};

const animekhorProvider: Provider = {
    id: SITE_CONFIG.id,
    name: SITE_CONFIG.name,
    enabled: true,
    weight: 75,

    async search(query: string, type: string): Promise<MediaItem[]> {
        const searchUrl = `${SITE_CONFIG.mainUrl}/?s=${encodeURIComponent(query)}`;
        const searchRes = await axios.get(searchUrl, { headers: DEFAULT_HEADERS, timeout: 10000 });
        const $ = cheerio.load(searchRes.data);
        const results: MediaItem[] = [];
        $('div.listupd > article').each((_, el) => {
            const link = $(el).find('div.bsx > a');
            const title = link.attr('title') || link.text().trim();
            const href = link.attr('href') || '';
            if (title && href) {
                results.push({
                    id: `agg:${SITE_CONFIG.id}:${href}`,
                    type: 'series',
                    title: title,
                });
            }
        });
        return results;
    },

    async getCatalog(type: string, extra: any): Promise<Meta[]> {
        if (extra?.search) {
            const items = await this.search!(extra.search, type);
            return items.map(i => ({
                id: i.id,
                type: 'series',
                name: i.title,
            }));
        }

        try {
            const res = await axios.get(SITE_CONFIG.mainUrl, { headers: DEFAULT_HEADERS, timeout: 10000 });
            const $ = cheerio.load(res.data);
            const metas: any[] = [];
            $('div.listupd > article').each((_, el) => {
                const link = $(el).find('div.bsx > a');
                const title = link.attr('title') || link.text().trim();
                const href = link.attr('href') || '';
                const poster = $(el).find('img').attr('src');
                if (title && href) {
                    metas.push({
                        id: `agg:${SITE_CONFIG.id}:${href}`,
                        type: 'series',
                        name: title,
                        poster: poster,
                    });
                }
            });
            return metas;
        } catch (err) {
            console.error(`[Animekhor] Catalog error:`, err);
            return [];
        }
    },

    async getMeta(id: string, type: string): Promise<Meta | null> {
        try {
            const res = await axios.get(id, { headers: DEFAULT_HEADERS, timeout: 10000 });
            const $ = cheerio.load(res.data);

            const title = $('h1.entry-title').text().trim();
            const poster = $('div.thumb img').attr('src');
            const background = $('div.bigcontent').attr('style')?.match(/url\(['"]?([^'"]+)['"]?\)/)?.[1];
            const description = $('div.entry-content').text().trim();

            const meta: any = {
                id: `agg:${SITE_CONFIG.id}:${id}`,
                type: 'series',
                name: title,
                poster: poster,
                background: background,
                description: description,
                videos: []
            };

            // Scrape episodes
            let epPageUrl = $('.eplister li > a').first().attr('href');
            if (epPageUrl) {
                const epRes = await axios.get(epPageUrl, { headers: DEFAULT_HEADERS, timeout: 10000 });
                const $ep = cheerio.load(epRes.data);

                $ep('div.episodelist > ul > li').each((i, el) => {
                    const epLink = $ep(el).find('a');
                    const rawText = epLink.find('span').text().trim();
                    const epNumMatch = rawText.match(/(\d+)/);
                    const epNum = epNumMatch ? parseInt(epNumMatch[1]) : i + 1;
                    const href = epLink.attr('href');

                    meta.videos.push({
                        id: `agg:${SITE_CONFIG.id}:${href}`,
                        title: `Episode ${epNum}`,
                        season: 1,
                        episode: epNum,
                        released: new Date().toISOString(), // Fallback
                    });
                });
            }

            return meta;
        } catch (err) {
            console.error(`[Animekhor] getMeta error:`, err);
            return null;
        }
    },

    async getStreams(item: MediaItem): Promise<Stream[]> {
        const epLog = item.episode ? ` S${item.season}E${item.episode}` : '';
        console.log(`[Animekhor] Requesting streams for: ${item.title}${epLog} (ID: ${item.id})`);

        try {
            let detailUrl = '';

            // Handle agg: IDs (direct meta from our catalog)
            if (item.id.startsWith(`agg:${SITE_CONFIG.id}:`)) {
                detailUrl = item.id.replace(`agg:${SITE_CONFIG.id}:`, '');
            } else {
                const searchQueries = [item.title, ...(item.aliases || [])];
                for (const query of searchQueries) {
                    if (!query) continue;
                    const searchUrl = `${SITE_CONFIG.mainUrl}/?s=${encodeURIComponent(query)}`;
                    const searchRes = await axios.get(searchUrl, { headers: DEFAULT_HEADERS, timeout: 10000 });
                    const $ = cheerio.load(searchRes.data);

                    const candidates: Array<{ url: string; title: string; score: number }> = [];
                    $('div.listupd > article').each((_, el) => {
                        const link = $(el).find('div.bsx > a');
                        const title = link.attr('title') || link.text().trim();
                        const href = link.attr('href') || '';
                        const validTitles = [item.title, ...(item.aliases || [])].map(t => t.toLowerCase());
                        const titleLower = title.toLowerCase();
                        const isMatch = validTitles.some(t => titleLower.includes(t) || t.includes(titleLower));
                        if (isMatch && href) {
                            let score = 0;
                            if (validTitles.some(t => t === titleLower)) score += 100;
                            if (item.episode && /movie|ova|special|film/i.test(title)) score -= 50;
                            score -= title.length * 0.1;
                            candidates.push({ url: href, title, score });
                        }
                    });

                    if (candidates.length > 0) {
                        candidates.sort((a, b) => b.score - a.score);
                        detailUrl = candidates[0].url;
                        console.log(`[Animekhor] Matched search result: "${candidates[0].title}"`);
                        break;
                    }
                }
            }

            if (!detailUrl) return [];

            const detailRes = await axios.get(detailUrl, { headers: DEFAULT_HEADERS, timeout: 10000 });
            const $d = cheerio.load(detailRes.data);

            let epPageUrl = $d('.eplister li > a').first().attr('href');
            if (!epPageUrl) return [];

            const epRes = await axios.get(epPageUrl, { headers: DEFAULT_HEADERS, timeout: 10000 });
            const $ep = cheerio.load(epRes.data);

            let watchUrl = '';
            const targetEpisode = item.episode || 1;

            $ep('div.episodelist > ul > li').each((_, el) => {
                const epLink = $ep(el).find('a');
                const rawText = epLink.find('span').text().trim();
                const epNumMatch = rawText.match(/(\d+)/);
                if (epNumMatch && parseInt(epNumMatch[1]) === targetEpisode) {
                    watchUrl = epLink.attr('href') || '';
                    return false;
                }
            });

            if (!watchUrl) return [];

            const watchRes = await axios.get(watchUrl, { headers: DEFAULT_HEADERS, timeout: 10000 });
            const $w = cheerio.load(watchRes.data);

            // Collect embed URLs from server tabs
            const embeds: Array<{ url: string; label: string }> = [];
            $w(SITE_CONFIG.serverSelector).each((_, el) => {
                const base64 = $w(el).attr(SITE_CONFIG.serverAttr);
                if (!base64 || base64 === '0') return;
                const label = $w(el).text().trim() || `Server ${embeds.length + 1}`;
                try {
                    const decoded = Buffer.from(base64, 'base64').toString('utf-8');
                    const $decoded = cheerio.load(decoded);
                    let url = $decoded('iframe').attr('src') || '';
                    if (!url) {
                        const srcMatch = decoded.match(/src=["']([^"']+)["']/i);
                        url = srcMatch ? srcMatch[1] : '';
                    }
                    if (url) {
                        if (url.startsWith('//')) url = 'https:' + url;
                        embeds.push({ url, label });
                    }
                } catch (e) {
                    console.error(`[Animekhor] Decode error:`, e);
                }
            });

            // Resolve embeds to real video URLs (parallel, max 2 streams)
            const resolvePromises = embeds.slice(0, 3).map(e =>
                resolveEmbed(e.url, {
                    siteUrl: SITE_CONFIG.mainUrl,
                    serverLabel: e.label,
                    providerName: SITE_CONFIG.name,
                })
            );
            const resolved = await Promise.all(resolvePromises);
            return resolved.filter((s): s is Stream => s !== null).slice(0, 2);

        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            console.error(`[Animekhor] Error:`, message);
            return [];
        }
    }
};

export default animekhorProvider;
