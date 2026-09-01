/**
 * Scrape TotalPass BR — API website/gyms + grid 3x3 nas top cidades.
 *
 * GET https://totalpass.com/api/website/gyms/
 *   location[lat/lng], km_radius — cap ~200 por ponto; grid contorna.
 *
 * Input:  data/municipios-brasil.json (só com coords válidas)
 * Output: data/raw/totalpass-brasil-all.json  { data, metadata }
 * Checkpoint: data/processed/totalpass-progress.json
 *
 * Run: npm run fetch:totalpass-br
 *
 * Env:
 *   DELAY_MS=1000           — entre lotes (alias DELAY_BETWEEN_BATCHES_MS)
 *   LIMIT=0                 — teto de municípios base (smoke)
 *   CHECKPOINT_EVERY=50
 *   GRID_TOP_N=80           — top N por pop viram grid 3x3
 *   GRID_OFFSET_DEG=0.045
 *   KM_RADIUS=5
 *   MAX_CONCURRENT=3
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
  search_label?: string;
};

type GymAttributes = {
  name: string;
  full_address: string;
  location: { lat: number; lng: number };
  slug?: string;
  identifier?: string;
  accessible_from_company_plan?: unknown;
  accessible_on_plans?: unknown[];
  municipios_relacionados?: string[];
  uf?: string;
  municipios_busca?: string[];
  featured_modality_id?: string;
  [key: string]: unknown;
};

export type TotalPassGym = {
  id: string;
  type: string;
  attributes: GymAttributes;
};

type ProgressState = {
  completed: string[];
  failed: Array<{ nome: string; key: string; error: string }>;
  gymById: Record<string, TotalPassGym>;
  lastUpdate: string;
};

const API_BASE = 'https://totalpass.com/api/website/gyms/';
const ROOT = process.cwd();
const MUNICIPIOS_PATH =
  process.env.MUNICIPIOS_PATH || path.join(ROOT, 'data/municipios-brasil.json');
const OUTPUT_PATH =
  process.env.OUTPUT_PATH || path.join(ROOT, 'data/raw/totalpass-brasil-all.json');
const PROGRESS_PATH =
  process.env.PROGRESS_PATH || path.join(ROOT, 'data/processed/totalpass-progress.json');

const KM_RADIUS = Number(process.env.KM_RADIUS || 5);
const MAX_CONCURRENT = Number(process.env.MAX_CONCURRENT || 3);
const DELAY_MS = Number(
  process.env.DELAY_MS || process.env.DELAY_BETWEEN_BATCHES_MS || 1000,
);
const GRID_TOP_N = Number(process.env.GRID_TOP_N || 80);
const GRID_OFFSET_DEG = Number(process.env.GRID_OFFSET_DEG || 0.045);
const LIMIT = Number(process.env.LIMIT || 0);
const CHECKPOINT_EVERY = Number(process.env.CHECKPOINT_EVERY || 50);
const MAX_RETRIES = 3;

/** Capitals / densas conhecidas — sempre grid, além de GRID_TOP_N. */
const LARGE_CITY_IBGES = new Set([
  '3550308', // São Paulo
  '3304557', // Rio de Janeiro
  '5300108', // Brasília
  '2927408', // Salvador
  '2304400', // Fortaleza
  '3106200', // Belo Horizonte
  '1302603', // Manaus
  '2611606', // Recife
  '4106902', // Curitiba
  '4314902', // Porto Alegre
  '5208707', // Goiânia
  '1501402', // Belém
  '2111300', // São Luís
  '3303500', // Nova Iguaçu
  '3518800', // Guarulhos
  '3509502', // Campinas
]);

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

function municipioKey(m: MunicipioBrasil): string {
  const label = m.search_label || m.nome;
  return `${label}|${m.ibge}|${m.lat},${m.lng}`;
}

function emptyProgress(): ProgressState {
  return {
    completed: [],
    failed: [],
    gymById: {},
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

function buildUrl(m: MunicipioBrasil): string {
  const params = new URLSearchParams({
    locale: 'pt-BR',
    'current_location[latitude]': String(m.lat),
    'current_location[longitude]': String(m.lng),
    'location[latitude]': String(m.lat),
    'location[longitude]': String(m.lng),
    km_radius: String(KM_RADIUS),
  });
  return `${API_BASE}?${params.toString()}`;
}

async function fetchGymsForPoint(m: MunicipioBrasil): Promise<TotalPassGym[]> {
  const res = await fetchWithRetry(buildUrl(m));
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${await res.text().catch(() => '')}`);
  }
  const json = (await res.json()) as { data?: TotalPassGym[] };
  const rows = Array.isArray(json.data) ? json.data : [];
  return rows
    .filter((g) => g && typeof g.id === 'string')
    .map((g) => ({
      id: g.id,
      type: g.type || 'gym',
      attributes: {
        ...(g.attributes || {}),
        name: g.attributes?.name || '',
        full_address: g.attributes?.full_address || '',
        location: g.attributes?.location || { lat: m.lat as number, lng: m.lng as number },
      },
    }));
}

/**
 * Municípios pequenos: 1 ponto.
 * Top N + LARGE_CITY: grid 3x3 (9 buscas).
 */
function expandirCidadesGrandes(municipios: MunicipioBrasil[]): MunicipioBrasil[] {
  const sorted = [...municipios].sort(
    (a, b) => (b.populacao || 0) - (a.populacao || 0) || a.nome.localeCompare(b.nome),
  );
  const topNIbges = new Set(sorted.slice(0, Math.max(0, GRID_TOP_N)).map((m) => m.ibge));
  const gridIbges = new Set([...LARGE_CITY_IBGES, ...topNIbges]);

  const expanded: MunicipioBrasil[] = [];
  let gridCities = 0;

  for (const m of municipios) {
    if (!gridIbges.has(m.ibge)) {
      expanded.push(m);
      continue;
    }
    gridCities += 1;
    for (let i = -1; i <= 1; i++) {
      for (let j = -1; j <= 1; j++) {
        const si = i > 0 ? `+${i}` : String(i);
        const sj = j > 0 ? `+${j}` : String(j);
        expanded.push({
          ...m,
          lat: (m.lat as number) + i * GRID_OFFSET_DEG,
          lng: (m.lng as number) + j * GRID_OFFSET_DEG,
          search_label: `${m.nome} (Grid ${si}, ${sj})`,
        });
      }
    }
  }

  console.log(
    `Grid: ${gridCities} cidades × 9 pontos (offset=${GRID_OFFSET_DEG}°) · GRID_TOP_N=${GRID_TOP_N}`,
  );
  return expanded;
}

function mergeGym(
  map: Map<string, TotalPassGym>,
  gym: TotalPassGym,
  municipioNome: string,
  uf: string,
): void {
  const existing = map.get(gym.id);
  if (!existing) {
    map.set(gym.id, {
      ...gym,
      attributes: {
        ...gym.attributes,
        municipios_relacionados: [municipioNome],
        municipios_busca: [municipioNome],
        uf,
      },
    });
    return;
  }

  const related = new Set(existing.attributes.municipios_relacionados || []);
  related.add(municipioNome);
  existing.attributes.municipios_relacionados = Array.from(related);

  const busca = new Set(existing.attributes.municipios_busca || []);
  busca.add(municipioNome);
  existing.attributes.municipios_busca = Array.from(busca);

  if (!existing.attributes.uf) existing.attributes.uf = uf;
}

async function writeFinalOutput(
  gymMap: Map<string, TotalPassGym>,
  totalMunicipios: number,
  totalPontos: number,
): Promise<void> {
  const data = Array.from(gymMap.values()).map((g) => {
    const { distance: _distance, ...attrs } = g.attributes as GymAttributes & {
      distance?: unknown;
    };
    return { id: g.id, type: g.type, attributes: attrs };
  });

  const payload = {
    data,
    metadata: {
      totalGyms: data.length,
      totalMunicipios,
      totalPontos,
      timestamp: new Date().toISOString(),
      source: 'totalpass_api',
      km_radius: KM_RADIUS,
      grid_top_n: GRID_TOP_N,
    },
  };

  await fs.mkdir(path.dirname(OUTPUT_PATH), { recursive: true });
  await fs.writeFile(OUTPUT_PATH, JSON.stringify(payload, null, 2), 'utf-8');
}

async function main(): Promise<void> {
  console.log('Scrape TotalPass Brasil (API + grid)\n');
  console.log(
    `KM_RADIUS=${KM_RADIUS} MAX_CONCURRENT=${MAX_CONCURRENT} DELAY_MS=${DELAY_MS} GRID_TOP_N=${GRID_TOP_N}`,
  );

  const raw = await fs.readFile(MUNICIPIOS_PATH, 'utf-8');
  const allMun = JSON.parse(raw) as MunicipioBrasil[];
  if (!Array.isArray(allMun) || !allMun.length) {
    throw new Error(`Lista inválida: ${MUNICIPIOS_PATH}`);
  }

  let municipios = allMun.filter((m) => hasCoords(m.lat, m.lng));
  const skippedNoCoord = allMun.length - municipios.length;
  if (skippedNoCoord) {
    console.warn(`Skip sem coords: ${skippedNoCoord}`);
  }

  municipios.sort(
    (a, b) => (b.populacao || 0) - (a.populacao || 0) || a.nome.localeCompare(b.nome),
  );

  if (LIMIT > 0) {
    municipios = municipios.slice(0, LIMIT);
    console.log(`LIMIT=${LIMIT} → ${municipios.length} municípios base`);
  }

  const pontos = expandirCidadesGrandes(municipios);
  console.log(
    `Municípios base: ${municipios.length} → pontos de busca: ${pontos.length}\n`,
  );

  const progress = await loadProgress();
  const completedSet = new Set(progress.completed);
  const gymMap = new Map<string, TotalPassGym>(Object.entries(progress.gymById));

  console.log(
    `Checkpoint: completed=${completedSet.size} gyms=${gymMap.size} failed=${progress.failed.length}`,
  );

  const pending = pontos.filter((p) => !completedSet.has(municipioKey(p)));
  console.log(`Pendentes: ${pending.length}/${pontos.length}\n`);

  let processed = 0;
  let emptyCount = 0;
  let errorCount = 0;
  let sinceCheckpoint = 0;

  for (let i = 0; i < pending.length; i += MAX_CONCURRENT) {
    const batch = pending.slice(i, i + MAX_CONCURRENT);
    const batchIndex = Math.floor(i / MAX_CONCURRENT) + 1;
    const batchTotal = Math.ceil(pending.length / MAX_CONCURRENT) || 1;
    console.log(`Lote ${batchIndex}/${batchTotal}…`);

    const results = await Promise.all(
      batch.map(async (municipio) => {
        try {
          const gyms = await fetchGymsForPoint(municipio);
          return { municipio, gyms };
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return { municipio, gyms: [] as TotalPassGym[], error: message };
        }
      }),
    );

    for (const result of results) {
      processed += 1;
      sinceCheckpoint += 1;
      const key = municipioKey(result.municipio);
      const label = result.municipio.search_label || result.municipio.nome;
      const prefix = `[${processed}/${pending.length}] ${label} (${result.municipio.uf})`;

      if (result.error) {
        errorCount += 1;
        progress.failed.push({
          nome: label,
          key,
          error: result.error,
        });
        // ainda marca completed para não loop infinito em ponto ruim
        completedSet.add(key);
        progress.completed.push(key);
        console.warn(`${prefix} — ERRO: ${result.error}`);
        continue;
      }

      completedSet.add(key);
      progress.completed.push(key);

      if (!result.gyms.length) {
        emptyCount += 1;
        console.log(`${prefix} — 0 gyms`);
        continue;
      }

      for (const gym of result.gyms) {
        mergeGym(gymMap, gym, result.municipio.nome, result.municipio.uf);
      }
      console.log(`${prefix} — ${result.gyms.length} gyms (únicas: ${gymMap.size})`);
    }

    if (sinceCheckpoint >= CHECKPOINT_EVERY || i + MAX_CONCURRENT >= pending.length) {
      progress.gymById = Object.fromEntries(gymMap);
      await saveProgress(progress);
      await writeFinalOutput(gymMap, municipios.length, pontos.length);
      sinceCheckpoint = 0;
      console.log(`  ↳ checkpoint saved (${gymMap.size} gyms)`);
    }

    if (i + MAX_CONCURRENT < pending.length) {
      await sleep(DELAY_MS);
    }
  }

  progress.gymById = Object.fromEntries(gymMap);
  await saveProgress(progress);
  await writeFinalOutput(gymMap, municipios.length, pontos.length);

  console.log('\n=== Estatísticas ===');
  console.log(`Pontos processados nesta run: ${processed}`);
  console.log(`Pontos sem academias: ${emptyCount}`);
  console.log(`Pontos com erro: ${errorCount}`);
  console.log(`Academias únicas: ${gymMap.size}`);
  console.log(`Output: ${OUTPUT_PATH}`);
  console.log(`Checkpoint: ${PROGRESS_PATH}`);

  if (progress.failed.length) {
    console.log('Falhas (até 10):');
    for (const f of progress.failed.slice(-10)) {
      console.log(`  - ${f.nome}: ${f.error}`);
    }
  }
}

main().catch((err) => {
  console.error('Erro fatal:', err);
  process.exit(1);
});
