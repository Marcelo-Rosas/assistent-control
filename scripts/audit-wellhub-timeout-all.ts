/**
 * Audit nacional: baseline Pass1 vs re-scrape short + normal (mesmo teste 3 cidades).
 * Resume via data/processed/wellhub-timeout-audit-all-progress.json
 *
 * Run: npx tsx scripts/audit-wellhub-timeout-all.ts
 * Env: SHORT_TIMEOUT_MS=10000 NORMAL_TIMEOUT_MS=0 (0=usa cityTimeoutMs Pass1)
 *      CHECKPOINT_EVERY=10 LIMIT=0 HEADLESS=true
 */
import fs from 'fs/promises';
import path from 'path';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { loadBairrosCatalog, type BairrosCatalog } from './lib/wellhubBairrosCatalog.ts';
import {
  buildSearchUrl,
  cityTimeoutBreakdown,
  emptyScrapeBag,
  municipioKey,
  scrapeMunicipioWithGrid,
  withTimeoutPartial,
  type MunicipioBrasil,
  type WellhubGymRaw,
} from './scrape-wellhub-brasil.ts';
import { auditVerdict, type AuditVerdictCode } from './lib/wellhubTimeout.ts';

const ROOT = process.cwd();
const OUTPUT_PATH = path.join(ROOT, 'data/raw/wellhub-brasil-all.json');
const PROGRESS_PATH = path.join(ROOT, 'data/processed/wellhub-timeout-audit-all-progress.json');
const REPORT_PATH = path.join(ROOT, 'data/processed/wellhub-timeout-audit-all-report.json');
const BAIRROS_DIR = path.join(ROOT, 'data/geo/bairros');

const SHORT_TIMEOUT_MS = Number(process.env.SHORT_TIMEOUT_MS || 10_000);
const NORMAL_TIMEOUT_MS = Number(process.env.NORMAL_TIMEOUT_MS || 0);
const CHECKPOINT_EVERY = Number(process.env.CHECKPOINT_EVERY || 10);
const LIMIT = Number(process.env.LIMIT || 0);
const HEADLESS = (process.env.HEADLESS ?? 'true').toLowerCase() !== 'false';
const MODES = (process.env.MODES || 'short,normal').split(',').map((m) => m.trim()) as Array<
  'short' | 'normal'
>;

type CityBaseline = { ids: Set<string>; count: number };

type RunRow = {
  mode: 'short' | 'normal';
  timeout_ms: number;
  ok: boolean;
  error?: string;
  count: number;
  missing_vs_baseline: number;
  pct_of_baseline: number;
  elapsed_ms: number;
};

type CityResult = {
  key: string;
  nome: string;
  uf: string;
  baseline_count: number;
  catalog_bairros: number | null;
  runs: RunRow[];
  verdict: string;
  verdict_code: AuditVerdictCode;
  missing_pct: number;
};

type AuditProgress = {
  completed: string[];
  results: CityResult[];
  lastUpdate: string;
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

function buildAllBaselines(
  rows: WellhubGymRaw[],
  municipios: MunicipioBrasil[],
): Map<string, CityBaseline> {
  const map = new Map<string, CityBaseline>();
  const byNormName = new Map<string, MunicipioBrasil[]>();
  for (const m of municipios) {
    map.set(municipioKey(m), { ids: new Set(), count: 0 });
    const n = norm(m.nome);
    if (!byNormName.has(n)) byNormName.set(n, []);
    byNormName.get(n)!.push(m);
  }

  for (const g of rows) {
    if (!g?.id) continue;
    const touched = new Set<string>();

    for (const mn of g.municipios_busca || []) {
      for (const m of byNormName.get(norm(mn)) || []) {
        touched.add(municipioKey(m));
      }
    }

    if (!touched.size) {
      const addr = norm(String(g.fullAddress || ''));
      for (const m of municipios) {
        const n = norm(m.nome);
        if (addr.includes(`, ${n} -`) || addr.includes(` ${n} -`)) {
          touched.add(municipioKey(m));
        }
      }
    }

    for (const key of touched) {
      const b = map.get(key)!;
      if (!b.ids.has(g.id)) {
        b.ids.add(g.id);
        b.count += 1;
      }
    }
  }
  return map;
}

function missingCount(baseline: Set<string>, got: Set<string>): number {
  let n = 0;
  for (const id of baseline) if (!got.has(id)) n += 1;
  return n;
}

function verdictRow(baseline: number, runs: RunRow[]): Pick<CityResult, 'verdict' | 'verdict_code' | 'missing_pct'> {
  const normal = runs.find((r) => r.mode === 'normal');
  if (!normal) {
    return { verdict: 'INCOMPLETE', verdict_code: 'INCOMPLETE', missing_pct: 0 };
  }
  const v = auditVerdict({
    baseline_count: baseline,
    normal_count: normal.count,
    normal_missing: normal.missing_vs_baseline,
    normal_error: normal.error,
    normal_ok: normal.ok,
  });
  return { verdict: v.label, verdict_code: v.code, missing_pct: v.missing_pct };
}

async function loadProgress(): Promise<AuditProgress> {
  try {
    const raw = JSON.parse(await fs.readFile(PROGRESS_PATH, 'utf-8')) as AuditProgress;
    return {
      completed: Array.isArray(raw.completed) ? raw.completed : [],
      results: Array.isArray(raw.results) ? raw.results : [],
      lastUpdate: raw.lastUpdate || new Date().toISOString(),
    };
  } catch {
    return { completed: [], results: [], lastUpdate: new Date().toISOString() };
  }
}

async function saveProgress(state: AuditProgress): Promise<void> {
  state.lastUpdate = new Date().toISOString();
  await fs.mkdir(path.dirname(PROGRESS_PATH), { recursive: true });
  const tmp = `${PROGRESS_PATH}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(state), 'utf-8');
  await fs.rename(tmp, PROGRESS_PATH);
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
  catalog: BairrosCatalog | null,
  timeoutMs: number,
): Promise<{ gyms: WellhubGymRaw[]; error?: string }> {
  const key = municipioKey(mun);
  const scrapeProgress = emptyScrapeBag();
  try {
    const gyms = await withTimeoutPartial(
      scrapeMunicipioWithGrid(page, context, mun, catalog, scrapeProgress),
      timeoutMs,
      key,
      () => (scrapeProgress.gyms.size > 0 ? Array.from(scrapeProgress.gyms.values()) : undefined),
      scrapeProgress,
    );
    return { gyms };
  } catch (err) {
    if (scrapeProgress.gyms.size > 0) {
      return { gyms: Array.from(scrapeProgress.gyms.values()) };
    }
    return { gyms: [], error: err instanceof Error ? err.message : String(err) };
  }
}

function summarize(results: CityResult[]) {
  const byVerdict: Record<string, number> = {};
  let lossNormalTimeout = 0;
  let warnMissing = 0;
  for (const r of results) {
    byVerdict[r.verdict_code] = (byVerdict[r.verdict_code] || 0) + 1;
    if (r.verdict_code === 'LOSS_TIMEOUT' || r.verdict_code === 'LOSS_EMPTY') lossNormalTimeout += 1;
    if (r.verdict_code === 'WARN_MISSING_6_TO_10PCT' || r.verdict_code === 'WARN_DIVERGE') warnMissing += 1;
  }
  return { byVerdict, lossNormalTimeout, warnMissing, total: results.length };
}

async function main(): Promise<void> {
  console.log('Audit Wellhub timeout — TODAS as cidades\n');
  console.log(
    `MODES=${MODES.join(',')} SHORT=${SHORT_TIMEOUT_MS} NORMAL=${NORMAL_TIMEOUT_MS || 'cityTimeoutMs'}`,
  );

  const municipios = JSON.parse(
    await fs.readFile(path.join(ROOT, 'data/municipios-brasil.json'), 'utf-8'),
  ) as MunicipioBrasil[];

  const dump = JSON.parse(await fs.readFile(OUTPUT_PATH, 'utf-8')) as
    | WellhubGymRaw[]
    | { data?: WellhubGymRaw[] };
  const rows = Array.isArray(dump) ? dump : dump.data ?? [];
  console.log(`Baseline dump: ${rows.length} gyms`);

  const baselines = buildAllBaselines(rows, municipios);
  const progress = await loadProgress();
  const done = new Set(progress.completed);

  let list = [...municipios].sort(
    (a, b) => (b.populacao || 0) - (a.populacao || 0) || a.nome.localeCompare(b.nome),
  );
  if (LIMIT > 0) list = list.slice(0, LIMIT);
  const pending = list.filter((m) => !done.has(municipioKey(m)));
  console.log(`Pendentes: ${pending.length}/${list.length} (já auditadas: ${done.size})\n`);

  let session: { browser: Browser; context: BrowserContext; page: Page } | null = null;
  let sinceCheckpoint = 0;

  try {
    for (let i = 0; i < pending.length; i++) {
      const mun = pending[i];
      const key = municipioKey(mun);
      const baseline = baselines.get(key) ?? { ids: new Set(), count: 0 };
      const catalog = await loadBairrosCatalog(mun.nome, mun.uf, BAIRROS_DIR);
      const tb = cityTimeoutBreakdown(catalog);
      const normalMs =
        NORMAL_TIMEOUT_MS > 0 ? NORMAL_TIMEOUT_MS : tb.timeout_ms;

      console.log(
        `[${i + 1}/${pending.length}] ${key} baseline=${baseline.count} cat=${catalog?.bairros.length ?? 0} timeout=${normalMs}ms`,
      );

      const runs: RunRow[] = [];

      for (const mode of MODES) {
        const timeoutMs = mode === 'short' ? SHORT_TIMEOUT_MS : normalMs;
        await closeBrowserSession(session);
        session = await createBrowserSession();

        const t0 = Date.now();
        const { gyms, error } = await scrapeOnce(session.page, session.context, mun, catalog, timeoutMs);
        const elapsed = Date.now() - t0;
        const got = new Set(gyms.map((g) => g.id));
        const miss = missingCount(baseline.ids, got);

        runs.push({
          mode,
          timeout_ms: timeoutMs,
          ok: !error,
          error,
          count: gyms.length,
          missing_vs_baseline: miss,
          pct_of_baseline: baseline.count
            ? Math.round((gyms.length / baseline.count) * 1000) / 10
            : 0,
          elapsed_ms: elapsed,
        });

        console.log(
          `  [${mode}] ${elapsed}ms n=${gyms.length} miss=${miss}${error ? ` err=${error.slice(0, 60)}` : ''}`,
        );
      }

      const v = verdictRow(baseline.count, runs);
      const result: CityResult = {
        key,
        nome: mun.nome,
        uf: mun.uf,
        baseline_count: baseline.count,
        catalog_bairros: catalog?.bairros.length ?? null,
        runs,
        verdict: v.verdict,
        verdict_code: v.verdict_code,
        missing_pct: v.missing_pct,
      };
      progress.results.push(result);
      done.add(key);
      progress.completed = Array.from(done);
      sinceCheckpoint += 1;

      if (sinceCheckpoint >= CHECKPOINT_EVERY) {
        await saveProgress(progress);
        sinceCheckpoint = 0;
        const s = summarize(progress.results);
        console.log(`  💾 checkpoint ${progress.completed.length} loss_timeout=${s.lossNormalTimeout}`);
      }
    }
  } finally {
    await closeBrowserSession(session);
  }

  await saveProgress(progress);
  const summary = summarize(progress.results);
  const report = {
    generated_at: new Date().toISOString(),
    config: {
      modes: MODES,
      short_ms: SHORT_TIMEOUT_MS,
      normal_ms: NORMAL_TIMEOUT_MS || 'cityTimeoutMs',
    },
    summary,
    cities: progress.results,
  };
  await fs.writeFile(REPORT_PATH, JSON.stringify(report, null, 2), 'utf-8');
  console.log('\n=== Resumo ===');
  console.log(JSON.stringify(summary, null, 2));
  console.log(`Report: ${REPORT_PATH}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
