/**
 * Resolve bairro TP via CEP (ViaCEP / BrasilAPI).
 * Spec: Docs/superpowers/specs/2026-09-02-tp-bairro-cep-design.md
 */
import fs from 'fs/promises';
import path from 'path';
import {
  extractCepFromText,
  isCepGenerico,
  loadCepCache,
  lookupBairroFromCep,
  refineCepViaLogradouro,
  saveCepCache,
  type CepCacheEntry,
  type LookupFetch,
  type RefineCepResult,
} from './tpCepResolver.ts';
import { bairroSlug } from './wellhubBairrosCatalog.ts';
import type { TpReceitaCepHit } from './tpReceitaCepMatch.ts';

export type TpBairroSource =
  | 'receita_cep'
  | 'receita_logradouro_cep'
  | 'detail_cep'
  | 'list_cep'
  | 'cache'
  | 'viacep'
  | 'brasilapi'
  | 'nominatim'
  | 'index';

export type TpBairroResolved = {
  bairro: string;
  bairro_slug: string;
  cep: string;
  cep_rf?: string;
  source: TpBairroSource;
  cnpj?: string;
  lat: number;
  lng: number;
  provider: 'cep' | 'nominatim';
  resolved_at: string;
  /** @deprecated legacy Nominatim only */
  nominatim_place_id?: number;
  /** @deprecated legacy Nominatim only */
  nominatim_display_name?: string;
};

export type TpBairroIndex = {
  version: '1' | '2';
  generated_at: string;
  provider: 'nominatim' | 'cep';
  stats: {
    total: number;
    /** entradas com bairro resolvido, qualquer proveniencia (nominatim + CEP + cache) */
    resolved: number;
    /** subconjunto de `resolved` com CEP valido (receita_cep / receita_logradouro_cep) */
    resolved_cep: number;
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

type GeocodeCacheEntry = TpBairroResolved | { error: string; lat: number; lng: number };

const DEFAULT_GEOCODE_CACHE_PATH = path.join(
  process.cwd(),
  'data/processed/tp-bairro-geocode-cache.json',
);

function coordKey(lat: number, lng: number): string {
  return `${lat.toFixed(5)},${lng.toFixed(5)}`;
}

/** @deprecated Nominatim — não usar em produção (spec CEP). */
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
  cachePath = DEFAULT_GEOCODE_CACHE_PATH,
): Promise<Record<string, GeocodeCacheEntry>> {
  try {
    const raw = await fs.readFile(cachePath, 'utf8');
    const parsed = JSON.parse(raw) as Record<string, GeocodeCacheEntry>;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

export async function saveGeocodeCache(
  cache: Record<string, GeocodeCacheEntry>,
  cachePath = DEFAULT_GEOCODE_CACHE_PATH,
): Promise<void> {
  await fs.mkdir(path.dirname(cachePath), { recursive: true });
  const tmp = `${cachePath}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(cache, null, 2), 'utf8');
  await fs.rename(tmp, cachePath);
}

/** @deprecated use resolveTpBairroViaCep */
export async function reverseGeocodeBairro(
  lat: number,
  lng: number,
  opts?: {
    cache?: Record<string, GeocodeCacheEntry>;
    userAgent?: string;
  },
): Promise<TpBairroResolved | null> {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

  const key = coordKey(lat, lng);
  const cached = opts?.cache?.[key];
  if (cached && 'bairro' in cached && cached.cep) {
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

  if (!res.ok) throw new Error(`Nominatim HTTP ${res.status}`);

  const body = (await res.json()) as NominatimReverse;
  if (body.error) throw new Error(body.error);

  const bairro = pickBairroFromNominatimAddress(body.address);
  if (!bairro) return null;

  const resolved: TpBairroResolved = {
    bairro,
    bairro_slug: bairroSlug(bairro),
    cep: '',
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

export type ResolveTpBairroViaCepOpts = {
  gymId: string;
  lat: number;
  lng: number;
  receitaHit?: TpReceitaCepHit;
  listAddress?: string | null;
  detailAddress?: string | null;
  cepCache?: Record<string, CepCacheEntry>;
  logradouroCache?: Record<string, RefineCepResult>;
  fetch?: LookupFetch;
};

/** CEP → lookup Correios → TpBairroResolved; F2.2 refine se -000. */
export async function resolveTpBairroViaCep(
  opts: ResolveTpBairroViaCepOpts,
): Promise<TpBairroResolved | null> {
  const { lat, lng, receitaHit, listAddress, detailAddress } = opts;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

  let cepOrigin: TpBairroSource | null = null;
  let rawCep: string | null = null;
  let cepRf: string | undefined;
  let cnpj: string | undefined;

  if (receitaHit?.cep) {
    rawCep = receitaHit.cep;
    cepRf = receitaHit.cep;
    cepOrigin = 'receita_cep';
    cnpj = receitaHit.cnpj;
  } else if (detailAddress) {
    rawCep = extractCepFromText(detailAddress);
    if (rawCep) cepOrigin = 'detail_cep';
  } else if (listAddress) {
    rawCep = extractCepFromText(listAddress);
    if (rawCep) cepOrigin = 'list_cep';
  }

  if (!rawCep || !cepOrigin) return null;

  const cacheKey = `cep:${rawCep.replace(/\D/g, '')}`;
  const hadCache = Boolean(opts.cepCache?.[cacheKey] && 'bairro' in opts.cepCache[cacheKey]!);

  let lookup = await lookupBairroFromCep(rawCep, {
    cache: opts.cepCache,
    fetch: opts.fetch,
  });

  if (
    !lookup &&
    isCepGenerico(rawCep) &&
    receitaHit?.logradouro &&
    receitaHit.uf &&
    receitaHit.municipio
  ) {
    const refined = await refineCepViaLogradouro(
      {
        cep_rf: rawCep,
        uf: receitaHit.uf,
        municipio: receitaHit.municipio,
        logradouro: receitaHit.logradouro,
        tipo_logradouro: receitaHit.tipo_logradouro,
        numero: receitaHit.numero,
      },
      { cache: opts.logradouroCache, fetch: opts.fetch },
    );
    if (refined.ok) {
      lookup = await lookupBairroFromCep(refined.cep, {
        cache: opts.cepCache,
        fetch: opts.fetch,
      });
      if (lookup) {
        rawCep = refined.cep;
        cepOrigin = 'receita_logradouro_cep';
      }
    }
  }

  if (!lookup) return null;

  // Origens de CEP da Receita mantêm o rótulo de origem; detail_cep/list_cep são
  // relabelados pro provedor que efetivamente resolveu (viacep/brasilapi).
  let source: TpBairroSource = cepOrigin;
  if (hadCache) {
    source = 'cache';
  } else if (cepOrigin !== 'receita_cep' && cepOrigin !== 'receita_logradouro_cep') {
    if (lookup.provider === 'viacep') source = 'viacep';
    else if (lookup.provider === 'brasilapi') source = 'brasilapi';
  }

  return {
    bairro: lookup.bairro,
    bairro_slug: lookup.bairro_slug,
    cep: lookup.cep,
    cep_rf: cepRf && cepRf !== lookup.cep ? cepRf : undefined,
    source,
    cnpj,
    lat,
    lng,
    provider: 'cep',
    resolved_at: lookup.resolved_at,
  };
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

export function isValidCepResolved(entry: TpBairroResolved): boolean {
  return Boolean(entry.cep && entry.cep.replace(/\D/g, '').length === 8 && entry.bairro);
}

export function countTpBairroIndex(index: TpBairroIndex): {
  resolved_cep: number;
  resolved_any: number;
  failed: number;
} {
  const entries = Object.values(index.by_gym_id ?? {});
  return {
    resolved_cep: entries.filter(isValidCepResolved).length,
    resolved_any: entries.filter((e) => e.bairro && e.bairro_slug).length,
    failed: index.failures?.length ?? 0,
  };
}
