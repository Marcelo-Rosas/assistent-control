/**
 * Scrape GuruPass BR — API REST pública (sem Playwright).
 *
 * GET https://api.gurupass.com.br/user/establishments/search
 *   ?limit=51&longitude={lng}&latitude={lat}&includeEstablishmentGroups=true
 *
 * Input:  data/municipios-brasil.json
 * Output: data/raw/gurupass-brasil-all.json
 * Checkpoint: data/processed/gurupass-progress.json
 *
 * Run: npm run fetch:gurupass-br
 *
 * Env:
 *   DELAY_MS=500
 *   LIMIT=0                 — teto municípios
 *   CHECKPOINT_EVERY=50
 *   MAX_PAGES=1             — páginas por município (0 = todas)
 *   PAGE_LIMIT=51
 *   GEOCODE_MISSING=1       — se lat/lng=0, geocode via Wellhub /v2/search/location
 *   MUNICIPIOS_PATH | OUTPUT_PATH | PROGRESS_PATH
 */
import fs from 'fs/promises';
import path from 'path';

export type MunicipioBrasil = {
  nome: string;
  ibge: string;
  uf: string;
  populacao?: number;
  lat?: number;
  lng?: number;
};

export type GuruPassProduct = {
  id?: string;
  name?: string;
  cost_credits?: number;
  final_cost_credits?: number;
  isMain?: boolean;
  description?: string;
  [key: string]: unknown;
};

export type GuruPassGymRaw = {
  gurupass_id: string;
  name?: string;
  fullAddres?: string;
  fullAddress?: string;
  city?: string;
  neighborhood?: string;
  state?: string;
  street?: string;
  slug?: string;
  modalities?: string[];
  tags?: string[];
  products?: GuruPassProduct[];
  location?: {
    type?: string;
    coordinates?: [number, number]; // [lng, lat]
  };
  latitude?: string | number;
  longitude?: string | number;
  distance?: string;
  lowestPrice?: { name?: string; lowerPrice?: number; hasProduct?: boolean };
  uf?: string;
  municipios_busca?: string[];
  [key: string]: unknown;
};

type SearchResponse = {
  data?: GuruPassGymRaw[];
  total?: number;
  currentPage?: number;
  totalPages?: number;
};

type ProgressState = {
  completed: string[];
  failed: Array<{ nome: string; key: string; error: string }>;
  gymById: Record<string, GuruPassGymRaw>;
  geoCache: Record<string, { lat: number; lng: number }>;
  lastUpdate: string;
};

const UF_BY_IBGE_PREFIX: Record<string, string> = {
  '11': 'RO',
  '12': 'AC',
  '13': 'AM',
  '14': 'RR',
  '15': 'PA',
  '16': 'AP',
  '17': 'TO',
  '21': 'MA',
  '22': 'PI',
  '23': 'CE',
  '24': 'RN',
  '25': 'PB',
  '26': 'PE',
  '27': 'AL',
  '28': 'SE',
  '29': 'BA',
  '31': 'MG',
  '32': 'ES',
  '33': 'RJ',
  '35': 'SP',
  '41': 'PR',
  '42': 'SC',
  '43': 'RS',
  '50': 'MS',
  '51': 'MT',
  '52': 'GO',
  '53': 'DF',
};

const ROOT = process.cwd();
const MUNICIPIOS_PATH =
  process.env.MUNICIPIOS_PATH || path.join(ROOT, 'data/municipios-brasil.json');
const OUTPUT_PATH =
  process.env.OUTPUT_PATH || path.join(ROOT, 'data/raw/gurupass-brasil-all.json');
const PROGRESS_PATH =
  process.env.PROGRESS_PATH || path.join(ROOT, 'data/processed/gurupass-progress.json');

const API_BASE =
  process.env.GURUPASS_API_BASE ||
  'https://api.gurupass.com.br/user/establishments/search';
const WELLHUB_LOCATION =
  'https://mep-partner-bff.wellhub.com/v2/search/location';

const DELAY_MS = Number(process.env.DELAY_MS || 500);
const LIMIT = Number(process.env.LIMIT || 0);
const CHECKPOINT_EVERY = Number(process.env.CHECKPOINT_EVERY || 50);
const PAGE_LIMIT = Number(process.env.PAGE_LIMIT || 51);
const MAX_PAGES = Number(process.env.MAX_PAGES ?? 1); // 0 = all
const GEOCODE_MISSING = (process.env.GEOCODE_MISSING ?? '1') !== '0';
const MAX_RETRIES = 3;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function ufFromIbge(ibge: string): string {
  return UF_BY_IBGE_PREFIX[String(ibge).slice(0, 2)] || '';
}

function municipioKey(m: MunicipioBrasil): string {
  return `${m.nome}-${m.uf || ufFromIbge(m.ibge)}`;
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

function emptyProgress(): ProgressState {
  return {
    completed: [],
    failed: [],
    gymById: {},
    geoCache: {},
    lastUpdate: new Date().toISOString(),
  };
}

async function loadProgress(): Promise<ProgressState> {
  try {
    const raw = await fs.readFile(PROGRESS_PATH, 'utf-8');
    const parsed = JSON.parse(raw) as ProgressState;
    return {
      completed: Array.isArray(parsed.completed) ? parsed.completed : [],
      failed: Array.isArray(parsed.failed) ? parsed.failed : [],
      gymById: parsed.gymById && typeof parsed.gymById === 'object' ? parsed.gymById : {},
      geoCache: parsed.geoCache && typeof parsed.geoCache === 'object' ? parsed.geoCache : {},
      lastUpdate: parsed.lastUpdate || new Date().toISOString(),
    };
  } catch {
    return emptyProgress();
  }
}

async function saveProgress(state: ProgressState): Promise<void> {
  state.lastUpdate = new Date().toISOString();
  await fs.mkdir(path.dirname(PROGRESS_PATH), { recursive: true });
  await fs.writeFile(PROGRESS_PATH, JSON.stringify(state, null, 2), 'utf-8');
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

async function geocodeWellhub(
  nome: string,
  uf: string,
): Promise<{ lat: number; lng: number } | null> {
  const term = encodeURIComponent(`${nome}-${uf}`);
  const url = `${WELLHUB_LOCATION}?maxResults=4&locale=pt-br&term=${term}`;
  const res = await fetchWithRetry(url);
  if (!res.ok) return null;
  const hits = (await res.json()) as Array<{
    stateCode?: string;
    location?: { lat?: number; lon?: number };
  }>;
  if (!Array.isArray(hits) || !hits.length) return null;
  const preferred =
    hits.find(
      (h) =>
        String(h.stateCode || '').toUpperCase() === uf &&
        typeof h.location?.lat === 'number' &&
        typeof h.location?.lon === 'number',
    ) ||
    hits.find((h) => typeof h.location?.lat === 'number' && typeof h.location?.lon === 'number');
  if (!preferred?.location) return null;
  return { lat: preferred.location.lat as number, lng: preferred.location.lon as number };
}

function buildSearchUrl(lat: number, lng: number, page: number): string {
  const params = new URLSearchParams({
    limit: String(PAGE_LIMIT),
    longitude: String(lng),
    latitude: String(lat),
    includeEstablishmentGroups: 'true',
  });
  if (page > 1) params.set('page', String(page));
  return `${API_BASE}?${params.toString()}`;
}

function gymId(g: GuruPassGymRaw): string | null {
  const id = g.gurupass_id || (g as { id?: string }).id;
  return typeof id === 'string' && id.length ? id : null;
}

function mergeGym(
  map: Map<string, GuruPassGymRaw>,
  gym: GuruPassGymRaw,
  uf: string,
  municipioNome: string,
): void {
  const id = gymId(gym);
  if (!id) return;
  const existing = map.get(id);
  if (!existing) {
    map.set(id, {
      ...gym,
      gurupass_id: id,
      uf,
      municipios_busca: [municipioNome],
    });
    return;
  }
  const related = new Set(existing.municipios_busca || []);
  related.add(municipioNome);
  existing.municipios_busca = Array.from(related);
  if (!existing.uf) existing.uf = uf;
}

async function fetchMunicipioPages(
  lat: number,
  lng: number,
): Promise<GuruPassGymRaw[]> {
  const all: GuruPassGymRaw[] = [];
  let page = 1;
  let totalPages = 1;

  while (true) {
    const url = buildSearchUrl(lat, lng, page);
    const res = await fetchWithRetry(url);
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}: ${await res.text().catch(() => '')}`);
    }
    const json = (await res.json()) as SearchResponse | GuruPassGymRaw[];
    const rows = Array.isArray(json)
      ? json
      : Array.isArray(json.data)
        ? json.data
        : [];
    all.push(...rows);

    if (Array.isArray(json)) break;
    totalPages = Number(json.totalPages || 1);
    const cap = MAX_PAGES === 0 ? totalPages : Math.min(MAX_PAGES, totalPages);
    if (page >= cap) break;
    page += 1;
    await sleep(Math.min(DELAY_MS, 300));
  }

  return all;
}

async function writeFinalOutput(
  gymMap: Map<string, GuruPassGymRaw>,
  totalMunicipios: number,
): Promise<void> {
  const data = Array.from(gymMap.values());
  const payload = {
    data,
    metadata: {
      totalGyms: data.length,
      totalMunicipios,
      timestamp: new Date().toISOString(),
      source: 'gurupass_api',
    },
  };
  await fs.mkdir(path.dirname(OUTPUT_PATH), { recursive: true });
  await fs.writeFile(OUTPUT_PATH, JSON.stringify(payload, null, 2), 'utf-8');
}

async function main(): Promise<void> {
  console.log('Scrape GuruPass Brasil (API REST)\n');
  console.log(
    `DELAY_MS=${DELAY_MS} PAGE_LIMIT=${PAGE_LIMIT} MAX_PAGES=${MAX_PAGES || 'all'} GEOCODE_MISSING=${GEOCODE_MISSING}`,
  );

  let municipios: MunicipioBrasil[];
  try {
    municipios = JSON.parse(await fs.readFile(MUNICIPIOS_PATH, 'utf-8')) as MunicipioBrasil[];
  } catch {
    console.error(`Arquivo ausente: ${MUNICIPIOS_PATH}`);
    console.error('Rode: npm run fetch:municipios-br');
    process.exit(1);
  }

  if (!Array.isArray(municipios) || !municipios.length) {
    console.error('Lista de municípios inválida');
    process.exit(1);
  }

  for (const m of municipios) {
    if (!m.uf) m.uf = ufFromIbge(m.ibge);
  }

  municipios = [...municipios].sort(
    (a, b) => (b.populacao || 0) - (a.populacao || 0) || a.nome.localeCompare(b.nome),
  );

  if (LIMIT > 0) {
    municipios = municipios.slice(0, LIMIT);
    console.log(`LIMIT=${LIMIT} → ${municipios.length}`);
  }

  const progress = await loadProgress();
  const completed = new Set(progress.completed);
  const gymMap = new Map<string, GuruPassGymRaw>(Object.entries(progress.gymById));
  const geoCache = { ...progress.geoCache };

  console.log(
    `Checkpoint: completed=${completed.size} gyms=${gymMap.size} failed=${progress.failed.length}`,
  );

  const pending = municipios.filter((m) => !completed.has(municipioKey(m)));
  console.log(`Pendentes: ${pending.length}/${municipios.length}\n`);

  let sinceCheckpoint = 0;
  let idx = 0;

  for (const mun of pending) {
    idx += 1;
    const key = municipioKey(mun);
    const uf = mun.uf || ufFromIbge(mun.ibge);
    process.stdout.write(`[${idx}/${pending.length}] ${key} `);

    try {
      let lat = mun.lat;
      let lng = mun.lng;

      if (!hasCoords(lat, lng)) {
        const cached = geoCache[key];
        if (cached && hasCoords(cached.lat, cached.lng)) {
          lat = cached.lat;
          lng = cached.lng;
        } else if (GEOCODE_MISSING) {
          const geo = await geocodeWellhub(mun.nome, uf);
          if (!geo) throw new Error('sem coordenadas (geocode falhou)');
          lat = geo.lat;
          lng = geo.lng;
          geoCache[key] = geo;
        } else {
          throw new Error('sem coordenadas (lat/lng=0)');
        }
      }

      const rows = await fetchMunicipioPages(lat as number, lng as number);
      for (const g of rows) mergeGym(gymMap, g, uf, mun.nome);
      console.log(`→ ${rows.length} (únicas=${gymMap.size})`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.log(`→ ERRO ${message}`);
      progress.failed.push({ nome: mun.nome, key, error: message });
    }

    completed.add(key);
    progress.completed = Array.from(completed);
    progress.gymById = Object.fromEntries(gymMap);
    progress.geoCache = geoCache;
    sinceCheckpoint += 1;

    if (sinceCheckpoint >= CHECKPOINT_EVERY) {
      await saveProgress(progress);
      await writeFinalOutput(gymMap, municipios.length);
      sinceCheckpoint = 0;
      console.log(`  💾 checkpoint (${completed.size} mun · ${gymMap.size} gyms)`);
    }

    await sleep(DELAY_MS);
  }

  progress.completed = Array.from(completed);
  progress.gymById = Object.fromEntries(gymMap);
  progress.geoCache = geoCache;
  await saveProgress(progress);
  await writeFinalOutput(gymMap, municipios.length);

  console.log('\n=== Estatísticas ===');
  console.log(`Rodada: ${pending.length}`);
  console.log(`Completed: ${completed.size}`);
  console.log(`Gyms únicas: ${gymMap.size}`);
  console.log(`Falhas: ${progress.failed.length}`);
  console.log(`Output: ${OUTPUT_PATH}`);
}

main().catch((err) => {
  console.error('Erro fatal:', err);
  process.exit(1);
});
