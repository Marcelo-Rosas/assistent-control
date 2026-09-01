/**
 * Preenche lat/lng faltantes em data/municipios-brasil.json (só lat/lng=0).
 * Wellhub location primeiro; fallback Nominatim (polite delay).
 *
 * Run: npm run fill:municipios-coords
 *
 * Env:
 *   MUNICIPIOS_PATH | CACHE_PATH
 *   GEO_CONCURRENCY=8
 *   GEO_DELAY_MS=100
 *   NOMINATIM_DELAY_MS=1100
 *   CHECKPOINT_EVERY=100
 *   LIMIT=0                 — teto de municípios a geocodificar (teste)
 *   SKIP_NOMINATIM=0
 */
import fs from 'fs/promises';
import path from 'path';

type MunicipioBrasil = {
  nome: string;
  ibge: string;
  uf: string;
  populacao?: number;
  lat: number;
  lng: number;
};

type GeoHit = { lat: number; lng: number };

const ROOT = process.cwd();
const MUNICIPIOS_PATH =
  process.env.MUNICIPIOS_PATH || path.join(ROOT, 'data/municipios-brasil.json');
const CACHE_PATH =
  process.env.CACHE_PATH || path.join(ROOT, 'data/processed/municipios-geo-cache.json');

const WELLHUB_LOCATION =
  'https://mep-partner-bff.wellhub.com/v2/search/location';

const GEO_CONCURRENCY = Number(process.env.GEO_CONCURRENCY || 8);
const GEO_DELAY_MS = Number(process.env.GEO_DELAY_MS || 100);
const NOMINATIM_DELAY_MS = Number(process.env.NOMINATIM_DELAY_MS || 1100);
const CHECKPOINT_EVERY = Number(process.env.CHECKPOINT_EVERY || 100);
const LIMIT = Number(process.env.LIMIT || 0);
const SKIP_NOMINATIM = process.env.SKIP_NOMINATIM === '1';
const MAX_RETRIES = 3;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function hasCoords(lat?: number, lng?: number): boolean {
  return (
    typeof lat === 'number' &&
    typeof lng === 'number' &&
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    !(lat === 0 && lng === 0)
  );
}

async function fetchWithRetry(url: string, attempt = 1): Promise<Response> {
  const res = await fetch(url, {
    headers: {
      Accept: 'application/json',
      'User-Agent': 'Mozilla/5.0 (compatible; GymSitePipeline/1.0)',
    },
  });
  if ((res.status === 429 || res.status >= 500) && attempt < MAX_RETRIES) {
    const backoff = 500 * 2 ** (attempt - 1);
    console.warn(`  retry ${attempt}/${MAX_RETRIES} status=${res.status} wait=${backoff}ms`);
    await sleep(backoff);
    return fetchWithRetry(url, attempt + 1);
  }
  return res;
}

async function geocodeWellhub(nome: string, uf: string): Promise<GeoHit | null> {
  for (const term of [`${nome}-${uf}`, `${nome} ${uf}`]) {
    const url = `${WELLHUB_LOCATION}?maxResults=4&locale=pt-br&term=${encodeURIComponent(term)}`;
    try {
      const res = await fetchWithRetry(url);
      if (!res.ok) continue;
      const hits = (await res.json()) as Array<{
        stateCode?: string;
        location?: { lat?: number; lon?: number };
      }>;
      if (!Array.isArray(hits)) continue;
      const preferred =
        hits.find(
          (h) =>
            String(h.stateCode || '').toUpperCase() === uf &&
            typeof h.location?.lat === 'number' &&
            typeof h.location?.lon === 'number',
        ) ||
        hits.find(
          (h) => typeof h.location?.lat === 'number' && typeof h.location?.lon === 'number',
        );
      if (preferred?.location?.lat != null && preferred.location.lon != null) {
        return { lat: preferred.location.lat, lng: preferred.location.lon };
      }
    } catch {
      // next term
    }
  }
  return null;
}

async function geocodeNominatim(nome: string, uf: string): Promise<GeoHit | null> {
  const q = encodeURIComponent(`${nome}, ${uf}, Brasil`);
  const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=br&q=${q}`;
  const res = await fetch(url, {
    headers: {
      Accept: 'application/json',
      'User-Agent': 'GymSitePipeline/1.0 (municipios-geo; local-dev)',
    },
  });
  if (!res.ok) return null;
  const hits = (await res.json()) as Array<{ lat?: string; lon?: string }>;
  if (!Array.isArray(hits) || !hits.length) return null;
  const lat = Number(hits[0].lat);
  const lng = Number(hits[0].lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { lat, lng };
}

async function loadCache(): Promise<Record<string, GeoHit>> {
  try {
    const raw = await fs.readFile(CACHE_PATH, 'utf-8');
    const parsed = JSON.parse(raw) as Record<string, GeoHit>;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

async function saveCache(cache: Record<string, GeoHit>): Promise<void> {
  await fs.mkdir(path.dirname(CACHE_PATH), { recursive: true });
  await fs.writeFile(CACHE_PATH, JSON.stringify(cache, null, 2), 'utf-8');
}

async function saveMunicipios(list: MunicipioBrasil[]): Promise<void> {
  await fs.mkdir(path.dirname(MUNICIPIOS_PATH), { recursive: true });
  await fs.writeFile(MUNICIPIOS_PATH, JSON.stringify(list, null, 2), 'utf-8');
}

async function mapPool<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;

  async function worker(): Promise<void> {
    while (next < items.length) {
      const i = next;
      next += 1;
      out[i] = await fn(items[i], i);
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, items.length) }, () => worker());
  await Promise.all(workers);
  return out;
}

async function main(): Promise<void> {
  console.log('Fill coords faltantes em municipios-brasil.json\n');
  console.log(
    `GEO_CONCURRENCY=${GEO_CONCURRENCY} GEO_DELAY_MS=${GEO_DELAY_MS} NOMINATIM_DELAY_MS=${NOMINATIM_DELAY_MS}`,
  );

  const raw = await fs.readFile(MUNICIPIOS_PATH, 'utf-8');
  const municipios = JSON.parse(raw) as MunicipioBrasil[];
  if (!Array.isArray(municipios) || !municipios.length) {
    throw new Error(`Lista inválida: ${MUNICIPIOS_PATH}`);
  }

  const cache = await loadCache();
  const missingIdx: number[] = [];
  for (let i = 0; i < municipios.length; i++) {
    const m = municipios[i];
    if (!hasCoords(m.lat, m.lng)) missingIdx.push(i);
  }

  console.log(`Total: ${municipios.length}`);
  console.log(`Já com coords: ${municipios.length - missingIdx.length}`);
  console.log(`Faltando: ${missingIdx.length}`);
  console.log(`Cache entries: ${Object.keys(cache).length}\n`);

  let workIdx = missingIdx;
  if (LIMIT > 0) {
    workIdx = missingIdx.slice(0, LIMIT);
    console.log(`LIMIT=${LIMIT} → geocode ${workIdx.length}\n`);
  }

  let done = 0;
  let fromCache = 0;
  let fromWellhub = 0;
  let fromNominatim = 0;
  let failed = 0;
  const needNominatim: number[] = [];

  await mapPool(workIdx, GEO_CONCURRENCY, async (idx) => {
    const m = municipios[idx];
    const key = m.ibge || `${m.nome}-${m.uf}`;

    const cached = cache[key];
    if (cached && hasCoords(cached.lat, cached.lng)) {
      m.lat = cached.lat;
      m.lng = cached.lng;
      fromCache += 1;
    } else {
      try {
        const geo = await geocodeWellhub(m.nome, m.uf);
        if (geo) {
          m.lat = geo.lat;
          m.lng = geo.lng;
          cache[key] = geo;
          fromWellhub += 1;
        } else {
          needNominatim.push(idx);
        }
      } catch {
        needNominatim.push(idx);
      }
      await sleep(GEO_DELAY_MS);
    }

    done += 1;
    if (done % 50 === 0 || done === workIdx.length) {
      process.stdout.write(
        `\rWellhub/cache ${done}/${workIdx.length} ok=${fromCache + fromWellhub} queue_nom=${needNominatim.length}   `,
      );
    }
    if (done % CHECKPOINT_EVERY === 0) {
      await saveMunicipios(municipios);
      await saveCache(cache);
    }
    return m;
  });
  console.log('\n');

  if (!SKIP_NOMINATIM && needNominatim.length) {
    console.log(`Nominatim fallback: ${needNominatim.length} municípios…`);
    for (let i = 0; i < needNominatim.length; i++) {
      const idx = needNominatim[i];
      const m = municipios[idx];
      const key = m.ibge || `${m.nome}-${m.uf}`;
      try {
        const geo = await geocodeNominatim(m.nome, m.uf);
        if (geo) {
          m.lat = geo.lat;
          m.lng = geo.lng;
          cache[key] = geo;
          fromNominatim += 1;
        } else {
          failed += 1;
        }
      } catch {
        failed += 1;
      }
      if ((i + 1) % 20 === 0 || i + 1 === needNominatim.length) {
        process.stdout.write(
          `\rNominatim ${i + 1}/${needNominatim.length} ok=${fromNominatim} fail=${failed}   `,
        );
      }
      if ((i + 1) % CHECKPOINT_EVERY === 0) {
        await saveMunicipios(municipios);
        await saveCache(cache);
      }
      await sleep(NOMINATIM_DELAY_MS);
    }
    console.log('\n');
  } else if (needNominatim.length) {
    failed += needNominatim.length;
    console.log(`SKIP_NOMINATIM=1 — ${needNominatim.length} ficam sem coords`);
  }

  await saveMunicipios(municipios);
  await saveCache(cache);

  const withCoords = municipios.filter((m) => hasCoords(m.lat, m.lng)).length;
  console.log('=== Estatísticas ===');
  console.log(`Com coords: ${withCoords}/${municipios.length}`);
  console.log(`Sem coords: ${municipios.length - withCoords}`);
  console.log(`cache=${fromCache} wellhub=${fromWellhub} nominatim=${fromNominatim} fail=${failed}`);
  console.log(`Output: ${MUNICIPIOS_PATH}`);
  console.log(`Cache: ${CACHE_PATH}`);
}

main().catch((err) => {
  console.error('Erro fatal:', err);
  process.exit(1);
});
