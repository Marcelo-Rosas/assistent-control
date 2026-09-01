/**

 * Re-coleta cidades com timeout/perda e faz merge no dump Pass1.

 *

 * Run: npm run recover:wellhub-cities

 *

 * Env:

 *   FROM_AUDIT=LOSS_TIMEOUT,LOSS_EMPTY  — códigos audit (default)

 *   CITIES=Fortaleza-CE,...             — override lista (keys municipioKey)

 *   CITY_TIMEOUT_MS=0                   — 0 = só computeCityTimeout (sem cap extra)

 *   HEADLESS=true

 *   LIMIT=0

 */

import fs from 'fs/promises';

import path from 'path';

import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';

import { loadBairrosCatalog } from './lib/wellhubBairrosCatalog.ts';

import {

  computeCityTimeout,

  scrapeCompletionStatus,

  type AuditVerdictCode,

  type CityTimeoutBreakdown,

} from './lib/wellhubTimeout.ts';

import {

  buildSearchUrl,

  cityTimeoutBreakdown,

  emptyScrapeBag,

  mergeGym,

  municipioKey,

  scrapeMunicipioWithGrid,

  withTimeoutPartial,

  type MunicipioBrasil,

  type WellhubGymRaw,

} from './scrape-wellhub-brasil.ts';



const ROOT = process.cwd();

const OUTPUT_PATH = path.join(ROOT, 'data/raw/wellhub-brasil-all.json');

const AUDIT_PATH = path.join(ROOT, 'data/processed/wellhub-timeout-audit-all-progress.json');

const REPORT_PATH = path.join(ROOT, 'data/processed/wellhub-recover-report.json');

const BAIRROS_DIR = path.join(ROOT, 'data/geo/bairros');

const MUNICIPIOS_PATH = path.join(ROOT, 'data/municipios-brasil.json');



const FROM_AUDIT = (process.env.FROM_AUDIT || 'LOSS_TIMEOUT,LOSS_EMPTY')

  .split(',')

  .map((s) => s.trim()) as AuditVerdictCode[];

const CITIES = (process.env.CITIES || '')

  .split(',')

  .map((s) => s.trim())

  .filter(Boolean);

const EXTRA_TIMEOUT_MS = Number(process.env.CITY_TIMEOUT_MS || 0);

const LIMIT = Number(process.env.LIMIT || 0);

const HEADLESS = (process.env.HEADLESS ?? 'true').toLowerCase() !== 'false';



type CityRow = {

  key: string;

  verdict?: string;

  verdict_code?: AuditVerdictCode;

};



type RecoverRow = {

  key: string;

  before: number;

  scraped: number;

  after: number;

  new_gyms: number;

  timeout_ms: number;

  timeout_rule: string;

  timeout_breakdown: CityTimeoutBreakdown;

  elapsed_ms: number;

  outcome: string;

  bairros_planned: number;

  bairros_done: number;

  bairros_completion_pct: number;

  timed_out: boolean;

  error?: string;

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



function countCity(gymMap: Map<string, WellhubGymRaw>, nome: string): number {

  let n = 0;

  for (const g of gymMap.values()) {

    if (gymBelongsToCity(g, nome)) n += 1;

  }

  return n;

}



async function loadGymMap(): Promise<Map<string, WellhubGymRaw>> {

  const raw = JSON.parse(await fs.readFile(OUTPUT_PATH, 'utf-8')) as

    | WellhubGymRaw[]

    | { data?: WellhubGymRaw[] };

  const rows = Array.isArray(raw) ? raw : raw.data ?? [];

  const map = new Map<string, WellhubGymRaw>();

  for (const g of rows) {

    if (g?.id) map.set(g.id, g);

  }

  return map;

}



async function writeOutput(gymMap: Map<string, WellhubGymRaw>, totalMunicipios: number): Promise<void> {

  const data = Array.from(gymMap.values());

  const payload = {

    data,

    metadata: {

      totalGyms: data.length,

      totalMunicipios,

      timestamp: new Date().toISOString(),

      recoveredAt: new Date().toISOString(),

    },

  };

  await fs.mkdir(path.dirname(OUTPUT_PATH), { recursive: true });

  const tmp = `${OUTPUT_PATH}.tmp`;

  await fs.writeFile(tmp, JSON.stringify(payload), 'utf-8');

  await fs.rename(tmp, OUTPUT_PATH);

}



async function resolveCityKeys(municipios: MunicipioBrasil[]): Promise<string[]> {

  if (CITIES.length) return CITIES;



  const keys = new Set<string>();

  keys.add('Novo Santo Antônio-PI');



  try {

    const audit = JSON.parse(await fs.readFile(AUDIT_PATH, 'utf-8')) as {

      results?: CityRow[];

    };

    for (const r of audit.results || []) {

      if (r.verdict_code && FROM_AUDIT.includes(r.verdict_code)) {

        keys.add(r.key);

        continue;

      }

      if (r.verdict?.includes('LOSS') && FROM_AUDIT.some((c) => c.startsWith('LOSS_'))) {

        keys.add(r.key);

      }

    }

  } catch {

    console.warn('Audit progress ausente — Novo Santo Antônio-PI + CITIES env');

  }



  return Array.from(keys);

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



async function main(): Promise<void> {

  console.log('Recover Wellhub — cidades com timeout/perda\n');

  console.log(`FROM_AUDIT=${FROM_AUDIT.join(',')}\n`);



  const municipios = JSON.parse(await fs.readFile(MUNICIPIOS_PATH, 'utf-8')) as MunicipioBrasil[];

  const keys = await resolveCityKeys(municipios);

  let targets = municipios.filter((m) => keys.includes(municipioKey(m)));

  if (LIMIT > 0) targets = targets.slice(0, LIMIT);



  console.log(`Cidades: ${targets.map((m) => municipioKey(m)).join(', ')}\n`);



  const gymMap = await loadGymMap();

  const totalBefore = gymMap.size;

  const report: RecoverRow[] = [];



  let browser: Browser | null = null;

  let context: BrowserContext | null = null;

  let page: Page | null = null;



  try {

    for (let i = 0; i < targets.length; i++) {

      const mun = targets[i];

      const key = municipioKey(mun);

      const before = countCity(gymMap, mun.nome);

      const catalog = await loadBairrosCatalog(mun.nome, mun.uf, BAIRROS_DIR);

      const tb = cityTimeoutBreakdown(catalog);

      let timeoutMs = tb.timeout_ms;

      if (EXTRA_TIMEOUT_MS > 0) timeoutMs = Math.max(timeoutMs, EXTRA_TIMEOUT_MS);



      if (page) {

        await page.close().catch(() => undefined);

        await context?.close().catch(() => undefined);

        await browser?.close().catch(() => undefined);

      }

      ({ browser, context, page } = await createBrowserSession());



      console.log(`[${i + 1}/${targets.length}] ${key} before=${before} timeout=${timeoutMs}ms`);

      console.log(`  rule=${tb.rule}`);

      console.log(`  ${buildSearchUrl(mun.uf, mun.nome)}`);



      const bag = emptyScrapeBag();

      const t0 = Date.now();

      let scraped = 0;

      let error: string | undefined;



      try {

        const gyms = await withTimeoutPartial(

          scrapeMunicipioWithGrid(page!, context!, mun, catalog, bag),

          timeoutMs,

          key,

          () => (bag.gyms.size > 0 ? Array.from(bag.gyms.values()) : undefined),

          bag,

        );

        scraped = gyms.length;

        for (const g of gyms) mergeGym(gymMap, g, mun.uf, mun.nome);

      } catch (err) {

        error = err instanceof Error ? err.message : String(err);

        if (bag.gyms.size > 0) {

          const partialGyms = Array.from(bag.gyms.values());

          for (const g of partialGyms) mergeGym(gymMap, g, mun.uf, mun.nome);

          scraped = partialGyms.length;

          console.warn(`  merge TIMEOUT_WITH_DATA: ${scraped} gyms`);

        }

      }



      const elapsed_ms = Date.now() - t0;

      const completion = scrapeCompletionStatus({

        outcome: bag.outcome,

        bairros_planned: bag.bairros_planned,

        bairros_done: bag.bairros_done,

        gym_count: scraped,

        elapsed_ms,

        timeout_ms: timeoutMs,

      });



      const after = countCity(gymMap, mun.nome);

      const row: RecoverRow = {

        key,

        before,

        scraped,

        after,

        new_gyms: after - before,

        timeout_ms: timeoutMs,

        timeout_rule: tb.rule,

        timeout_breakdown: computeCityTimeout({

          catalog_bairros: catalog?.bairros?.length ?? null,

        }),

        elapsed_ms,

        outcome: bag.outcome,

        bairros_planned: bag.bairros_planned,

        bairros_done: bag.bairros_done,

        bairros_completion_pct: completion.bairros_completion_pct,

        timed_out: completion.timed_out,

        error,

      };

      report.push(row);

      console.log(

        `  → outcome=${bag.outcome} scraped=${scraped} after=${after} (+${row.new_gyms}) bairros=${bag.bairros_done}/${bag.bairros_planned} (${completion.bairros_completion_pct}%)${error ? ` err=${error.slice(0, 50)}` : ''}`,

      );



      await writeOutput(gymMap, municipios.length);

    }

  } finally {

    await page?.close().catch(() => undefined);

    await context?.close().catch(() => undefined);

    await browser?.close().catch(() => undefined);

  }



  const summary = {

    cities: report.length,

    total_gyms_before: totalBefore,

    total_gyms_after: gymMap.size,

    net_new: gymMap.size - totalBefore,

    formula: computeCityTimeout({ catalog_bairros: null }),

    rows: report,

    timestamp: new Date().toISOString(),

  };

  await fs.mkdir(path.dirname(REPORT_PATH), { recursive: true });

  await fs.writeFile(REPORT_PATH, JSON.stringify(summary, null, 2), 'utf-8');



  console.log('\n=== Recover done ===');

  console.log(`Gyms: ${totalBefore} → ${gymMap.size} (+${summary.net_new})`);

  console.log(`Report: ${REPORT_PATH}`);

}



main().catch((err) => {

  console.error(err);

  process.exit(1);

});


