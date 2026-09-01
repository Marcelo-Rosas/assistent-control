/**
 * Baixa municípios BR (IBGE) + pop estimada + coords (Wellhub location).
 * Output: data/municipios-brasil.json
 *
 * Run: npm run fetch:municipios-br
 *
 * Env:
 *   SKIP_GEO=1           — pula Wellhub geocode (lat/lng=0)
 *   GEO_CONCURRENCY=5
 *   GEO_DELAY_MS=150
 *   LIMIT=0              — teto de municípios (teste)
 *   OUTPUT_PATH
 *   SEED_SP_PATH         — reusa coords SP se existir
 */
import fs from 'fs/promises';
import path from 'path';

export type MunicipioBrasil = {
  nome: string;
  ibge: string;
  uf: string;
  populacao: number;
  lat: number;
  lng: number;
};

type IbgeMunicipio = {
  id: number;
  nome: string;
};

type WellhubLocationHit = {
  label?: string;
  municipality?: string;
  stateCode?: string;
  location?: { lat?: number; lon?: number };
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

const UF_CODES = Object.keys(UF_BY_IBGE_PREFIX);
const ROOT = process.cwd();
const OUTPUT_PATH =
  process.env.OUTPUT_PATH || path.join(ROOT, 'data/municipios-brasil.json');
const SEED_SP_PATH =
  process.env.SEED_SP_PATH || path.join(ROOT, 'data/municipios-sp-coords.json');
const SKIP_GEO = process.env.SKIP_GEO === '1';
const GEO_CONCURRENCY = Number(process.env.GEO_CONCURRENCY || 5);
const GEO_DELAY_MS = Number(process.env.GEO_DELAY_MS || 150);
const LIMIT = Number(process.env.LIMIT || 0);
const MAX_RETRIES = 3;

const WELLHUB_LOCATION =
  'https://mep-partner-bff.wellhub.com/v2/search/location';

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function ufFromIbge(ibge: string): string {
  const prefix = String(ibge).slice(0, 2);
  const uf = UF_BY_IBGE_PREFIX[prefix];
  if (!uf) throw new Error(`UF desconhecida para IBGE ${ibge}`);
  return uf;
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

async function fetchMunicipiosPorUf(ufCode: string): Promise<IbgeMunicipio[]> {
  const url = `https://servicodados.ibge.gov.br/api/v1/localidades/estados/${ufCode}/municipios`;
  const res = await fetchWithRetry(url);
  if (!res.ok) {
    throw new Error(`IBGE municipios UF ${ufCode}: HTTP ${res.status}`);
  }
  const json = (await res.json()) as IbgeMunicipio[];
  return Array.isArray(json) ? json : [];
}

/** População estimada IBGE (agregado 6579 / variável 9324). */
async function fetchPopulacaoMap(): Promise<Map<string, number>> {
  const url =
    'https://servicodados.ibge.gov.br/api/v3/agregados/6579/periodos/2024/variaveis/9324?localidades=N6[all]';
  console.log('Baixando estimativas de população IBGE 2024…');
  const res = await fetchWithRetry(url);
  if (!res.ok) {
    console.warn(`População IBGE falhou HTTP ${res.status} — populacao=0`);
    return new Map();
  }

  const json = (await res.json()) as Array<{
    resultados?: Array<{
      series?: Array<{
        localidade?: { id?: string };
        serie?: Record<string, string>;
      }>;
    }>;
  }>;

  const map = new Map<string, number>();
  for (const bloco of json || []) {
    for (const resultado of bloco.resultados || []) {
      for (const serie of resultado.series || []) {
        const id = String(serie.localidade?.id || '');
        const raw = serie.serie?.['2024'] ?? serie.serie?.['2023'] ?? '';
        const n = Number(String(raw).replace(/\D/g, ''));
        if (id && Number.isFinite(n)) map.set(id, n);
      }
    }
  }
  console.log(`Populações carregadas: ${map.size}`);
  return map;
}

async function loadSeedSpCoords(): Promise<Map<string, { lat: number; lng: number }>> {
  const map = new Map<string, { lat: number; lng: number }>();
  try {
    const raw = await fs.readFile(SEED_SP_PATH, 'utf-8');
    const rows = JSON.parse(raw) as Array<{ ibge: string; lat: number; lng: number }>;
    for (const r of rows) {
      if (r?.ibge && typeof r.lat === 'number' && typeof r.lng === 'number') {
        map.set(String(r.ibge), { lat: r.lat, lng: r.lng });
      }
    }
    console.log(`Seed SP coords: ${map.size} municípios`);
  } catch {
    console.log('Seed SP coords ausente — geocode Wellhub para todos');
  }
  return map;
}

async function geocodeWellhub(
  nome: string,
  uf: string,
): Promise<{ lat: number; lng: number } | null> {
  const term = encodeURIComponent(`${nome}-${uf}`);
  const url = `${WELLHUB_LOCATION}?maxResults=4&locale=pt-br&term=${term}`;
  const res = await fetchWithRetry(url);
  if (!res.ok) return null;
  const hits = (await res.json()) as WellhubLocationHit[];
  if (!Array.isArray(hits) || !hits.length) return null;

  const preferred =
    hits.find(
      (h) =>
        String(h.stateCode || '').toUpperCase() === uf &&
        typeof h.location?.lat === 'number' &&
        typeof h.location?.lon === 'number',
    ) || hits.find((h) => typeof h.location?.lat === 'number' && typeof h.location?.lon === 'number');

  if (!preferred?.location) return null;
  return { lat: preferred.location.lat as number, lng: preferred.location.lon as number };
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
  console.log('Fetch municípios Brasil (IBGE + Wellhub geo)\n');

  const popMap = await fetchPopulacaoMap();
  const seedSp = await loadSeedSpCoords();

  const municipios: MunicipioBrasil[] = [];
  for (const ufCode of UF_CODES) {
    const uf = UF_BY_IBGE_PREFIX[ufCode];
    process.stdout.write(`\rIBGE UF ${uf} (${ufCode})…`);
    const rows = await fetchMunicipiosPorUf(ufCode);
    for (const row of rows) {
      const ibge = String(row.id);
      municipios.push({
        nome: row.nome,
        ibge,
        uf,
        populacao: popMap.get(ibge) ?? 0,
        lat: 0,
        lng: 0,
      });
    }
    await sleep(100);
  }
  console.log(`\nMunicípios IBGE: ${municipios.length}`);

  municipios.sort((a, b) => b.populacao - a.populacao || a.nome.localeCompare(b.nome));

  let work = municipios;
  if (LIMIT > 0) {
    work = municipios.slice(0, LIMIT);
    console.log(`LIMIT=${LIMIT} → ${work.length} municípios`);
  }

  if (SKIP_GEO) {
    console.log('SKIP_GEO=1 — lat/lng ficam 0 (exceto seed SP)');
    for (const m of work) {
      const seed = seedSp.get(m.ibge);
      if (seed) {
        m.lat = seed.lat;
        m.lng = seed.lng;
      }
    }
  } else {
    console.log(
      `Geocode Wellhub: concurrency=${GEO_CONCURRENCY} delay=${GEO_DELAY_MS}ms`,
    );
    let done = 0;
    let geoOk = 0;
    let geoFail = 0;

    await mapPool(work, GEO_CONCURRENCY, async (m) => {
      const seed = seedSp.get(m.ibge);
      if (seed) {
        m.lat = seed.lat;
        m.lng = seed.lng;
        geoOk += 1;
      } else {
        try {
          const geo = await geocodeWellhub(m.nome, m.uf);
          if (geo) {
            m.lat = geo.lat;
            m.lng = geo.lng;
            geoOk += 1;
          } else {
            geoFail += 1;
          }
        } catch {
          geoFail += 1;
        }
        await sleep(GEO_DELAY_MS);
      }
      done += 1;
      if (done % 50 === 0 || done === work.length) {
        process.stdout.write(
          `\rGeo ${done}/${work.length} ok=${geoOk} fail=${geoFail}   `,
        );
      }
      return m;
    });
    console.log('\n');
  }

  // Se LIMIT, ainda assim grava só o subset? Task quer ~5570 — grava `work` ordenado.
  // Se LIMIT=0, work === todos.
  const finalList = LIMIT > 0 ? work : municipios;
  // sincroniza coords de work de volta em municipios quando LIMIT=0 (same refs)
  if (LIMIT === 0) {
    // refs already updated
  }

  await fs.mkdir(path.dirname(OUTPUT_PATH), { recursive: true });
  await fs.writeFile(OUTPUT_PATH, JSON.stringify(finalList, null, 2), 'utf-8');

  const withCoords = finalList.filter((m) => m.lat !== 0 || m.lng !== 0).length;
  console.log('=== Estatísticas ===');
  console.log(`Total: ${finalList.length}`);
  console.log(`Com coords: ${withCoords}`);
  console.log(`Sem coords: ${finalList.length - withCoords}`);
  console.log(`Output: ${OUTPUT_PATH}`);
  console.log('\nPróximo: npm run scrape:wellhub-br');
}

main().catch((err) => {
  console.error('Erro fatal:', err);
  process.exit(1);
});
