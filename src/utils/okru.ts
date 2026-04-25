/**
 * Resolve an ok.ru (Odnoklassniki) embed URL to real MP4 stream URLs.
 *
 * Logic: fetch the videoembed page → unescape HTML entities →
 * parse the "videos":[...] JSON → extract MP4 URLs with quality labels.
 *
 * Ported from donghua/extractor_okru.js
 */

import axios from 'axios';

const DEFAULT_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
};

const QUALITY_MAP: Record<string, number> = {
  'mobile': 144,
  'lowest': 240,
  'low': 360,
  'sd': 480,
  'hd': 720,
  'full': 1080,
  'quad': 1440,
  'ultra': 2160,
};

// Only keep streams at or above this resolution
const MIN_HEIGHT = 720;

export interface OkRuResult {
  url: string;
  quality: string;
  height: number;
}

/**
 * Resolve an ok.ru embed URL to its best MP4 stream URL.
 * Returns the highest quality stream at 720p or above.
 */
export async function resolveOkRu(url: string): Promise<OkRuResult | null> {
  try {
    // Normalize to videoembed format
    const embedUrl = url
      .replace('/video/', '/videoembed/')
      .replace('m.ok.ru', 'ok.ru');

    const res = await axios.get(embedUrl, {
      headers: {
        ...DEFAULT_HEADERS,
        'Accept': '*/*',
        'Origin': 'https://ok.ru',
        'Referer': 'https://ok.ru/',
      },
      timeout: 15000,
    });

    let html: string = res.data;

    // Unescape the response
    html = html
      .replace(/\\&quot;/g, '"')
      .replace(/\\\\/g, '\\')
      .replace(/\\u([0-9A-Fa-f]{4})/g, (_, hex: string) =>
        String.fromCharCode(parseInt(hex, 16))
      );

    // Extract videos JSON array
    const videosMatch = html.match(/"videos":(\[[^\]]*\])/);
    if (!videosMatch) {
      console.warn('[OkRu] No videos array found in page');
      return null;
    }

    const videos: Array<{ url: string; name: string }> = JSON.parse(videosMatch[1]);

    // Find the best quality stream (>= 720p)
    let best: OkRuResult | null = null;

    for (const video of videos) {
      if (!video.url || !video.name) continue;

      let videoUrl = video.url;
      if (videoUrl.startsWith('//')) videoUrl = 'https:' + videoUrl;

      const qualityKey = video.name.toLowerCase();
      const height = QUALITY_MAP[qualityKey] || 0;

      if (height < MIN_HEIGHT) continue;

      if (!best || height > best.height) {
        best = {
          url: videoUrl,
          quality: height ? `${height}` : video.name,
          height,
        };
      }
    }

    return best;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[OkRu] Resolve failed for ${url}: ${message}`);
    return null;
  }
}
