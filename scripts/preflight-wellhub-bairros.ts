/**
 * Preflight: valida slugs de bairros contra Wellhub (contagem + teto 100).
 *
 * Run:
 *   npx tsx scripts/preflight-wellhub-bairros.ts --cidade "Porto Alegre" --uf RS
 *   npx tsx scripts/preflight-wellhub-bairros.ts --catalog data/geo/bairros/porto-alegre-rs.json
 *
 * Output: data/processed/wellhub-preflight-{slug}-{uf}.json
 */
import fs from 'fs/promises';
import path from 'path';
import {
  buildSearchUrlForSlug,
  loadBairrosCatalog,
  resolveSearchSlug,
  type BairroCatalogEntry,
  type BairrosCatalog,
} from './lib/wellhubBairrosCatalog.ts';
import { extractGymsFromHtml, municipioSlug } from './scrape-wellhub-brasil.ts';

const ROOT = process.cwd();
const BAIRROS_DIR =
  process.env.BAIRROS_DIR || path.join(ROOT, 'data/geo/bairros');
const RESULT_CAP = 100;
const DELAY_MS = Number(process.env.DELAY_MS || 300);
const FETCH_TIMEOUT_MS = Number(process.env.FETCH_TIMEOUT_MS || 20_000);

type PreflightRow = {
  bairro: string;
  slug: string;
  url: string;
  http_status: number;
  count: number;
  hit_cap: boolean;
  error?: string;
};

type PreflightReport = {
  cidade: string;
  uf: string;
  catalog_file?: string;
  tested_at: string;
  city_pass?: PreflightRow;
  bairros: PreflightRow[];
  summary: {
    total_bairros: number;
    ok: number;
    empty: number;
    errors: number;
    hit_cap: number;
  };
};

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function parseArgs(): { catalogPath?: string; cidade?: string; uf?: string } {
  const args = process.argv.slice(2);
  let catalogPath: string | undefined;
  let cidade: string | undefined;
  let uf: string | undefined;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--catalog' && args[i + 1]) {
      catalogPath = args[++i];
    } else if (args[i] === '--cidade' && args[i + 1]) {
      cidade = args[++i];
    } else if (args[i] === '--uf' && args[i + 1]) {
      uf = args[++i];
    }
  }
  return { catalogPath, cidade, uf };
}

async function fetchGymCount(url: string): Promise<{ status: number; count: number; error?: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'GymSitePipeline/1.0 (preflight)',
        'Accept-Language': 'pt-BR,pt;q=0.9',
      },
    });
    const html = await res.text();
    const gyms = extractGymsFromHtml(html);
    return { status: res.status, count: gyms.length };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { status: 0, count: 0, error: msg };
  } finally {
    clearTimeout(timer);
  }
}

async function probeSlug(
  uf: string,
  entry: BairroCatalogEntry,
): Promise<PreflightRow> {
  const slug = resolveSearchSlug(entry);
  const url = buildSearchUrlForSlug(uf, slug);
  const { status, count, error } = await fetchGymCount(url);
  return {
    bairro: entry.bairro,
    slug,
    url,
    http_status: status,
    count,
    hit_cap: count >= RESULT_CAP,
    error,
  };
}

async function main(): Promise<void> {
  const { catalogPath, cidade, uf } = parseArgs();

  let catalog: BairrosCatalog | null = null;
  if (catalogPath) {
    const raw = await fs.readFile(path.resolve(catalogPath), 'utf-8');
    catalog = JSON.parse(raw) as BairrosCatalog;
  } else if (cidade && uf) {
    catalog = await loadBairrosCatalog(cidade, uf, BAIRROS_DIR);
  }

  if (!catalog) {
    console.error('Uso: --catalog <path> OU --cidade "Porto Alegre" --uf RS');
    process.exit(1);
  }

  console.log(`Preflight Wellhub: ${catalog.cidade}, ${catalog.uf} (${catalog.bairros.length} bairros)\n`);

  const citySlug = municipioSlug(catalog.cidade);
  const cityUrl = buildSearchUrlForSlug(catalog.uf, citySlug);
  const cityFetch = await fetchGymCount(cityUrl);
  const cityPass: PreflightRow = {
    bairro: catalog.cidade,
    slug: citySlug,
    url: cityUrl,
    http_status: cityFetch.status,
    count: cityFetch.count,
    hit_cap: cityFetch.count >= RESULT_CAP,
    error: cityFetch.error,
  };
  console.log(
    `cidade ${citySlug}: status=${cityPass.http_status} count=${cityPass.count}${cityPass.hit_cap ? ' [teto]' : ''}`,
  );

  const bairros: PreflightRow[] = [];

  for (const entry of catalog.bairros) {
    if (resolveSearchSlug(entry) === citySlug) continue;
    const row = await probeSlug(catalog.uf, entry);
    bairros.push(row);
    const mark = row.error ? ' ERR' : row.count === 0 ? ' vazio' : row.hit_cap ? ' [teto]' : '';
    console.log(`  ${row.slug}: ${row.count}${mark}`);
    await sleep(DELAY_MS);
  }

  let ok = 0;
  let empty = 0;
  let errors = 0;
  let hitCap = 0;
  if (cityPass.count > 0 && !cityPass.error) ok += 1;
  if (cityPass.count === 0 && !cityPass.error) empty += 1;
  if (cityPass.error) errors += 1;
  if (cityPass.hit_cap) hitCap += 1;

  for (const row of bairros) {
    if (row.error) errors += 1;
    else if (row.count === 0) empty += 1;
    else ok += 1;
    if (row.hit_cap) hitCap += 1;
  }

  const report: PreflightReport = {
    cidade: catalog.cidade,
    uf: catalog.uf,
    catalog_file: catalogPath || `${municipioSlug(catalog.cidade)}-${catalog.uf.toLowerCase()}.json`,
    tested_at: new Date().toISOString(),
    city_pass: cityPass,
    bairros,
    summary: {
      total_bairros: catalog.bairros.length,
      ok,
      empty,
      errors,
      hit_cap: hitCap,
    },
  };

  const outPath = path.join(
    ROOT,
    'data/processed',
    `wellhub-preflight-${municipioSlug(catalog.cidade)}-${catalog.uf.toLowerCase()}.json`,
  );
  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, JSON.stringify(report, null, 2), 'utf-8');

  console.log('\n=== Resumo ===');
  console.log(`Bairros testados: ${bairros.length}`);
  console.log(`OK (>0): ${ok} · vazios: ${empty} · erros: ${errors} · no teto: ${hitCap}`);
  console.log(`Relatório: ${outPath}`);
}

main().catch((err) => {
  console.error('Erro fatal:', err);
  process.exit(1);
});
