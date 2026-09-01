/**
 * Scrape GuruPass BR — API REST pública (Pass 2 / citySlug).
 *
 * GET https://api.gurupass.com.br/user/establishments/search
 *   ?citySlug={slug}&page=N&limit=200
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
 *   MAX_PAGES=0             — páginas por município (0 = todas)
 *   PAGE_LIMIT=200
 *   FORCE_RESCrape=0        — limpa completed e reprocessa tudo
 *   MUNICIPIOS_PATH | OUTPUT_PATH | PROGRESS_PATH
 */
import fs from 'fs/promises';
import path from 'path';
import {
  GURUPASS_PAGE_LIMIT,
  listSearchRawByCitySlug,
  slugifyCity,
  type GuruPassProduct,
  type GuruPassSearchGymRaw,
} from './lib/gurupassDetailSchema.ts';

export type MunicipioBrasil = {
  nome: string;
  ibge: string;
  uf: string;
  populacao?: number;
  lat?: number;
  lng?: number;
};

/** @deprecated use GuruPassSearchGymRaw — mantido para ingest/normalize */
export type GuruPassGymRaw = GuruPassSearchGymRaw & {
  gurupass_id: string;
  uf?: string;
  municipios_busca?: string[];
  city_slugs_busca?: string[];
};

export type { GuruPassProduct };

const PROGRESS_VERSION = 2;

type ProgressState = {
  progressVersion?: number;
  searchMode?: 'citySlug';
  completed: string[];
  failed: Array<{ nome: string; key: string; citySlug?: string; error: string }>;
  gymById: Record<string, GuruPassGymRaw>;
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

const DELAY_MS = Number(process.env.DELAY_MS || 500);
const LIMIT = Number(process.env.LIMIT || 0);
const CHECKPOINT_EVERY = Number(process.env.CHECKPOINT_EVERY || 50);
const PAGE_LIMIT = Number(process.env.PAGE_LIMIT || GURUPASS_PAGE_LIMIT);
const MAX_PAGES = Number(process.env.MAX_PAGES ?? 0);
const FORCE_RESCrape = (process.env.FORCE_RESCrape ?? '0') === '1';

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function ufFromIbge(ibge: string): string {
  return UF_BY_IBGE_PREFIX[String(ibge).slice(0, 2)] || '';
}

function municipioKey(m: MunicipioBrasil): string {
  return `${m.nome}-${m.uf || ufFromIbge(m.ibge)}`;
}

function citySlugFor(m: MunicipioBrasil): string {
  return slugifyCity(m.nome);
}

function emptyProgress(): ProgressState {
  return {
    progressVersion: PROGRESS_VERSION,
    searchMode: 'citySlug',
    completed: [],
    failed: [],
    gymById: {},
    lastUpdate: new Date().toISOString(),
  };
}

async function loadGymMapFromOutput(): Promise<Map<string, GuruPassGymRaw>> {
  try {
    const raw = JSON.parse(await fs.readFile(OUTPUT_PATH, 'utf-8')) as
      | GuruPassGymRaw[]
      | { data?: GuruPassGymRaw[] };
    const rows = Array.isArray(raw) ? raw : raw.data ?? [];
    const map = new Map<string, GuruPassGymRaw>();
    for (const g of rows) {
      const id = gymId(g);
      if (!id) continue;
      map.set(id, { ...g, gurupass_id: id });
    }
    return map;
  } catch {
    return new Map();
  }
}

async function loadProgress(): Promise<ProgressState> {
  try {
    const raw = await fs.readFile(PROGRESS_PATH, 'utf-8');
    const parsed = JSON.parse(raw) as ProgressState;
    const base: ProgressState = {
      progressVersion: parsed.progressVersion,
      searchMode: parsed.searchMode,
      completed: Array.isArray(parsed.completed) ? parsed.completed : [],
      failed: Array.isArray(parsed.failed) ? parsed.failed : [],
      gymById: parsed.gymById && typeof parsed.gymById === 'object' ? parsed.gymById : {},
      lastUpdate: parsed.lastUpdate || new Date().toISOString(),
    };

    if (FORCE_RESCrape) {
      console.log('FORCE_RESCrape=1 → limpando completed (mantém gymById para merge)');
      base.completed = [];
      base.failed = [];
    } else if (base.progressVersion !== PROGRESS_VERSION || base.searchMode !== 'citySlug') {
      console.log(
        `Migrando progress v${base.progressVersion ?? 1} → v${PROGRESS_VERSION} (citySlug) — re-scrape de todos os municípios`,
      );
      base.completed = [];
      base.failed = [];
    }

    base.progressVersion = PROGRESS_VERSION;
    base.searchMode = 'citySlug';
    return base;
  } catch {
    return emptyProgress();
  }
}

async function saveProgress(state: ProgressState): Promise<void> {
  state.lastUpdate = new Date().toISOString();
  state.progressVersion = PROGRESS_VERSION;
  state.searchMode = 'citySlug';
  await fs.mkdir(path.dirname(PROGRESS_PATH), { recursive: true });
  const slim = {
    progressVersion: state.progressVersion,
    searchMode: state.searchMode,
    completed: state.completed,
    failed: state.failed,
    lastUpdate: state.lastUpdate,
    gym_count: Object.keys(state.gymById).length,
  };
  const tmp = `${PROGRESS_PATH}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(slim), 'utf-8');
  await fs.rename(tmp, PROGRESS_PATH);
}

function gymId(g: GuruPassSearchGymRaw): string | null {
  const id = g.gurupass_id || g.id;
  return typeof id === 'string' && id.length ? id : null;
}

function mergeGym(
  map: Map<string, GuruPassGymRaw>,
  gym: GuruPassSearchGymRaw,
  uf: string,
  municipioNome: string,
  citySlug: string,
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
      city_slugs_busca: [citySlug],
    });
    return;
  }
  const municipios = new Set(existing.municipios_busca || []);
  municipios.add(municipioNome);
  existing.municipios_busca = Array.from(municipios);

  const slugs = new Set(existing.city_slugs_busca || []);
  slugs.add(citySlug);
  existing.city_slugs_busca = Array.from(slugs);

  if (!existing.uf) existing.uf = uf;
}

async function fetchMunicipioByCitySlug(citySlug: string): Promise<GuruPassSearchGymRaw[]> {
  const { rows } = await listSearchRawByCitySlug(citySlug, {
    limit: PAGE_LIMIT,
    maxPages: MAX_PAGES,
    delayMs: DELAY_MS,
  });
  return rows;
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
      searchMode: 'citySlug',
      pageLimit: PAGE_LIMIT,
    },
  };
  await fs.mkdir(path.dirname(OUTPUT_PATH), { recursive: true });
  await fs.writeFile(OUTPUT_PATH, JSON.stringify(payload, null, 2), 'utf-8');
}

async function main(): Promise<void> {
  console.log('Scrape GuruPass Brasil (API citySlug)\n');
  console.log(
    `DELAY_MS=${DELAY_MS} PAGE_LIMIT=${PAGE_LIMIT} MAX_PAGES=${MAX_PAGES || 'all'} FORCE_RESCrape=${FORCE_RESCrape}`,
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
  const gymMap =
    Object.keys(progress.gymById).length > 0
      ? new Map<string, GuruPassGymRaw>(Object.entries(progress.gymById))
      : await loadGymMapFromOutput();

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
    const citySlug = citySlugFor(mun);
    process.stdout.write(`[${idx}/${pending.length}] ${key} slug=${citySlug} `);

    try {
      const rows = await fetchMunicipioByCitySlug(citySlug);
      for (const g of rows) mergeGym(gymMap, g, uf, mun.nome, citySlug);
      console.log(`→ ${rows.length} (únicas=${gymMap.size})`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.log(`→ ERRO ${message}`);
      progress.failed.push({ nome: mun.nome, key, citySlug, error: message });
    }

    completed.add(key);
    progress.completed = Array.from(completed);
    progress.gymById = Object.fromEntries(gymMap);
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
