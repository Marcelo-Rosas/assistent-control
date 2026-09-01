/**
 * Scrape Wellhub SP — 7 distritos faltantes no audit (gap closure).
 *
 * Run: npx tsx scripts/scrape-wellhub-sp-bairros-gap.ts
 */
import fs from 'fs/promises';
import path from 'path';
import { chromium } from 'playwright';
import { loadBairrosCatalog, resolveSearchSlug } from './lib/wellhubBairrosCatalog.ts';
import {
  buildSearchUrl,
  mergeGym,
  scrapeSearchUrl,
  type WellhubGymRaw,
} from './scrape-wellhub-brasil.ts';

const ROOT = process.cwd();
const OUTPUT_PATH = path.join(ROOT, 'data/raw/wellhub-brasil-all.json');
const REPORT_PATH = path.join(ROOT, 'data/processed/wellhub-sp-bairros-gap-report.json');
const DELAY_MS = Number(process.env.DELAY_MS || 500);

const GAP_SLUGS = [
  'cachoeirinha',
  'carrao',
  'jose-bonifacio',
  'lajeado',
  'marsilac',
  'ponte-rasa',
  'sao-rafael',
];

async function loadGymMap(): Promise<Map<string, WellhubGymRaw>> {
  const raw = JSON.parse(await fs.readFile(OUTPUT_PATH, 'utf-8')) as
    | WellhubGymRaw[]
    | { data?: WellhubGymRaw[] };
  const rows = Array.isArray(raw) ? raw : (raw.data ?? []);
  return new Map(rows.map((g) => [g.id, g]));
}

async function saveGymMap(gymMap: Map<string, WellhubGymRaw>): Promise<void> {
  const data = Array.from(gymMap.values());
  const payload = {
    data,
    metadata: {
      totalGyms: data.length,
      timestamp: new Date().toISOString(),
      note: 'merged scrape-wellhub-sp-bairros-gap',
    },
  };
  const tmp = `${OUTPUT_PATH}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(payload), 'utf-8');
  await fs.rename(tmp, OUTPUT_PATH);
}

async function main(): Promise<void> {
  const catalog = await loadBairrosCatalog('São Paulo', 'SP');
  if (!catalog) {
    console.error('Catálogo sao-paulo-sp.json ausente');
    process.exit(1);
  }

  const entries = catalog.bairros.filter((b) => GAP_SLUGS.includes(resolveSearchSlug(b)));
  if (entries.length !== GAP_SLUGS.length) {
    console.warn(`Esperado ${GAP_SLUGS.length} bairros, encontrado ${entries.length}`);
  }

  const gymMap = await loadGymMap();
  const before = gymMap.size;
  console.log(`Dump Pass1: ${before} gyms\n`);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    locale: 'pt-BR',
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    viewport: { width: 1400, height: 900 },
  });
  const page = await context.newPage();

  const report: Array<{
    bairro: string;
    slug: string;
    scraped: number;
    new_gyms: number;
    tagged: number;
  }> = [];

  for (const entry of entries) {
    const slug = resolveSearchSlug(entry);
    const url = buildSearchUrl('SP', slug);
    console.log(`${entry.bairro} (${slug})`);
    console.log(`  ${url}`);

    let scraped = 0;
    let newGyms = 0;
    let tagged = 0;

    try {
      const gyms = await scrapeSearchUrl(page, url);
      scraped = gyms.length;
      for (const g of gyms) {
        const existed = gymMap.has(g.id);
        mergeGym(gymMap, g, 'SP', 'São Paulo', slug);
        if (!existed) newGyms += 1;
        if (gymMap.get(g.id)?.wh_bairro_busca?.includes(slug)) tagged += 1;
      }
      console.log(`  OK scraped=${scraped} new=${newGyms} tagged=${tagged}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`  ERRO: ${msg}`);
    }

    report.push({
      bairro: entry.bairro,
      slug,
      scraped,
      new_gyms: newGyms,
      tagged,
    });

    await page.waitForTimeout(DELAY_MS);
  }

  await browser.close();

  await saveGymMap(gymMap);
  await fs.mkdir(path.dirname(REPORT_PATH), { recursive: true });
  await fs.writeFile(
    REPORT_PATH,
    JSON.stringify(
      {
        ran_at: new Date().toISOString(),
        slugs: GAP_SLUGS,
        before_gyms: before,
        after_gyms: gymMap.size,
        delta: gymMap.size - before,
        rows: report,
      },
      null,
      2,
    ),
    'utf-8',
  );

  console.log(`\nMerge OK: ${before} → ${gymMap.size} (+${gymMap.size - before})`);
  console.log(`Report: ${REPORT_PATH}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
