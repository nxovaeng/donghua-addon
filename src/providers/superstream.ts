import axios from 'axios';
import * as cheerio from 'cheerio';
import { Provider, MediaItem, Stream } from '../types';
import { config } from '../config';
import { db } from '../utils/db';
import { buildStreamProxyUrl } from '../utils/mediaflow';

/**
 * SuperStream / FebBox provider.
 *
 * Uses the FebBox file-sharing infrastructure to resolve streams.
 * Requires a valid FebBox "ui" cookie token (set via FEBBOX_TOKEN env var).
 *
 * Flow:
 *   1. Search by IMDB ID on the search site → get internal media ID
 *   2. Get share link for the media → share key
 *   3. List files under the share key → find matching episode
 *   4. Get video quality list with auth cookie → direct MP4 URLs
 */

// ─── Configuration ───────────────────────────────────────────────────────────
// These are the known API endpoints used by the CloudStream SuperStream extension
const FEBBOX_API = 'https://www.febbox.com';
const SHOWBOX_SEARCH = 'https://www.showbox.media'; // SUPERSTREAM_FOURTH_API equivalent
const FEBBOX_FILE_API = 'https://www.febbox.com';    // SUPERSTREAM_THIRD_API equivalent

function getToken(): string {
    const raw = config.FEBBOX_TOKEN || '';
    return raw.startsWith('ui=') ? raw : `ui=${raw}`;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getEpisodeSlug(season?: number, episode?: number): [string, string] {
    if (season == null || episode == null) return ['', ''];
    return [
        season < 10 ? `0${season}` : `${season}`,
        episode < 10 ? `0${episode}` : `${episode}`
    ];
}

function getQualityFromLabel(label?: string): number {
    if (!label) return 0;
    const match = label.match(/(\d{3,4})[pP]/);
    return match ? parseInt(match[1]) : 0;
}

// ─── Core API calls ──────────────────────────────────────────────────────────

/**
 * Search ShowBox by IMDB ID to get the internal media ID.
 */
async function searchByImdb(imdbId: string): Promise<{ mediaId: number; type: number } | null> {
    const cacheKey = `ss:search:${imdbId}`;
    const cached = db.get(cacheKey) as { mediaId: number; type: number } | null;
    if (cached) return cached;

    try {
        // Search page
        const searchRes = await axios.get(`${SHOWBOX_SEARCH}/search?keyword=${imdbId}`, {
            timeout: 15000,
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
        });

        const $ = cheerio.load(searchRes.data);
        const firstLink = $('h2.film-name a').first().attr('href');
        if (!firstLink) {
            console.warn(`[SuperStream] No results for IMDB: ${imdbId}`);
            return null;
        }

        // Detail page to get the real media ID
        const detailRes = await axios.get(`${SHOWBOX_SEARCH}${firstLink}`, {
            timeout: 15000,
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
        });

        const $2 = cheerio.load(detailRes.data);
        const idLink = $2('h2.heading-name a').first().attr('href');
        const mediaId = idLink?.split('/').pop();
        if (!mediaId || isNaN(Number(mediaId))) return null;

        // Determine type: 1=movie, 2=series
        const isSeries = firstLink.includes('/tv/') || firstLink.includes('/series/');
        const result = { mediaId: parseInt(mediaId), type: isSeries ? 2 : 1 };

        db.set(cacheKey, result, 86400); // Cache for 24h
        return result;
    } catch (err) {
        console.error('[SuperStream] Search error:', err instanceof Error ? err.message : err);
        return null;
    }
}

/**
 * Get the share key for a media item.
 */
async function getShareKey(mediaId: number, type: number): Promise<string | null> {
    const cacheKey = `ss:share:${mediaId}:${type}`;
    const cached = db.get(cacheKey) as string | null;
    if (cached) return cached;

    try {
        const res = await axios.get(`${SHOWBOX_SEARCH}/index/share_link`, {
            params: { id: mediaId, type },
            timeout: 10000,
            headers: { 'Accept-Language': 'en' }
        });

        const link = res.data?.data?.link;
        if (!link) return null;

        const shareKey = link.split('/').pop();
        if (shareKey) db.set(cacheKey, shareKey, 86400);
        return shareKey || null;
    } catch (err) {
        console.error('[SuperStream] Share key error:', err instanceof Error ? err.message : err);
        return null;
    }
}

/**
 * List files under a share key, optionally filtering by season/episode.
 */
async function getFileList(
    shareKey: string,
    season?: number,
    episode?: number
): Promise<Array<{ fid: number; fileName: string }>> {
    try {
        const res = await axios.get(`${FEBBOX_FILE_API}/file/file_share_list`, {
            params: { share_key: shareKey },
            timeout: 10000,
            headers: { 'Accept-Language': 'en' }
        });

        const fileList = res.data?.data?.file_list;
        if (!Array.isArray(fileList)) return [];

        if (season == null) {
            // Movie — return all files
            return fileList.map((f: any) => ({ fid: f.fid, fileName: f.file_name }));
        }

        // Series — find season folder
        const seasonFolder = fileList.find(
            (f: any) => f.file_name?.toLowerCase() === `season ${season}`
        );
        if (!seasonFolder?.fid) return [];

        // Get episode files
        const epRes = await axios.get(`${FEBBOX_FILE_API}/file/file_share_list`, {
            params: { share_key: shareKey, parent_id: seasonFolder.fid, page: 1 },
            timeout: 10000,
            headers: { 'Accept-Language': 'en' }
        });

        const epFiles = epRes.data?.data?.file_list;
        if (!Array.isArray(epFiles)) return [];

        // Filter by SxxExx pattern
        const [seasonSlug, episodeSlug] = getEpisodeSlug(season, episode);
        const pattern = `s${seasonSlug}e${episodeSlug}`;

        return epFiles
            .filter((f: any) => f.file_name?.toLowerCase().includes(pattern))
            .map((f: any) => ({ fid: f.fid, fileName: f.file_name }));
    } catch (err) {
        console.error('[SuperStream] File list error:', err instanceof Error ? err.message : err);
        return [];
    }
}

/**
 * Get video quality list for a specific file ID.
 * This is where the FebBox token is required.
 */
async function getVideoQualities(
    fid: number,
    shareKey: string
): Promise<Array<{ url: string; quality: string; size: string }>> {
    const token = getToken();
    if (!token || token === 'ui=') {
        console.warn('[SuperStream] No FEBBOX_TOKEN configured');
        return [];
    }

    try {
        const res = await axios.get(`${FEBBOX_FILE_API}/console/video_quality_list`, {
            params: { fid, share_key: shareKey },
            headers: { Cookie: token },
            timeout: 15000
        });

        const htmlContent = res.data?.html;
        if (!htmlContent) {
            console.warn('[SuperStream] Empty quality list response');
            return [];
        }

        const $ = cheerio.load(htmlContent);
        const qualities: Array<{ url: string; quality: string; size: string }> = [];

        $('div.file_quality').each((_, el) => {
            const url = $(el).attr('data-url');
            let quality = $(el).attr('data-quality');
            const size = $(el).find('.size').text().trim();

            if (!url || !size) return;

            // Handle "ORG" quality — try to extract resolution from URL
            if (quality?.toUpperCase() === 'ORG') {
                const resMatch = url.match(/(\d{3,4})p/i);
                quality = resMatch ? resMatch[1] + 'p' : '2160p';
            }

            qualities.push({ url, quality: quality || 'Unknown', size });
        });

        return qualities;
    } catch (err) {
        console.error('[SuperStream] Quality list error:', err instanceof Error ? err.message : err);
        return [];
    }
}

// ─── Provider ────────────────────────────────────────────────────────────────

const superstreamProvider: Provider = {
    id: 'superstream',
    name: 'SuperStream',
    enabled: !!(config.FEBBOX_TOKEN),
    weight: 100, // Highest priority — best quality source

    async getStreams(item: MediaItem): Promise<Stream[]> {
        if (!config.FEBBOX_TOKEN) {
            return [];
        }

        console.log(`[SuperStream] Resolving streams for: ${item.title} (${item.type})`);

        // We need the IMDB ID — it should be in the item.id (format: tt1234567 or tt1234567:1:3)
        let imdbId = '';
        const idParts = item.id.split(':');
        if (idParts[0]?.startsWith('tt')) {
            imdbId = idParts[0];
        }

        if (!imdbId) {
            console.warn(`[SuperStream] No IMDB ID found in: ${item.id}`);
            return [];
        }

        try {
            // Step 1: Search by IMDB ID
            const searchResult = await searchByImdb(imdbId);
            if (!searchResult) {
                console.warn(`[SuperStream] Could not find media for ${imdbId}`);
                return [];
            }

            console.log(`[SuperStream] Found media ID: ${searchResult.mediaId} (type: ${searchResult.type})`);

            // Step 2: Get share key
            const shareKey = await getShareKey(searchResult.mediaId, searchResult.type);
            if (!shareKey) {
                console.warn(`[SuperStream] Could not get share key for ${searchResult.mediaId}`);
                return [];
            }

            console.log(`[SuperStream] Share key: ${shareKey}`);

            // Step 3: Get file list
            const files = await getFileList(
                shareKey,
                item.type === 'series' ? item.season : undefined,
                item.type === 'series' ? item.episode : undefined
            );

            if (files.length === 0) {
                console.warn(`[SuperStream] No files found for share key ${shareKey}`);
                return [];
            }

            console.log(`[SuperStream] Found ${files.length} file(s)`);

            // Step 4: Get video qualities for each file
            const streams: Stream[] = [];
            for (const file of files) {
                const qualities = await getVideoQualities(file.fid, shareKey);

                for (const q of qualities) {
                    const qualityNum = getQualityFromLabel(q.quality);
                    const qualityLabel = qualityNum ? `${qualityNum}p` : q.quality;

                    // Build proxy URL if mediaflow is available (for header injection)
                    const streamUrl = config.MEDIAFLOW_PROXY_URL
                        ? buildStreamProxyUrl(q.url, {
                            referer: FEBBOX_API + '/',
                            userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36',
                        })
                        : q.url;

                    streams.push({
                        url: streamUrl,
                        name: `[${qualityLabel}] SuperStream`,
                        description: `FebBox · ${q.size}`,
                    });
                }
            }

            console.log(`[SuperStream] Returning ${streams.length} stream(s)`);
            return streams;
        } catch (err) {
            console.error('[SuperStream] Stream resolution error:', err instanceof Error ? err.message : err);
            return [];
        }
    }
};

export default superstreamProvider;
