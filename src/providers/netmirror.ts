import axios from 'axios';
import { Provider, MediaItem, Stream, Meta } from '../types';
import { db } from '../utils/db';
import { buildHlsProxyUrl, buildStreamProxyUrl } from '../utils/mediaflow';

const SITE_CONFIG = {
    id: 'netmirror',
    name: 'NetMirror',
    // Based on the latest NivinCNC source: https://github.com/NivinCNC/CNCVerse-Cloud-Stream-Extension
    mainUrl: 'https://net52.cc',
};

const DEFAULT_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Android) ExoPlayer',
    'X-Requested-With': 'XMLHttpRequest',
    'Referer': SITE_CONFIG.mainUrl + '/'
};

/**
 * Perform the "Bypass" logic to get a valid t_hash cookie.
 * The server returns Set-Cookie: t_hash=... (not t_hash_t as in older sources).
 * Max-Age from server is ~100 days, we cache for 24h to be safe.
 */
async function getBypassCookie(): Promise<string | null> {
    const cacheKey = 'netmirror:bypass';
    const cached = db.get(cacheKey) as string;
    if (cached) {
        console.log(`[NetMirror] Using cached bypass cookie`);
        return cached;
    }

    try {
        const res = await axios.post(`${SITE_CONFIG.mainUrl}/p.php`, {}, {
            headers: DEFAULT_HEADERS,
            timeout: 10000,
            validateStatus: () => true
        });

        console.log(`[NetMirror] p.php status: ${res.status}, body: ${JSON.stringify(res.data)}`);

        let cookie = '';
        const setCookie = res.headers['set-cookie'];
        if (setCookie) {
            // Server returns t_hash (NOT t_hash_t)
            const match = setCookie.join(';').match(/t_hash=([^;]+)/);
            if (match) cookie = match[1];
            console.log(`[NetMirror] Set-Cookie headers: ${setCookie.join(' | ')}`);
        }

        if (res.data && JSON.stringify(res.data).includes('"r":"n"') && cookie) {
            console.log(`[NetMirror] Bypass successful! t_hash obtained: ${cookie.substring(0, 16)}...`);
            db.set(cacheKey, cookie, 86400); // 24 hours
            return cookie;
        }

        console.warn(`[NetMirror] Bypass incomplete - r:"n"=${JSON.stringify(res.data).includes('"r":"n"')}, cookie=${!!cookie}`);
        return cookie || null;
    } catch (e) {
        console.error('[NetMirror] Bypass error:', e instanceof Error ? e.message : e);
        return null;
    }
}

const netmirrorProvider: Provider = {
    id: SITE_CONFIG.id,
    name: SITE_CONFIG.name,
    enabled: false,
    weight: 90,

    async search(query: string, _type: string): Promise<MediaItem[]> {
        try {
            const bypass = await getBypassCookie();
            const ts = Date.now();
            const res = await axios.get(`${SITE_CONFIG.mainUrl}/search.php?s=${encodeURIComponent(query)}&t=${ts}`, {
                headers: {
                    ...DEFAULT_HEADERS,
                    'Cookie': bypass ? `t_hash=${bypass}; hd=on; ott=nf` : 'hd=on; ott=nf'
                },
                timeout: 10000
            });

            if (!res.data || !res.data.searchResult) return [];

            return res.data.searchResult.map((item: any) => ({
                id: `agg:${SITE_CONFIG.id}:${item.id}`,
                type: item.type === 'series' ? 'series' : 'movie',
                title: item.t,
            }));
        } catch (err) {
            console.error('[NetMirror] Search error:', err);
            return [];
        }
    },

    async getMeta(id: string, type: string): Promise<Meta | null> {
        const cacheKey = `meta:agg:${SITE_CONFIG.id}:${id}`;
        const cached = db.get(cacheKey) as Meta | null;
        if (cached) return cached;

        try {
            const bypass = await getBypassCookie();
            const ts = Date.now();

            // post.php returns full detail including episodes
            const res = await axios.get(`${SITE_CONFIG.mainUrl}/post.php?id=${id}&t=${ts}`, {
                headers: {
                    ...DEFAULT_HEADERS,
                    'Cookie': bypass ? `t_hash=${bypass}; hd=on; ott=nf` : 'hd=on; ott=nf'
                },
                timeout: 10000
            });

            const data = res.data;
            if (!data) return null;

            const meta: Meta = {
                id: `agg:${SITE_CONFIG.id}:${id}`,
                type: type,
                name: data.title,
                description: data.desc,
                poster: `https://imgcdn.kim/poster/v/${id}.jpg`,
                videos: []
            };

            if (Array.isArray(data.episodes)) {
                meta.videos = data.episodes.filter((ep: any) => ep !== null).map((ep: any) => ({
                    id: `agg:${SITE_CONFIG.id}:${id}:${ep.id}`,
                    title: ep.t || `Episode ${ep.ep}`,
                    season: parseInt(ep.s.replace('S', '')) || 1,
                    episode: parseInt(ep.ep.replace('E', '')) || 1,
                    released: new Date().toISOString()
                }));
            }

            db.set(cacheKey, meta, 3600);
            return meta;
        } catch (err) {
            console.error('[NetMirror] getMeta error:', err);
            return null;
        }
    },

    async getStreams(item: MediaItem): Promise<Stream[]> {
        console.log(`[NetMirror] Resolving streams for: ${item.title}`);

        try {
            const bypass = await getBypassCookie();
            let netId = '';
            let netTitle = item.title;

            // 1. Identify the NetMirror ID
            if (item.id.startsWith(`agg:${SITE_CONFIG.id}:`)) {
                const parts = item.id.split(':');
                // agg:netmirror:seriesId:episodeId OR agg:netmirror:movieId
                netId = parts[parts.length - 1];
            } else {
                const results = await this.search!(item.title, item.type);
                if (results.length === 0) return [];
                const matched = results.find(r => r.title.toLowerCase().includes(item.title.toLowerCase())) || results[0];
                netId = matched.id.split(':').pop() || '';
                netTitle = matched.title;

                if (item.type === 'series' && item.episode) {
                    const meta = await this.getMeta!(netId, 'series');
                    const ep = meta?.videos?.find(v => v.episode === item.episode);
                    if (ep) {
                        netId = ep.id.split(':').pop() || '';
                    }
                }
            }

            if (!netId) return [];

            // 2. Use the new mobile/playlist.php endpoint from latest source
            const ts = Date.now();
            const playlistRes = await axios.get(`${SITE_CONFIG.mainUrl}/mobile/playlist.php?id=${netId}&t=${encodeURIComponent(netTitle)}&tm=${ts}`, {
                headers: {
                    ...DEFAULT_HEADERS,
                    'Cookie': bypass ? `t_hash=${bypass}; hd=on; ott=nf` : 'hd=on; ott=nf',
                    'Referer': `${SITE_CONFIG.mainUrl}/`
                },
                timeout: 10000
            });

            if (!playlistRes.data || !Array.isArray(playlistRes.data)) return [];

            const streams: Stream[] = [];
            for (const item of playlistRes.data) {
                if (Array.isArray(item.sources)) {
                    for (const source of item.sources) {
                        const rawUrl = source.file.startsWith('http') ? source.file : `${SITE_CONFIG.mainUrl}${source.file}`;
                        streams.push({
                            url: buildHlsProxyUrl(rawUrl, {
                                referer: SITE_CONFIG.mainUrl + '/',
                                userAgent: 'Mozilla/5.0 (Android) ExoPlayer',
                                cookie: bypass ? `t_hash=${bypass}; hd=on; ott=nf` : 'hd=on; ott=nf'
                            }),
                            name: `[${source.label || 'Auto'}] NetMirror`,
                            description: `OTT Mirror · ${source.type || 'HLS'}`,
                        });
                    }
                }
            }
            return streams;

        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            console.error(`[NetMirror] Stream resolution error:`, message);
            return [];
        }
    }
};

export default netmirrorProvider;
