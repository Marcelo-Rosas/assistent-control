/**
 * Busca em lote academias TotalPass nos maiores municípios de SP.
 * Grid 3x3 (~4.5–5 km) nas metrópoles para contornar cap ~200 da API.
 *
 * Input:  data/municipios-sp-coords.json
 * Output: data/processed/totalpass-sp-all.json
 *
 * Env:
 *   KM_RADIUS=5
 *   MAX_CONCURRENT=3
 *   DELAY_BETWEEN_BATCHES_MS=1000
 *   GRID_TOP_N=15          # primeiros N do JSON (já ordenados por pop) viram grid 3x3
 *   GRID_OFFSET_DEG=0.045  # ~5 km
 *   LIMIT=27               # trunca pontos de busca (teste; 3 cidades×9 = 27)
 *
 * Run: npx tsx scripts/fetch-all-sp-gyms.ts
 */
import fs from 'fs/promises';
import path from 'path';

type Municipio = {
  nome: string;
  ibge: string;
  lat: number;
  lng: number;
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
  featured_modality_id?: string;
  [key: string]: unknown;
};

type Gym = {
  id: string;
  type: string;
  attributes: GymAttributes;
};

const API_BASE = 'https://totalpass.com/api/website/gyms/';
const KM_RADIUS = Number(process.env.KM_RADIUS || 5);
const MAX_CONCURRENT = Number(process.env.MAX_CONCURRENT || 3);
const DELAY_BETWEEN_BATCHES = Number(process.env.DELAY_BETWEEN_BATCHES_MS || 1000);
const GRID_TOP_N = Number(process.env.GRID_TOP_N || 15);
const GRID_OFFSET_DEG = Number(process.env.GRID_OFFSET_DEG || 0.045);
const MAX_RETRIES = 3;

const ROOT = process.cwd();
const MUNICIPIOS_PATH =
  process.env.MUNICIPIOS_PATH || path.join(ROOT, 'data/municipios-sp-coords.json');
const OUTPUT_PATH =
  process.env.OUTPUT_PATH || path.join(ROOT, 'data/processed/totalpass-sp-all.json');

/** Fallback explícito (top densas). Complementado por GRID_TOP_N na ordem do JSON. */
const LARGE_CITY_IBGES = new Set([
  '3550308', // São Paulo
  '3518800', // Guarulhos
  '3509502', // Campinas
  '3548708', // São Bernardo do Campo
  '3547809', // Santo André
  '3552205', // Sorocaba
  '3534401', // Osasco
  '3543402', // Ribeirão Preto
  '3549904', // São José dos Campos
  '3549805', // São José do Rio Preto
  '3530607', // Mogi das Cruzes
  '3525904', // Jundiaí
  '3538709', // Piracicaba
  '3548500', // Santos
  '3529401', // Mauá
  '3513801', // Diadema
]);

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

function buildUrl(municipio: Municipio): string {
  const params = new URLSearchParams({
    locale: 'pt-BR',
    'current_location[latitude]': String(municipio.lat),
    'current_location[longitude]': String(municipio.lng),
    'location[latitude]': String(municipio.lat),
    'location[longitude]': String(municipio.lng),
    km_radius: String(KM_RADIUS),
  });
  return `${API_BASE}?${params.toString()}`;
}

async function fetchGymsForMunicipio(municipio: Municipio): Promise<Gym[]> {
  const url = buildUrl(municipio);
  const res = await fetchWithRetry(url);

  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${await res.text().catch(() => '')}`);
  }

  const json = (await res.json()) as { data?: Gym[] };
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
        location: g.attributes?.location || { lat: municipio.lat, lng: municipio.lng },
      },
    }));
}

/**
 * Municípios pequenos: 1 ponto (centroide).
 * Grandes: grid 3x3 (9 buscas). Dedup usa `nome` original.
 */
function expandirCidadesGrandes(municipios: Municipio[]): Municipio[] {
  const topNIbges = new Set(municipios.slice(0, Math.max(0, GRID_TOP_N)).map((m) => m.ibge));
  const gridIbges = new Set([...LARGE_CITY_IBGES, ...topNIbges]);

  const expanded: Municipio[] = [];
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
          nome: m.nome,
          ibge: m.ibge,
          lat: m.lat + i * GRID_OFFSET_DEG,
          lng: m.lng + j * GRID_OFFSET_DEG,
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

function mergeGym(map: Map<string, Gym>, gym: Gym, municipioNome: string): void {
  const existing = map.get(gym.id);
  if (!existing) {
    map.set(gym.id, {
      ...gym,
      attributes: {
        ...gym.attributes,
        municipios_relacionados: [municipioNome],
      },
    });
    return;
  }

  const related = new Set(existing.attributes.municipios_relacionados || []);
  related.add(municipioNome);
  existing.attributes.municipios_relacionados = Array.from(related);
}

async function processBatch(
  municipios: Municipio[],
): Promise<Array<{ municipio: Municipio; gyms: Gym[]; error?: string }>> {
  return Promise.all(
    municipios.map(async (municipio) => {
      try {
        const gyms = await fetchGymsForMunicipio(municipio);
        return { municipio, gyms };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { municipio, gyms: [], error: message };
      }
    }),
  );
}

async function main(): Promise<void> {
  console.log('Fetch TotalPass SP (grid metrópoles)\n');
  console.log(
    `KM_RADIUS=${KM_RADIUS} MAX_CONCURRENT=${MAX_CONCURRENT} DELAY=${DELAY_BETWEEN_BATCHES}ms`,
  );

  const raw = await fs.readFile(MUNICIPIOS_PATH, 'utf-8');
  const municipiosBase: Municipio[] = JSON.parse(raw);
  if (!Array.isArray(municipiosBase) || !municipiosBase.length) {
    throw new Error(`Lista inválida: ${MUNICIPIOS_PATH}`);
  }

  let pontos = expandirCidadesGrandes(municipiosBase);
  console.log(`Municípios base: ${municipiosBase.length} → pontos de busca: ${pontos.length}\n`);

  const limit = Number(process.env.LIMIT || 0);
  if (limit > 0) {
    pontos = pontos.slice(0, limit);
    console.log(`LIMIT=${limit} → ${pontos.length} pontos (teste)\n`);
  }

  const gymMap = new Map<string, Gym>();
  let processed = 0;
  let emptyCount = 0;
  let errorCount = 0;
  const failed: Array<{ nome: string; error: string }> = [];

  for (let i = 0; i < pontos.length; i += MAX_CONCURRENT) {
    const batch = pontos.slice(i, i + MAX_CONCURRENT);
    const batchIndex = Math.floor(i / MAX_CONCURRENT) + 1;
    const batchTotal = Math.ceil(pontos.length / MAX_CONCURRENT);
    console.log(`Lote ${batchIndex}/${batchTotal}…`);

    const results = await processBatch(batch);

    for (const result of results) {
      processed += 1;
      const label = result.municipio.search_label || result.municipio.nome;
      const prefix = `[${processed}/${pontos.length}] ${label}`;

      if (result.error) {
        errorCount += 1;
        failed.push({ nome: label, error: result.error });
        console.warn(`${prefix} — ERRO: ${result.error}`);
        continue;
      }

      if (!result.gyms.length) {
        emptyCount += 1;
        continue;
      }

      for (const gym of result.gyms) {
        mergeGym(gymMap, gym, result.municipio.nome);
      }
      console.log(`${prefix} — ${result.gyms.length} gyms (únicas: ${gymMap.size})`);
    }

    if (i + MAX_CONCURRENT < pontos.length) {
      await sleep(DELAY_BETWEEN_BATCHES);
    }
  }

  const data = Array.from(gymMap.values()).map((g) => {
    const { distance: _distance, ...attrs } = g.attributes as GymAttributes & {
      distance?: unknown;
    };
    return { id: g.id, type: g.type, attributes: attrs };
  });

  await fs.mkdir(path.dirname(OUTPUT_PATH), { recursive: true });
  await fs.writeFile(OUTPUT_PATH, JSON.stringify({ data }, null, 2), 'utf-8');

  console.log('\n=== Estatísticas ===');
  console.log(`Pontos processados: ${processed}`);
  console.log(`Pontos sem academias: ${emptyCount}`);
  console.log(`Pontos com erro: ${errorCount}`);
  console.log(`Academias únicas: ${data.length}`);
  console.log(`Output: ${OUTPUT_PATH}`);

  if (failed.length) {
    console.log('Falhas (até 10):');
    for (const f of failed.slice(0, 10)) {
      console.log(`  - ${f.nome}: ${f.error}`);
    }
  }
}

main().catch((err) => {
  console.error('Erro fatal:', err);
  process.exit(1);
});
