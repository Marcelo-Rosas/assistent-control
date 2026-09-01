/**
 * Smoke: 3 cidades — baseline vs timeout curto vs timeout normal.
 * Detecta perda de gyms quando CITY_TIMEOUT dispara antes do tiling acabar.
 *
 * Run: npx tsx scripts/smoke-wellhub-timeout-3cities.ts
 * Env: SHORT_TIMEOUT_MS=10000 NORMAL_TIMEOUT_MS=600000 HEADLESS=true
 */
import fs from 'fs/promises';
import path from 'path';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { loadBairrosCatalog } from './lib/wellhubBairrosCatalog.ts';
import {
  buildSearchUrl,
  municipioKey,
  scrapeMunicipioWithGrid,
  withTimeout,
  type MunicipioBrasil,
  type WellhubGymRaw,
} from './scrape-wellhub-brasil.ts';

const ROOT = process.cwd();
const OUTPUT_PATH = path.join(ROOT, 'data/raw/wellhub-brasil-all.json');
const REPORT_PATH = path.join(ROOT, 'data/processed/wellhub-timeout-smoke-3cities.json');
const BAIRROS_DIR = path.join(ROOT, 'data/geo/bairros');

const TEST_CITIES: Array<{ nome: string; uf: string }> = [
  { nome: 'São Paulo', uf: 'SP' },
  { nome: 'Porto Alegre', uf: 'RS' },
  { nome: 'Rio de Janeiro', uf: 'RJ' },
];

const SHORT_TIMEOUT_MS = Number(process.env.SHORT_TIMEOUT_MS || 10_000);
const NORMAL_TIMEOUT_MS = Number(process.env.NORMAL_TIMEOUT_MS || 600_000);
const HEADLESS = (process.env.HEADLESS ?? 'true').toLowerCase() !== 'false';

type CityBaseline = {
  ids: Set<string>;
  count: number;
};

type ScrapeRun = {
  mode: 'short' | 'normal';
  timeout_ms: number;
  ok: boolean;
  error?: string;
  count: number;
  ids: string[];
  missing_vs_baseline: string[];
  pct_of_baseline: number;
};

type CityReport = {
  key: string;
  nome: string;
  uf: string;
  url: string;
  catalog_bairros: number | null;
  baseline_count: number;
  runs: ScrapeRun[];
  verdict: string;
};

function norm(s: string): string {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function gymBelongsToCity(g: WellhubGymRaw, nome: string): boolean {
  const n = norm(nome);
  if ((g.municipios_busca || []).some((m) => norm(m) === n)) return true;
  const addr = norm(String(g.fullAddress || ''));
  return addr.includes(`, ${n} -`) || addr.includes(` ${n} -`);
}

async function loadBaselines(): Promise<Map<string, CityBaseline>> {
  const raw = JSON.parse(await fs.readFile(OUTPUT_PATH, 'utf-8')) as
    | WellhubGymRaw[]
    | { data?: WellhubGymRaw[] };
  const rows = Array.isArray(raw) ? raw : raw.data ?? [];
  const map = new Map<string, CityBaseline>();

  for (const { nome, uf } of TEST_CITIES) {
    const key = `${nome}-${uf}`;
    const ids = new Set<string>();
    for (const g of rows) {
      if (g?.id && gymBelongsToCity(g, nome)) ids.add(g.id);
    }
    map.set(key, { ids, count: ids.size });
  }
  return map;
}

function missingIds(baseline: Set<string>, got: Set<string>): string[] {
  const out: string[] = [];
  for (const id of baseline) {
    if (!got.has(id)) out.push(id);
  }
  return out;
}

async function createBrowserSession(): Promise<{
  browser: Browser;
  context: BrowserContext;
  page: Page;
}> {
  const browser = await chromium.launch({
    headless: HEADLESS,
    args: ['--disable-blink-features=AutomationControlled'],
  });
  const context = await browser.newContext({
    locale: 'pt-BR',
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    viewport: { width: 1400, height: 900 },
  });
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  });
  const page = await context.newPage();
  return { browser, context, page };
}

async function closeBrowserSession(session: {
  browser: Browser;
  context: BrowserContext;
  page: Page;
} | null): Promise<void> {
  if (!session) return;
  await session.page.close().catch(() => undefined);
  await session.context.close().catch(() => undefined);
  await session.browser.close().catch(() => undefined);
}
async function scrapeOnce(
  page: Page,
  context: BrowserContext,
  mun: MunicipioBrasil,
  timeoutMs: number,
): Promise<{ gyms: WellhubGymRaw[]; error?: string }> {
  const catalog = await loadBairrosCatalog(mun.nome, mun.uf, BAIRROS_DIR);
  const key = municipioKey(mun);
  try {
    const gyms = await withTimeout(
      scrapeMunicipioWithGrid(page, context, mun, catalog),
      timeoutMs,
      key,
    );
    return { gyms };
  } catch (err) {
    return {
      gyms: [],
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

function verdictFor(runs: ScrapeRun[], baseline: number): string {
  const normal = runs.find((r) => r.mode === 'normal');
  const short = runs.find((r) => r.mode === 'short');
  if (!normal || !short) return 'incomplete';

  if (normal.missing_vs_baseline.length === 0 && normal.ok) {
    if (short.count < normal.count * 0.9) {
      return 'TIMEOUT_LOSS: curto perde vs normal; Pass1 OK se normal=baseline';
    }
    return 'OK: timeout curto não perdeu vs normal';
  }

  if (normal.count >= baseline * 0.95) {
    if (short.count < baseline * 0.5) {
      return 'TIMEOUT_LOSS: curto << baseline; normal ~baseline';
    }
    return 'WARN: normal diverge leve do baseline (site drift?)';
  }

  return 'WARN: normal também abaixo baseline — revisar matcher ou drift';
}

async function main(): Promise<void> {
  console.log('Smoke Wellhub timeout — 3 cidades\n');
  console.log(`SHORT_TIMEOUT_MS=${SHORT_TIMEOUT_MS} NORMAL_TIMEOUT_MS=${NORMAL_TIMEOUT_MS}`);

  const baselines = await loadBaselines();
  const municipios = JSON.parse(
    await fs.readFile(path.join(ROOT, 'data/municipios-brasil.json'), 'utf-8'),
  ) as MunicipioBrasil[];

  const report: {
    generated_at: string;
    config: { short_ms: number; normal_ms: number };
    cities: CityReport[];
  } = {
    generated_at: new Date().toISOString(),
    config: { short_ms: SHORT_TIMEOUT_MS, normal_ms: NORMAL_TIMEOUT_MS },
    cities: [],
  };

  let browser: Browser | null = null;
  let context: BrowserContext | null = null;
  let page: Page | null = null;

  try {
    for (const { nome, uf } of TEST_CITIES) {
      const key = `${nome}-${uf}`;
      const mun = municipios.find((m) => m.nome === nome && m.uf === uf);
      if (!mun) {
        console.warn(`Município não encontrado: ${key}`);
        continue;
      }

      const baseline = baselines.get(key)!;
      const catalog = await loadBairrosCatalog(nome, uf, BAIRROS_DIR);
      console.log(`\n=== ${key} baseline=${baseline.count} catalog=${catalog?.bairros.length ?? 0} ===`);

      const runs: ScrapeRun[] = [];

      for (const mode of ['short', 'normal'] as const) {
        const timeoutMs = mode === 'short' ? SHORT_TIMEOUT_MS : NORMAL_TIMEOUT_MS;
        console.log(`  [${mode}] timeout=${timeoutMs}ms ...`);

        await closeBrowserSession(
          browser && context && page ? { browser, context, page } : null,
        );
        browser = null;
        context = null;
        page = null;

        const session = await createBrowserSession();
        browser = session.browser;
        context = session.context;
        page = session.page;

        const t0 = Date.now();
        const { gyms, error } = await scrapeOnce(page, context, mun, timeoutMs);
        const elapsed = Date.now() - t0;
        const got = new Set(gyms.map((g) => g.id));
        const miss = missingIds(baseline.ids, got);

        runs.push({
          mode,
          timeout_ms: timeoutMs,
          ok: !error,
          error,
          count: gyms.length,
          ids: Array.from(got),
          missing_vs_baseline: miss,
          pct_of_baseline: baseline.count ? Math.round((gyms.length / baseline.count) * 1000) / 10 : 0,
        });

        console.log(
          `  [${mode}] ${elapsed}ms count=${gyms.length} pct=${runs.at(-1)!.pct_of_baseline}% miss=${miss.length}${error ? ` err=${error}` : ''}`,
        );
      }

      const cityReport: CityReport = {
        key,
        nome,
        uf,
        url: buildSearchUrl(uf, nome),
        catalog_bairros: catalog?.bairros.length ?? null,
        baseline_count: baseline.count,
        runs,
        verdict: verdictFor(runs, baseline.count),
      };
      report.cities.push(cityReport);
      console.log(`  → ${cityReport.verdict}`);
    }
  } finally {
    await closeBrowserSession(
      browser && context && page ? { browser, context, page } : null,
    );
  }

  await fs.mkdir(path.dirname(REPORT_PATH), { recursive: true });
  // slim report — não gravar todos ids no JSON final
  const slim = {
    ...report,
    cities: report.cities.map((c) => ({
      ...c,
      runs: c.runs.map((r) => ({
        ...r,
        ids: undefined,
        missing_vs_baseline_sample: r.missing_vs_baseline.slice(0, 15),
        missing_vs_baseline: r.missing_vs_baseline.length,
      })),
    })),
  };
  await fs.writeFile(REPORT_PATH, JSON.stringify(slim, null, 2), 'utf-8');
  console.log(`\nReport: ${REPORT_PATH}`);
  console.log(JSON.stringify(slim, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
