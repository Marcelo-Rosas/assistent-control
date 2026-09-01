/**
 * Reverse geocode lat/lng → bairro para academias TotalPass.
 * Provider: Nominatim OSM (1 req/s — usar cache + DELAY_MS).
 */
import fs from 'fs/promises';
import path from 'path';
import { bairroSlug } from './wellhubBairrosCatalog.ts';

export type TpBairroSource = 'cache' | 'nominatim' | 'index';

export type TpBairroResolved = {
  bairro: string;
  bairro_slug: string;
  source: TpBairroSource;
  lat: number;
  lng: number;
  provider: 'nominatim';
  nominatim_place_id?: number;
  nominatim_display_name?: string;
  resolved_at: string;
};

export type TpBairroIndex = {
  version: '1';
  generated_at: string;
  provider: 'nominatim';
  stats: {
    total: number;
    resolved: number;
    failed: number;
  };
  by_gym_id: Record<string, TpBairroResolved>;
  failures: Array<{ gym_id: string; lat: number; lng: number; error: string }>;
};

type NominatimReverse = {
  place_id?: number;
  display_name?: string;
  address?: Record<string, string>;
  error?: string;
};

type CacheEntry = TpBairroResolved | { error: string; lat: number; lng: number };

const DEFAULT_CACHE_PATH = path.join(
  process.cwd(),
  'data/processed/tp-bairro-geocode-cache.json',
);

function coordKey(lat: number, lng: number): string {
  return `${lat.toFixed(5)},${lng.toFixed(5)}`;
}

export function pickBairroFromNominatimAddress(
  address: Record<string, string> | undefined,
): string | null {
  if (!address) return null;
  const priority = ['suburb', 'neighbourhood', 'quarter', 'city_district', 'hamlet'];
  for (const key of priority) {
    const v = String(address[key] ?? '').trim();
    if (v.length >= 2 && v.length <= 64) return v;
  }
  return null;
}

export async function loadGeocodeCache(
  cachePath = DEFAULT_CACHE_PATH,
): Promise<Record<string, CacheEntry>> {
  try {
    const raw = await fs.readFile(cachePath, 'utf8');
    const parsed = JSON.parse(raw) as Record<string, CacheEntry>;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

export async function saveGeocodeCache(
  cache: Record<string, CacheEntry>,
  cachePath = DEFAULT_CACHE_PATH,
): Promise<void> {
  await fs.mkdir(path.dirname(cachePath), { recursive: true });
  const tmp = `${cachePath}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(cache, null, 2), 'utf8');
  await fs.rename(tmp, cachePath);
}

export async function reverseGeocodeBairro(
  lat: number,
  lng: number,
  opts?: {
    cache?: Record<string, CacheEntry>;
    userAgent?: string;
  },
): Promise<TpBairroResolved | null> {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

  const key = coordKey(lat, lng);
  const cached = opts?.cache?.[key];
  if (cached && 'bairro' in cached) {
    return { ...cached, source: 'cache' };
  }
  if (cached && 'error' in cached) return null;

  const url =
    `https://nominatim.openstreetmap.org/reverse?format=json` +
    `&lat=${encodeURIComponent(String(lat))}` +
    `&lon=${encodeURIComponent(String(lng))}` +
    `&addressdetails=1&accept-language=pt-BR`;

  const res = await fetch(url, {
    headers: {
      Accept: 'application/json',
      'User-Agent': opts?.userAgent ?? 'GymSitePipeline/1.0 (tp-bairro-resolver; local-dev)',
    },
  });

  if (!res.ok) {
    throw new Error(`Nominatim HTTP ${res.status}`);
  }

  const body = (await res.json()) as NominatimReverse;
  if (body.error) throw new Error(body.error);

  const bairro = pickBairroFromNominatimAddress(body.address);
  if (!bairro) return null;

  const resolved: TpBairroResolved = {
    bairro,
    bairro_slug: bairroSlug(bairro),
    source: 'nominatim',
    lat,
    lng,
    provider: 'nominatim',
    nominatim_place_id: body.place_id,
    nominatim_display_name: body.display_name,
    resolved_at: new Date().toISOString(),
  };

  if (opts?.cache) opts.cache[key] = resolved;
  return resolved;
}

export async function loadTpBairroIndex(indexPath: string): Promise<TpBairroIndex | null> {
  try {
    const raw = await fs.readFile(indexPath, 'utf8');
    return JSON.parse(raw) as TpBairroIndex;
  } catch {
    return null;
  }
}

export async function saveTpBairroIndex(indexPath: string, index: TpBairroIndex): Promise<void> {
  await fs.mkdir(path.dirname(indexPath), { recursive: true });
  const tmp = `${indexPath}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(index, null, 2), 'utf8');
  await fs.rename(tmp, indexPath);
}
