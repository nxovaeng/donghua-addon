/**
 * Resolve a DonghuaPlanet embed URL to its real video stream URL.
 *
 * DonghuaPlanet uses JWPlayer backed by Rumble CDN. The embed page HTML
 * contains an inline `sources: [...]` JSON array with multiple quality
 * levels (240p–1440p HLS chunks + an "Auto" master HLS playlist).
 *
 * We prefer the Auto (master) HLS playlist since MediaFlow can select
 * the best quality at playback time. If Auto is unavailable we fall
 * back to the highest individual resolution.
 */

import axios from 'axios';

const DEFAULT_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
};

const QUALITY_PREFERENCE = ['Auto', '2160p', '1440p', '1080p', '720p', '480p', '360p', '240p'];

export interface DonghuaPlanetResult {
  url: string;
  quality: string;
  subtitles?: Array<{ url: string; label: string }>;
}

/**
 * Resolve a DonghuaPlanet embed URL to its best HLS stream URL.
 *
 * @param embedUrl - Full embed URL, e.g. https://player.donghuaplanet.com/v76pfla
 * @param referer - Referer header to send (the originating site URL)
 */
export async function resolveDonghuaPlanet(
  embedUrl: string,
  referer: string = 'https://donghuaworld.com/'
): Promise<DonghuaPlanetResult | null> {
  try {
    const res = await axios.get(embedUrl, {
      headers: {
        ...DEFAULT_HEADERS,
        'Referer': referer,
      },
      timeout: 15000,
    });

    const body: string = res.data;

    // Extract the sources JSON array from the inline script
    // Pattern: sources: [{...}, {...}]
    const sourcesMatch = body.match(/sources\s*:\s*(\[[\s\S]*?\])\s*[,\n\r}]/);
    if (!sourcesMatch) {
      console.error(`[DonghuaPlanet] No sources found in embed page: ${embedUrl}`);
      return null;
    }

    // The JSON is escaped with \/ — parse it
    let sourcesJson = sourcesMatch[1];
    sourcesJson = sourcesJson.replace(/\\\//g, '/');

    let sources: Array<{ file: string; type: string; label: string }>;
    try {
      sources = JSON.parse(sourcesJson);
    } catch (parseErr) {
      console.error(`[DonghuaPlanet] Failed to parse sources JSON: ${parseErr}`);
      return null;
    }

    if (!sources || sources.length === 0) {
      console.error(`[DonghuaPlanet] Empty sources array for: ${embedUrl}`);
      return null;
    }

    // Pick the best quality stream by preference order
    for (const preferredQuality of QUALITY_PREFERENCE) {
      const match = sources.find(s => s.label === preferredQuality);
      if (match && match.file) {
        // Extract subtitles if available
        const subtitles = extractSubtitles(body);

        return {
          url: match.file,
          quality: preferredQuality === 'Auto' ? 'Auto' : preferredQuality,
          subtitles,
        };
      }
    }

    // Fallback: use the first source with a file URL
    const fallback = sources.find(s => s.file);
    if (fallback) {
      return {
        url: fallback.file,
        quality: fallback.label || 'unknown',
        subtitles: extractSubtitles(body),
      };
    }

    return null;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[DonghuaPlanet] Resolve failed for ${embedUrl}: ${message}`);
    return null;
  }
}

/**
 * Extract subtitle tracks from the embed page HTML.
 */
function extractSubtitles(body: string): Array<{ url: string; label: string }> {
  const tracksMatch = body.match(/tracks\s*[=:]\s*(\[[\s\S]*?\])\s*[;,\n\r]/);
  if (!tracksMatch) return [];

  try {
    let tracksJson = tracksMatch[1].replace(/\\\//g, '/');
    const tracks = JSON.parse(tracksJson);
    return tracks
      .filter((t: any) => t.file && t.label)
      .map((t: any) => ({ url: t.file, label: t.label }));
  } catch {
    return [];
  }
}
