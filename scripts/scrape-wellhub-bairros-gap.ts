/**
 * Scrape Wellhub — bairros gap (tag wh_bairro_busca + merge dump).
 *
 * Run:
 *   npx tsx scripts/scrape-wellhub-bairros-gap.ts --cidade "Rio de Janeiro" --uf RJ --slugs=argentino
 *   npx tsx scripts/scrape-wellhub-bairros-gap.ts --cidade "São Paulo" --uf SP --slugs=cachoeirinha,carrao
 */
import fs from 'fs/promises';
import path from 'path';
import { chromium } from 'playwright';
import {
  bairroSlug,
  loadBairrosCatalog,
  resolveSearchSlug,
} from './lib/wellhubBairrosCatalog.ts';
import {
  buildSearchUrl,
  mergeGym,
  scrapeSearchUrl,
  type WellhubGymRaw,
} from './scrape-wellhub-brasil.ts';

const ROOT = process.cwd();
const OUTPUT_PATH = path.join(ROOT, 'data/raw/wellhub-brasil-all.json');
const DELAY_MS = Number(process.env.DELAY_MS || 500);

function parseArgs(): { cidade: string; uf: string; slugs: string[] } {
  const cidade =
    process.argv.find((a) => a.startsWith('--cidade='))?.split('=').slice(1).join('=') ||
    process.argv[process.argv.indexOf('--cidade') + 1];
  const uf = (
    process.argv.find((a) => a.startsWith('--uf='))?.split('=')[1] ||
    process.argv[process.argv.indexOf('--uf') + 1] ||
    ''
  ).toUpperCase();
  const slugsRaw =
    process.argv.find((a) => a.startsWith('--slugs='))?.split('=')[1] ||
    process.argv[process.argv.indexOf('--slugs') + 1] ||
    '';
  const slugs = slugsRaw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  if (!cidade || !uf || !slugs.length) {
    console.error(
      'Uso: --cidade "Rio de Janeiro" --uf RJ --slugs=argentino[,outro-slug]',
    );
    process.exit(1);
  }
  return { cidade, uf, slugs };
}

async function loadGymMap(): Promise<Map<string, WellhubGymRaw>> {
  const raw = JSON.parse(await fs.readFile(OUTPUT_PATH, 'utf-8')) as
    | WellhubGymRaw[]
    | { data?: WellhubGymRaw[] };
  const rows = Array.isArray(raw) ? raw : (raw.data ?? []);
  return new Map(rows.map((g) => [g.id, g]));
}

async function saveGymMap(gymMap: Map<string, WellhubGymRaw>, note: string): Promise<void> {
  const data = Array.from(gymMap.values());
  const payload = {
    data,
    metadata: {
      totalGyms: data.length,
      timestamp: new Date().toISOString(),
      note,
    },
  };
  const tmp = `${OUTPUT_PATH}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(payload), 'utf-8');
  await fs.rename(tmp, OUTPUT_PATH);
}

async function main(): Promise<void> {
  const { cidade, uf, slugs } = parseArgs();
  const catalog = await loadBairrosCatalog(cidade, uf);
  if (!catalog) {
    console.error(`Catálogo ausente para ${cidade}-${uf}`);
    process.exit(1);
  }

  const slugSet = new Set(slugs);
  const entries = catalog.bairros.filter((b) => slugSet.has(resolveSearchSlug(b)));
  if (!entries.length) {
    console.error(`Nenhum bairro do catálogo bate slugs: ${slugs.join(', ')}`);
    process.exit(1);
  }

  const reportPath = path.join(
    ROOT,
    'data/processed',
    `wellhub-bairros-gap-${bairroSlug(cidade)}-${uf.toLowerCase()}.json`,
  );

  const gymMap = await loadGymMap();
  const before = gymMap.size;
  console.log(`Gap ${cidade}-${uf} · ${entries.length} bairro(s) · dump=${before} gyms\n`);

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
    const url = buildSearchUrl(uf, slug);
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
        mergeGym(gymMap, g, uf, cidade, slug);
        if (!existed) newGyms += 1;
        if (gymMap.get(g.id)?.wh_bairro_busca?.includes(slug)) tagged += 1;
      }
      console.log(`  OK scraped=${scraped} new=${newGyms} tagged=${tagged}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`  ERRO: ${msg}`);
    }

    report.push({ bairro: entry.bairro, slug, scraped, new_gyms: newGyms, tagged });
    await page.waitForTimeout(DELAY_MS);
  }

  await browser.close();
  await saveGymMap(gymMap, `scrape-wellhub-bairros-gap ${cidade}-${uf}`);
  await fs.mkdir(path.dirname(reportPath), { recursive: true });
  await fs.writeFile(
    reportPath,
    JSON.stringify(
      {
        ran_at: new Date().toISOString(),
        cidade,
        uf,
        slugs,
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
  console.log(`Report: ${reportPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
