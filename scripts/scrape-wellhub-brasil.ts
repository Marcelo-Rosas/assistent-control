/**
 * Scraper Wellhub BR — URL determinística + extract do payload Next.js.
 *
 * URL: https://wellhub.com/pt-br/search/{uf}/{slug}/?map=1
 * Dados: array de gyms embutido em self.__next_f.push (fullAddress/starterPlan).
 * Fallback: intercept /v4/search se disparar.
 *
 * Input:  data/municipios-brasil.json
 * Output: data/raw/wellhub-brasil-all.json
 * Checkpoint: data/processed/wellhub-progress.json
 *
 * Run: npm run scrape:wellhub-br
 *
 * Env:
 *   HEADLESS=true|false
 *   DELAY_MS=1000
 *   LIMIT=0
 *   CHECKPOINT_EVERY=20
 *   GOTO_TIMEOUT_MS=45000
 *   SETTLE_MS=2000
 *   GRID_THRESHOLD=90       — se cidade >= N gyms, grid 3x3 (fura teto 100)
 *   GRID_OFFSET_DEG=0.045
 *   GRID_DELAY_MS=500
 *   BAIRROS_DIR=data/geo/bairros  — catálogo oficial → tiling exaustivo (sem MAX_BAIRROS)
 *   MUNICIPIOS_PATH | OUTPUT_PATH | PROGRESS_PATH
 */
import fs from 'fs/promises';
import path from 'path';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import {
  loadBairrosCatalog,
  resolveSearchSlug,
  type BairroCatalogEntry,
  type BairrosCatalog,
} from './lib/wellhubBairrosCatalog.ts';
import {
  computeCityTimeout,
  type CityTimeoutBreakdown,
  type ScrapeOutcome,
} from './lib/wellhubTimeout.ts';

export type MunicipioBrasil = {
  nome: string;
  ibge: string;
  uf: string;
  populacao?: number;
  lat?: number;
  lng?: number;
};

export type WellhubGymRaw = {
  id: string;
  name?: string;
  fullAddress?: string;
  location?: { lat?: number; lon?: number };
  activities?: string[];
  workHours?: string[];
  starterPlan?: Record<string, unknown>;
  imageUrl?: string;
  distance?: string;
  uf?: string;
  municipios_busca?: string[];
  /** Slug distrito WH usado na busca (tiling catálogo). */
  wh_bairro_busca?: string[];
  [key: string]: unknown;
};

type ProgressState = {
  completed: string[];
  failed: Array<{ nome: string; key: string; error: string }>;
  gymById: Record<string, WellhubGymRaw>;
  lastUpdate: string;
};

const ROOT = process.cwd();
const MUNICIPIOS_PATH =
  process.env.MUNICIPIOS_PATH || path.join(ROOT, 'data/municipios-brasil.json');
const OUTPUT_PATH =
  process.env.OUTPUT_PATH || path.join(ROOT, 'data/raw/wellhub-brasil-all.json');
const PROGRESS_PATH =
  process.env.PROGRESS_PATH || path.join(ROOT, 'data/processed/wellhub-progress.json');

const HEADLESS = (process.env.HEADLESS ?? 'true').toLowerCase() !== 'false';
const DELAY_MS = Number(process.env.DELAY_MS || 1000);
const LIMIT = Number(process.env.LIMIT || 0);
const CHECKPOINT_EVERY = Number(process.env.CHECKPOINT_EVERY || 20);
const GOTO_TIMEOUT_MS = Number(process.env.GOTO_TIMEOUT_MS || 45_000);
const SETTLE_MS = Number(process.env.SETTLE_MS || 2000);
const GRID_THRESHOLD = Number(process.env.GRID_THRESHOLD || 90);
const GRID_OFFSET_DEG = Number(process.env.GRID_OFFSET_DEG || 0.045);
const GRID_DELAY_MS = Number(process.env.GRID_DELAY_MS || 500);
const MAX_BAIRROS = Number(process.env.MAX_BAIRROS || 50);
const BAIRROS_DIR =
  process.env.BAIRROS_DIR || path.join(ROOT, 'data/geo/bairros');
const RESULT_CAP = 100;
const WELLHUB_LOCATION = 'https://mep-partner-bff.wellhub.com/v2/search/location';

/** Bairros âncora — o recorte do teto 100 costuma ser só o centro. */
const SEED_BAIRROS: Record<string, string[]> = {
  'sao paulo': [
    'Pinheiros', 'Tatuapé', 'Morumbi', 'Santana', 'Vila Mariana', 'Ipiranga', 'Lapa',
    'Moema', 'Brooklin', 'Tucuruvi', 'Jabaquara', 'Butantã', 'Penha', 'Itaim Bibi',
    'Vila Madalena', 'Santo Amaro', 'Pirituba', 'Casa Verde', 'Sapopemba', 'Campo Limpo',
    'Capão Redondo', 'Interlagos', 'Itaquera', 'Mooca', 'Barra Funda', 'Perdizes',
    'Saúde', 'Anália Franco', 'Vila Leopoldina', 'Cidade Ademar', 'Grajaú', 'Jaraguá',
  ],
  'rio de janeiro': [
    'Copacabana', 'Ipanema', 'Botafogo', 'Tijuca', 'Barra da Tijuca', 'Recreio dos Bandeirantes',
    'Madureira', 'Campo Grande', 'Bangu', 'Flamengo', 'Leblon', 'Méier', 'Penha',
    'Ilha do Governador', 'Jacarepaguá', 'Santa Cruz', 'Laranjeiras', 'Centro',
  ],
  'belo horizonte': ['Savassi', 'Pampulha', 'Belvedere', 'Buritis', 'Lourdes', 'Funcionários', 'Venda Nova', 'Barreiro', 'Santa Efigênia'],
  'brasilia': ['Asa Sul', 'Asa Norte', 'Lago Sul', 'Lago Norte', 'Taguatinga', 'Ceilândia', 'Águas Claras', 'Guará', 'Sudoeste'],
  'salvador': ['Pituba', 'Barra', 'Itapuã', 'Caminho das Árvores', 'Itaigara', 'Rio Vermelho', 'Stella Maris', 'Imbuí'],
  'fortaleza': ['Aldeota', 'Meireles', 'Cocó', 'Papicu', 'Varjota', 'Mucuripe', 'Dionísio Torres', 'José de Alencar'],
  'curitiba': ['Batel', 'Água Verde', 'Centro', 'Bigorrilho', 'Portão', 'Santa Felicidade', 'Cristo Rei', 'Cabral'],
  'porto alegre': ['Moinhos de Vento', 'Auxiliadora', 'Menino Deus', 'Petrópolis', 'Bela Vista', 'Centro Histórico', 'Cidade Baixa', 'Tristeza'],
  'recife': ['Boa Viagem', 'Casa Forte', 'Espinheiro', 'Graças', 'Pina', 'Madalena', 'Boa Vista', 'Derby'],
  'goiania': ['Setor Bueno', 'Setor Marista', 'Setor Oeste', 'Jardim Goiás', 'Setor Sul', 'Nova Suíça'],
  'campinas': ['Cambuí', 'Nova Campinas', 'Taquaral', 'Barão Geraldo', 'Centro', 'Guanabara', 'Jardim Aurélia'],
  'manaus': ['Adrianópolis', 'Vieiralves', 'Centro', 'Aleixo', 'Parque 10', 'Flores', 'Ponta Negra'],
  'belem': ['Nazaré', 'Umarizal', 'Batista Campos', 'Reduto', 'Marco', 'Sacramenta'],
};

function normCityKey(nome: string): string {
  return String(nome || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function seedBairrosFor(cidade: string): string[] {
  return SEED_BAIRROS[normCityKey(cidade)] || [];
}

function catalogFileLabel(catalog: BairrosCatalog): string {
  return `${municipioSlug(catalog.cidade)}-${catalog.uf.toLowerCase()}.json`;
}

const MAX_RETRIES = 3;
/** Hard cap per município (ms) — evita hang eterno do Playwright. */
const CITY_TIMEOUT_MS = Number(process.env.CITY_TIMEOUT_MS || 180_000);

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout ${ms}ms: ${label}`)), ms);
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

/** Map mutável + contadores — rastreio determinístico de progresso. */
export type ScrapeBag = {
  gyms: Map<string, WellhubGymRaw>;
  bairros_planned: number;
  bairros_done: number;
  outcome: ScrapeOutcome;
};

export function emptyScrapeBag(): ScrapeBag {
  return { gyms: new Map(), bairros_planned: 0, bairros_done: 0, outcome: 'PENDING' };
}

/** @deprecated use ScrapeBag */
export type ScrapeProgress = ScrapeBag;

/** Timeout: devolve parcial se bag.gyms.size > 0; seta bag.outcome. */
export function withTimeoutPartial<T>(
  promise: Promise<T>,
  ms: number,
  label: string,
  getPartial: () => T | undefined,
  bag?: ScrapeBag,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      const partial = getPartial();
      const n = Array.isArray(partial) ? partial.length : 0;
      if (n > 0) {
        if (bag) bag.outcome = 'TIMEOUT_WITH_DATA';
        console.warn(`  ⏱ TIMEOUT_WITH_DATA ${ms}ms gyms=${n} (${label})`);
        resolve(partial as T);
        return;
      }
      if (bag) bag.outcome = 'TIMEOUT_EMPTY';
      reject(new Error(`timeout ${ms}ms: ${label}`));
    }, ms);
    promise.then(
      (v) => {
        clearTimeout(timer);
        if (bag) bag.outcome = 'COMPLETE';
        resolve(v);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

/** Campinas → campinas | São Paulo → sao-paulo */
export function municipioSlug(nome: string): string {
  return String(nome || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function buildSearchUrl(uf: string, nome: string): string {
  return `https://wellhub.com/pt-br/search/${String(uf).toLowerCase()}/${municipioSlug(nome)}/?map=1`;
}

export function municipioKey(m: MunicipioBrasil): string {
  return `${m.nome}-${m.uf}`;
}

function emptyProgress(): ProgressState {
  return {
    completed: [],
    failed: [],
    gymById: {},
    lastUpdate: new Date().toISOString(),
  };
}

async function loadGymMapFromOutput(): Promise<Map<string, WellhubGymRaw>> {
  try {
    const raw = JSON.parse(await fs.readFile(OUTPUT_PATH, 'utf-8')) as
      | WellhubGymRaw[]
      | { data?: WellhubGymRaw[] };
    const rows = Array.isArray(raw) ? raw : raw.data ?? [];
    const map = new Map<string, WellhubGymRaw>();
    for (const g of rows) {
      if (g?.id) map.set(g.id, g);
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
  const slim = {
    completed: state.completed,
    failed: state.failed,
    lastUpdate: state.lastUpdate,
    gym_count: Object.keys(state.gymById).length,
  };
  const tmp = `${PROGRESS_PATH}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(slim), 'utf-8');
  await fs.rename(tmp, PROGRESS_PATH);
}

function extractGymsFromPayload(payload: unknown): WellhubGymRaw[] {
  if (Array.isArray(payload)) {
    return payload.filter(
      (g): g is WellhubGymRaw =>
        !!g &&
        typeof (g as WellhubGymRaw).id === 'string' &&
        typeof (g as WellhubGymRaw).fullAddress === 'string',
    );
  }
  return [];
}

/**
 * Extrai array de academias do payload Next.js (self.__next_f.push).
 * Formato típico: [{\"id\":\"...\",\"imageUrl\":...,\"fullAddress\":...}, ...]
 */
export function extractGymsFromHtml(html: string): WellhubGymRaw[] {
  const candidates: string[] = [];

  const escapedRe = new RegExp(
    String.raw`\[\{\\"id\\":\\"[^"\\]+\\",\\"imageUrl\\":[\s\S]*?\\?"fullAddress\\?"[\s\S]*?\}\]`,
  );
  const escaped = html.match(escapedRe);
  if (escaped?.[0]) candidates.push(escaped[0]);

  const plainRe = new RegExp(
    String.raw`\[\{"id":"[^"]+","imageUrl":[\s\S]*?"fullAddress"[\s\S]*?\}\]`,
  );
  const plain = html.match(plainRe);
  if (plain?.[0]) candidates.push(plain[0]);

  for (const raw of candidates) {
    try {
      const normalized = raw.includes('\\"')
        ? raw.replace(/\\"/g, '"').replace(/\\\\/g, '\\')
        : raw;
      const parsed = JSON.parse(normalized) as unknown;
      const gyms = extractGymsFromPayload(parsed);
      if (gyms.length) return gyms;
    } catch {
      // tenta próximo candidato
    }
  }
  return [];
}

export function mergeGym(
  map: Map<string, WellhubGymRaw>,
  gym: WellhubGymRaw,
  uf: string,
  municipioNome: string,
  bairroBusca?: string,
): void {
  const existing = map.get(gym.id);
  if (!existing) {
    const wh_bairro_busca = bairroBusca ? [bairroBusca] : undefined;
    map.set(gym.id, {
      ...gym,
      uf,
      municipios_busca: [municipioNome],
      ...(wh_bairro_busca ? { wh_bairro_busca } : {}),
    });
    return;
  }
  const related = new Set(existing.municipios_busca || []);
  related.add(municipioNome);
  existing.municipios_busca = Array.from(related);
  if (!existing.uf) existing.uf = uf;
  if (bairroBusca) {
    const slugs = new Set(existing.wh_bairro_busca || []);
    slugs.add(bairroBusca);
    existing.wh_bairro_busca = Array.from(slugs);
  }
}

async function writeFinalOutput(
  gymMap: Map<string, WellhubGymRaw>,
  totalMunicipios: number,
): Promise<void> {
  const data = Array.from(gymMap.values());
  const payload = {
    data,
    metadata: {
      totalGyms: data.length,
      totalMunicipios,
      timestamp: new Date().toISOString(),
    },
  };
  await fs.mkdir(path.dirname(OUTPUT_PATH), { recursive: true });
  const tmp = `${OUTPUT_PATH}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(payload), 'utf-8');
  await fs.rename(tmp, OUTPUT_PATH);
}

async function dismissCookies(page: Page): Promise<void> {
  try {
    const btn = page.locator('#onetrust-accept-btn-handler');
    if (await btn.isVisible({ timeout: 800 })) {
      await btn.click({ timeout: 1500 });
    }
  } catch {
    // ignore
  }
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

async function geocodeMunicipio(mun: MunicipioBrasil): Promise<{ lat: number; lng: number } | null> {
  if (hasCoords(mun.lat, mun.lng)) return { lat: mun.lat as number, lng: mun.lng as number };
  const uf = String(mun.uf || '').toUpperCase();
  const term = encodeURIComponent(`${mun.nome}-${uf}`);
  try {
    const res = await fetch(`${WELLHUB_LOCATION}?maxResults=4&locale=pt-br&term=${term}`, {
      headers: { Accept: 'application/json', 'User-Agent': 'GymSitePipeline/1.0' },
    });
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
  } catch {
    return null;
  }
}

export async function scrapeSearchUrl(page: Page, url: string): Promise<WellhubGymRaw[]> {
  const intercepted: WellhubGymRaw[] = [];

  const onResponse = async (response: {
    url: () => string;
    status: () => number;
    json: () => Promise<unknown>;
  }) => {
    try {
      const u = response.url();
      if (!u.includes('/v4/search') || u.includes('recommendation')) return;
      if (response.status() !== 200) return;
      intercepted.push(...extractGymsFromPayload(await response.json()));
    } catch {
      // ignore
    }
  };

  page.on('response', onResponse);
  try {
    const res = await page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout: GOTO_TIMEOUT_MS,
    });
    if (res && res.status() >= 400) {
      throw new Error(`HTTP ${res.status()} em ${url}`);
    }

    await dismissCookies(page);

    // Espera payload / cards
    try {
      await page.waitForFunction(
        () =>
          document.documentElement.innerHTML.includes('fullAddress') ||
          /Parceiros Wellhub em/i.test(document.body?.innerText || ''),
        { timeout: GOTO_TIMEOUT_MS },
      );
    } catch {
      // settle mesmo assim
    }
    await sleep(SETTLE_MS);

    const html = await page.content();
    const fromHtml = extractGymsFromHtml(html);

    const local = new Map<string, WellhubGymRaw>();
    for (const g of fromHtml) local.set(g.id, g);
    for (const g of intercepted) local.set(g.id, g);

    const gyms = Array.from(local.values());
    if (!gyms.length) {
      throw new Error(`sem academias em ${url}`);
    }
    return gyms;
  } finally {
    page.off('response', onResponse);
  }
}

async function scrapeMunicipioOnce(
  page: Page,
  mun: MunicipioBrasil,
): Promise<WellhubGymRaw[]> {
  return scrapeSearchUrl(page, buildSearchUrl(mun.uf, mun.nome));
}

async function scrapeGeoPoint(
  page: Page,
  context: BrowserContext,
  lat: number,
  lng: number,
): Promise<WellhubGymRaw[]> {
  await context.setGeolocation({ latitude: lat, longitude: lng });
  await context.grantPermissions(['geolocation'], { origin: 'https://wellhub.com' });
  return scrapeSearchUrl(page, `https://wellhub.com/pt-br/search/?map=1`);
}

async function scrapeMunicipioWithRetry(
  page: Page,
  mun: MunicipioBrasil,
): Promise<WellhubGymRaw[]> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await scrapeMunicipioOnce(page, mun);
    } catch (err) {
      lastErr = err;
      const msg = err instanceof Error ? err.message : String(err);
      const retryable = /429|5\d\d|timeout|net::|sem academias|HTTP 5/i.test(msg);
      if (!retryable || attempt === MAX_RETRIES) break;
      const backoff = 1000 * 2 ** (attempt - 1);
      console.warn(`  retry ${attempt}/${MAX_RETRIES}: ${msg} wait=${backoff}ms`);
      await sleep(backoff);
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

function extractBairroFromAddress(addr: string, cidade: string): string | null {
  const needle = `, ${cidade} -`;
  const idx = addr.toLowerCase().lastIndexOf(needle.toLowerCase());
  if (idx < 0) return null;
  const before = addr.slice(0, idx);
  const parts = before.split(' - ');
  const last = (parts[parts.length - 1] || '').trim();
  if (!last || last.length < 3 || last.length > 48) return null;
  if (/^\d/.test(last)) return null;
  if (/conjunto|sala|loja|andar|bloco|apto|apartamento/i.test(last)) return null;
  return last;
}

function bairrosFromGyms(gyms: WellhubGymRaw[], cidade: string): string[] {
  const set = new Set<string>();
  for (const g of gyms) {
    const b = extractBairroFromAddress(String(g.fullAddress || ''), cidade);
    if (b) set.add(b);
  }
  return Array.from(set).slice(0, Math.max(1, MAX_BAIRROS));
}

export function cityTimeoutBreakdown(catalog: BairrosCatalog | null): CityTimeoutBreakdown {
  return computeCityTimeout({
    catalog_bairros: catalog?.bairros?.length ?? null,
    floor_ms: CITY_TIMEOUT_MS,
    grid_delay_ms: GRID_DELAY_MS,
    settle_ms: SETTLE_MS,
    heuristic_bairro_cap: MAX_BAIRROS,
  });
}

export function cityTimeoutMs(catalog: BairrosCatalog | null): number {
  return cityTimeoutBreakdown(catalog).timeout_ms;
}

async function scrapeBairroEntries(
  page: Page,
  mun: MunicipioBrasil,
  entries: BairroCatalogEntry[],
  local: Map<string, WellhubGymRaw>,
  label: string,
  bag?: ScrapeBag,
): Promise<number> {
  let hitCap = 0;
  if (bag) bag.bairros_planned = entries.length;
  console.log(`  ${label}: ${entries.length} bairro(s)`);

  for (const entry of entries) {
    const slug = resolveSearchSlug(entry);
    const url = buildSearchUrl(mun.uf, slug);
    try {
      const extra = await scrapeSearchUrl(page, url);
      let neu = 0;
      for (const g of extra) {
        if (!local.has(g.id)) neu += 1;
        const prev = local.get(g.id);
        const slugs = new Set(prev?.wh_bairro_busca ?? []);
        slugs.add(slug);
        local.set(g.id, {
          ...g,
          uf: mun.uf,
          municipios_busca: prev?.municipios_busca?.length
            ? [...new Set([...prev.municipios_busca, mun.nome])]
            : [mun.nome],
          wh_bairro_busca: Array.from(slugs),
        });
      }
      if (extra.length >= RESULT_CAP) hitCap += 1;
      console.log(
        `    ${slug}: +${extra.length} new=${neu} únicas=${local.size}${extra.length >= RESULT_CAP ? ' [teto]' : ''}`,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`    ${slug} (${entry.bairro}) falhou: ${msg}`);
    }
    if (bag) bag.bairros_done += 1;
    await sleep(GRID_DELAY_MS);
  }

  return hitCap;
}

async function scrapeMunicipioExhaustive(
  page: Page,
  context: BrowserContext,
  mun: MunicipioBrasil,
  catalog: BairrosCatalog,
  local: Map<string, WellhubGymRaw>,
  bag?: ScrapeBag,
): Promise<WellhubGymRaw[]> {
  const first = await scrapeMunicipioWithRetry(page, mun);
  for (const g of first) local.set(g.id, g);
  console.log(
    `  catálogo ${catalog.bairros.length} bairros · passo cidade=${first.length} únicas=${local.size}`,
  );

  const citySlug = municipioSlug(mun.nome);
  const bairros = catalog.bairros.filter((b) => resolveSearchSlug(b) !== citySlug);
  const hitCap = await scrapeBairroEntries(
    page,
    mun,
    bairros,
    local,
    'tiling exaustivo',
    bag,
  );

  if (hitCap > 0) {
    console.log(`  ${hitCap} bairro(s) no teto ${RESULT_CAP} — sub-grid local recomendado`);
  }

  if (local.size <= first.length + 20) {
    const geo = await geocodeMunicipio(mun);
    if (geo) {
      console.log(`  fallback geo grid @ ${geo.lat.toFixed(4)},${geo.lng.toFixed(4)}`);
      for (let i = -1; i <= 1; i++) {
        for (let j = -1; j <= 1; j++) {
          if (i === 0 && j === 0) continue;
          try {
            const extra = await scrapeGeoPoint(
              page,
              context,
              geo.lat + i * GRID_OFFSET_DEG,
              geo.lng + j * GRID_OFFSET_DEG,
            );
            for (const g of extra) local.set(g.id, g);
          } catch {
            // ignore
          }
          await sleep(GRID_DELAY_MS);
        }
      }
    }
  }

  return Array.from(local.values());
}

export async function scrapeMunicipioWithGrid(
  page: Page,
  context: BrowserContext,
  mun: MunicipioBrasil,
  catalog: BairrosCatalog | null,
  bag?: ScrapeBag,
): Promise<WellhubGymRaw[]> {
  const local = bag?.gyms ?? new Map<string, WellhubGymRaw>();
  if (bag) bag.gyms = local;

  if (catalog?.bairros?.length) {
    return scrapeMunicipioExhaustive(page, context, mun, catalog, local, bag);
  }

  const first = await scrapeMunicipioWithRetry(page, mun);
  for (const g of first) local.set(g.id, g);
  if (first.length < GRID_THRESHOLD) return Array.from(local.values());

  const extracted = bairrosFromGyms(first, mun.nome);
  const seeds = seedBairrosFor(mun.nome);
  const bairroNames: string[] = [];
  const seenSlug = new Set<string>();
  for (const b of [...seeds, ...extracted]) {
    const slug = municipioSlug(b);
    if (!slug || seenSlug.has(slug)) continue;
    seenSlug.add(slug);
    bairroNames.push(b);
    if (bairroNames.length >= MAX_BAIRROS) break;
  }
  console.log(
    `  teto ${first.length} → ${bairroNames.length} bairros (seed=${seeds.length} extraidos=${extracted.length})`,
  );

  const entries: BairroCatalogEntry[] = bairroNames.map((bairro) => ({
    slug: municipioSlug(bairro),
    bairro,
  }));
  await scrapeBairroEntries(page, mun, entries, local, 'tiling heurístico', bag);

  if (local.size <= first.length + 20) {
    const geo = await geocodeMunicipio(mun);
    if (geo) {
      console.log(`  fallback geo grid @ ${geo.lat.toFixed(4)},${geo.lng.toFixed(4)}`);
      for (let i = -1; i <= 1; i++) {
        for (let j = -1; j <= 1; j++) {
          if (i === 0 && j === 0) continue;
          try {
            const extra = await scrapeGeoPoint(
              page,
              context,
              geo.lat + i * GRID_OFFSET_DEG,
              geo.lng + j * GRID_OFFSET_DEG,
            );
            for (const g of extra) local.set(g.id, g);
          } catch {
            // ignore
          }
          await sleep(GRID_DELAY_MS);
        }
      }
    }
  }

  return Array.from(local.values());
}

async function main(): Promise<void> {
  console.log('Scrape Wellhub Brasil (URL determinística + grid se teto)\n');
  console.log(
    `HEADLESS=${HEADLESS} DELAY_MS=${DELAY_MS} SETTLE_MS=${SETTLE_MS} GRID_THRESHOLD=${GRID_THRESHOLD}`,
  );

  let municipios: MunicipioBrasil[];
  try {
    const raw = await fs.readFile(MUNICIPIOS_PATH, 'utf-8');
    municipios = JSON.parse(raw) as MunicipioBrasil[];
  } catch {
    console.error(`Arquivo ausente: ${MUNICIPIOS_PATH}`);
    console.error('Rode antes: npm run fetch:municipios-br');
    process.exit(1);
  }

  if (!Array.isArray(municipios) || !municipios.length) {
    console.error('Lista de municípios inválida');
    process.exit(1);
  }

  municipios = [...municipios].sort(
    (a, b) => (b.populacao || 0) - (a.populacao || 0) || a.nome.localeCompare(b.nome),
  );

  if (LIMIT > 0) {
    municipios = municipios.slice(0, LIMIT);
    console.log(`LIMIT=${LIMIT} → ${municipios.length} municípios`);
  }

  const progress = await loadProgress();
  const completed = new Set(progress.completed);
  const gymMap =
    Object.keys(progress.gymById).length > 0
      ? new Map<string, WellhubGymRaw>(Object.entries(progress.gymById))
      : await loadGymMapFromOutput();

  console.log(
    `Checkpoint: completed=${completed.size} gyms=${gymMap.size} failed=${progress.failed.length}`,
  );

  const pending = municipios.filter((m) => !completed.has(municipioKey(m)));
  console.log(`Pendentes: ${pending.length}/${municipios.length}\n`);

  let browser: Browser | null = null;
  let context: BrowserContext | null = null;
  let page: Page | null = null;

  try {
    const launchOpts: Parameters<typeof chromium.launch>[0] = {
      headless: HEADLESS,
      args: ['--disable-blink-features=AutomationControlled'],
    };
    if (process.env.PW_CHANNEL) launchOpts.channel = process.env.PW_CHANNEL;
    browser = await chromium.launch(launchOpts);
    context = await browser.newContext({
      locale: 'pt-BR',
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      viewport: { width: 1400, height: 900 },
    });
    await context.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    });
    page = await context.newPage();

    let sinceCheckpoint = 0;
    let idx = 0;

    for (const mun of pending) {
      idx += 1;
      const key = municipioKey(mun);
      const url = buildSearchUrl(mun.uf, mun.nome);
      console.log(`[${idx}/${pending.length}] ${key}`);
      console.log(`  ${url}`);

      const catalog = await loadBairrosCatalog(mun.nome, mun.uf, BAIRROS_DIR);
      if (catalog) {
        console.log(`  📍 catálogo oficial: ${catalog.bairros.length} bairros (${catalogFileLabel(catalog)})`);
      }

      const tb = cityTimeoutBreakdown(catalog);
      console.log(`  timeout=${tb.timeout_ms}ms rule=${tb.rule}`);

      const bag = emptyScrapeBag();
      try {
        const gyms = await withTimeoutPartial(
          scrapeMunicipioWithGrid(page, context, mun, catalog, bag),
          tb.timeout_ms,
          key,
          () => (bag.gyms.size > 0 ? Array.from(bag.gyms.values()) : undefined),
          bag,
        );
        for (const g of gyms) mergeGym(gymMap, g, mun.uf, mun.nome);
        console.log(
          `  OK gyms=${gyms.length} únicas=${gymMap.size} outcome=${bag.outcome} bairros=${bag.bairros_done}/${bag.bairros_planned}`,
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.warn(`  ERRO: ${message} outcome=${bag.outcome} bairros=${bag.bairros_done}/${bag.bairros_planned}`);
        if (bag.gyms.size > 0) {
          for (const g of bag.gyms.values()) mergeGym(gymMap, g, mun.uf, mun.nome);
          console.warn(`  merge TIMEOUT_WITH_DATA: ${bag.gyms.size} gyms`);
        }
        progress.failed.push({ nome: mun.nome, key, error: message });
        // Após timeout, page zumbi — recria.
        if (/timeout/i.test(message)) {
          try {
            await page.close().catch(() => undefined);
            page = await context!.newPage();
            console.warn('  ↻ page recriada após timeout');
          } catch (recreateErr) {
            console.warn(
              `  falha ao recriar page: ${recreateErr instanceof Error ? recreateErr.message : recreateErr}`,
            );
          }
        }
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
    console.log(`Progress: ${PROGRESS_PATH}`);
  } finally {
    await page?.close().catch(() => undefined);
    await context?.close().catch(() => undefined);
    await browser?.close().catch(() => undefined);
  }
}

const invokedDirectly = process.argv[1]?.includes('scrape-wellhub-brasil');
if (invokedDirectly) {
  main().catch((err) => {
    console.error('Erro fatal:', err);
    process.exit(1);
  });
}
