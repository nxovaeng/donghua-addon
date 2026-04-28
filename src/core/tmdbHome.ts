import axios from 'axios';
import { config } from '../config';
import { Meta } from '../types';

const tmdb = axios.create({
  baseURL: 'https://api.themoviedb.org/3',
  params: config.TMDB_API_KEY ? { api_key: config.TMDB_API_KEY } : {}
});

function buildImageUrl(path?: string): string | undefined {
  if (!path) return undefined;
  if (path.startsWith('http')) return path;
  return `https://image.tmdb.org/t/p/w500${path}`;
}

function buildMovieMeta(item: any): Meta {
  return {
    id: item.id?.toString(),
    type: 'movie',
    name: item.title || item.name || '',
    poster: buildImageUrl(item.poster_path || item.poster),
    background: buildImageUrl(item.backdrop_path || item.backdrop),
    description: item.overview || '',
    year: item.release_date ? new Date(item.release_date).getFullYear() : undefined,
  };
}

function buildTvMeta(item: any): Meta {
  return {
    id: item.id?.toString(),
    type: 'series',
    name: item.name || item.title || '',
    poster: buildImageUrl(item.poster_path || item.poster),
    background: buildImageUrl(item.backdrop_path || item.backdrop),
    description: item.overview || '',
    year: item.first_air_date ? new Date(item.first_air_date).getFullYear() : undefined,
  };
}

async function fetchTmdbPopular(type: 'movie' | 'series', page = 1): Promise<Meta[]> {
  if (!config.TMDB_API_KEY) return [];

  const endpoint = type === 'movie' ? '/movie/popular' : '/tv/popular';
  const res = await tmdb.get(endpoint, { params: { page } });
  const results = res.data?.results || [];

  return results.map((item: any) => (type === 'movie' ? buildMovieMeta(item) : buildTvMeta(item)));
}

async function searchTmdb(type: 'movie' | 'series', query: string, page = 1): Promise<Meta[]> {
  if (!config.TMDB_API_KEY || !query) return [];

  const endpoint = type === 'movie' ? '/search/movie' : '/search/tv';
  const res = await tmdb.get(endpoint, { params: { query, page } });
  const results = res.data?.results || [];

  return results.map((item: any) => (type === 'movie' ? buildMovieMeta(item) : buildTvMeta(item)));
}

async function fetchTmdbMeta(type: 'movie' | 'series', tmdbId: string): Promise<Meta | null> {
  if (!config.TMDB_API_KEY || !tmdbId) return null;

  try {
    const endpoint = type === 'movie' ? `/movie/${tmdbId}` : `/tv/${tmdbId}`;
    const res = await tmdb.get(endpoint);
    const item = res.data;
    return type === 'movie' ? buildMovieMeta(item) : buildTvMeta(item);
  } catch (err) {
    console.error(`[TmdbHome] fetchTmdbMeta failed for ${type} ${tmdbId}:`, err);
    return null;
  }
}

export async function getTmdbHomeCatalog(type: 'movie' | 'series', extra: any): Promise<Meta[]> {
  if (extra?.search) {
    return await searchTmdb(type, extra.search, extra.page ? parseInt(extra.page, 10) || 1 : 1);
  }

  return await fetchTmdbPopular(type, extra?.page ? parseInt(extra.page, 10) || 1 : 1);
}

export async function getTmdbHomeMeta(type: 'movie' | 'series', id: string): Promise<Meta | null> {
  return await fetchTmdbMeta(type, id);
}
