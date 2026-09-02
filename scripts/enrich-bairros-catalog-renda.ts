/**
 * Enriquece catálogos com renda por bairro/distrito (renda_pc, renda_media).
 *
 * Fontes (ordem):
 *   1. data/processed/renda-bairro-by-ibge.json — snapshot local IBGE
 *   2. Supabase GymSite.renda_bairro (quando tabela existir)
 *
 * Não sobrescreve renda_media_sm / renda_pc já preenchidos (ex.: POA), salvo --overwrite.
 *
 * Run:
 *   npx tsx scripts/enrich-bairros-catalog-renda.ts --cidade "São Paulo" --uf SP
 *   npx tsx scripts/enrich-bairros-catalog-renda.ts --all
 */
import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import {
  catalogFileName,
  loadBairrosCatalog,
  type BairrosCatalog,
} from './lib/wellhubBairrosCatalog.ts';
import {
  enrichCatalogWithRenda,
  loadRendaRowsForIbge,
  type RendaByIbgeFile,
} from './lib/enrichBairrosCatalogRenda.ts';

const ROOT = process.cwd();
const BAIRROS_DIR = path.join(ROOT, 'data/geo/bairros');
const RENDA_PATH = path.join(ROOT, 'data/processed/renda-bairro-by-ibge.json');

function loadDotEnv(filePath: string): void {
  try {
    const raw = fsSync.readFileSync(filePath, 'utf8') as string;
    for (const line of raw.split(/\r?\n/)) {
      const t = line.trim();
      if (!t || t.startsWith('#')) continue;
      const i = t.indexOf('=');
      if (i < 1) continue;
      const key = t.slice(0, i).trim();
      const val = t.slice(i + 1).trim();
      if (!process.env[key]) process.env[key] = val;
    }
  } catch {
    /* optional */
  }
}

function parseArgs(): { cidade?: string; uf?: string; all: boolean; overwrite: boolean } {
  const all = process.argv.includes('--all');
  const overwrite = process.argv.includes('--overwrite');
  const cidade =
    process.argv.find((a) => a.startsWith('--cidade='))?.split('=').slice(1).join('=') ||
    process.argv[process.argv.indexOf('--cidade') + 1];
  const uf = (
    process.argv.find((a) => a.startsWith('--uf='))?.split('=')[1] ||
    process.argv[process.argv.indexOf('--uf') + 1] ||
    ''
  ).toUpperCase();
  if (!all && (!cidade || !uf)) {
    console.error('Uso: --cidade "São Paulo" --uf SP | --all [--overwrite]');
    process.exit(1);
  }
  return { cidade, uf: uf || undefined, all, overwrite };
}

async function loadLocalRendaFile(): Promise<RendaByIbgeFile | null> {
  try {
    const raw = await fs.readFile(RENDA_PATH, 'utf8');
    return JSON.parse(raw) as RendaByIbgeFile;
  } catch {
    return null;
  }
}

async function enrichOne(
  catalog: BairrosCatalog,
  localFile: RendaByIbgeFile | null,
  overwrite: boolean,
): Promise<void> {
  if (!catalog.ibge) {
    console.warn(`Skip ${catalog.cidade}-${catalog.uf}: sem ibge`);
    return;
  }

  const { rows, fonte } = await loadRendaRowsForIbge(catalog.ibge, localFile);
  if (!rows.length) {
    console.warn(`Skip ${catalog.cidade}-${catalog.uf}: sem fonte renda (ibge=${catalog.ibge})`);
    return;
  }

  const result = enrichCatalogWithRenda(catalog, rows, { fonte, overwrite });
  const outPath = path.join(BAIRROS_DIR, catalogFileName(catalog.cidade, catalog.uf));
  await fs.writeFile(outPath, `${JSON.stringify(result.catalog, null, 2)}\n`, 'utf8');

  console.log(
    `${catalog.cidade}-${catalog.uf}: matched=${result.matched} skipped=${result.skipped_existing} ` +
      `unmatched_catalog=${result.unmatched_catalog.length} unmatched_source=${result.unmatched_source.length}`,
  );
  if (result.unmatched_catalog.length) {
    console.log(`  sem renda: ${result.unmatched_catalog.slice(0, 5).join(', ')}${result.unmatched_catalog.length > 5 ? '…' : ''}`);
  }
}

async function main(): Promise<void> {
  loadDotEnv(path.join(ROOT, '.env.local'));
  const { cidade, uf, all, overwrite } = parseArgs();
  const localFile = await loadLocalRendaFile();
  if (localFile) {
    console.log(`Local renda: ${Object.keys(localFile).length} município(s) em ${RENDA_PATH}`);
  }

  if (all) {
    const files = (await fs.readdir(BAIRROS_DIR)).filter((f) => f.endsWith('.json'));
    for (const f of files.sort()) {
      const raw = JSON.parse(await fs.readFile(path.join(BAIRROS_DIR, f), 'utf8')) as BairrosCatalog;
      await enrichOne(raw, localFile, overwrite);
    }
    return;
  }

  const catalog = await loadBairrosCatalog(cidade!, uf!, BAIRROS_DIR);
  if (!catalog) {
    console.error(`Catálogo não encontrado: ${cidade}-${uf}`);
    process.exit(1);
  }
  await enrichOne(catalog, localFile, overwrite);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
