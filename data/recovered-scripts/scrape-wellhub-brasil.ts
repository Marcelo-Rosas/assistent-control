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
 *   MUNICIPIOS_PATH | OUTPUT_PATH | PROGRESS_PATH
 */
import fs from 'fs/promises';
import path from 'path';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';

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
const MAX_RETRIES = 3;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
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

function municipioKey(m: MunicipioBrasil): string {
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

  // Escaped (dentro de string JS do flight payload)
  const escaped = html.match(
    /\[\{\\"id\\":\\"[^"\\]+\\",\\"imageUrl\\":[\s\S]*?\\?"fullAddress\\?"[\s\S]*?\}\]//,
  );
  if (escaped?.[0]) candidates.push(escaped[0]);

  // Unescaped (raro, mas possível após hydrate)
  const plain = html.match(
    /\[\{"id":"[^"]+","imageUrl":[\s\S]*?"fullAddress"[\s\S]*?\}\]//,
  );
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

function mergeGym(
  map: Map<string, WellhubGymRaw>,
  gym: WellhubGymRaw,
  uf: string,
  municipioNome: string,
): void {
  const existing = map.get(gym.id);
  if (!existing) {
    map.set(gym.id, {
      ...gym,
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
  await fs.writeFile(OUTPUT_PATH, JSON.stringify(payload, null, 2), 'utf-8');
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

async function scrapeMunicipioOnce(
  page: Page,
  mun: MunicipioBrasil,
): Promise<WellhubGymRaw[]> {
  const url = buildSearchUrl(mun.uf, mun.nome);
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

async function main(): Promise<void> {
  console.log('Scrape Wellhub Brasil (URL determinística + HTML payload)\n');
  console.log(`HEADLESS=${HEADLESS} DELAY_MS=${DELAY_MS} SETTLE_MS=${SETTLE_MS}`);

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
  const gymMap = new Map<string, WellhubGymRaw>(Object.entries(progress.gymById));

  console.log(
    `Checkpoint: completed=${completed.size} gyms=${gymMap.size} failed=${progress.failed.length}`,
  );

  const pending = municipios.filter((m) => !completed.has(municipioKey(m)));
  console.log(`Pendentes: ${pending.length}/${municipios.length}\n`);

  let browser: Browser | null = null;
  let context: BrowserContext | null = null;
  let page: Page | null = null;

  try {
    browser = await chromium.launch({
      headless: HEADLESS,
      args: ['--disable-blink-features=AutomationControlled'],
    });
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

      try {
        const gyms = await scrapeMunicipioWithRetry(page, mun);
        for (const g of gyms) mergeGym(gymMap, g, mun.uf, mun.nome);
        console.log(`  OK ${gyms.length} gyms (únicas=${gymMap.size})`);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.warn(`  ERRO: ${message}`);
        progress.failed.push({ nome: mun.nome, key, error: message });
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

main().catch((err) => {
  console.error('Erro fatal:', err);
  process.exit(1);
});
