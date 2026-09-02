/**
 * Atualiza data/processed/renda-bairro-by-ibge.json a partir do IBGE (SIDRA + FTP).
 *
 * Preserva blocos existentes (SP/RJ) salvo --overwrite.
 *
 * Run:
 *   npx tsx scripts/fetch-renda-bairro-ibge.ts --ibge 3106200,3509502,3518800,4314902
 *   npx tsx scripts/fetch-renda-bairro-ibge.ts --all-new
 */
import fs from 'fs/promises';
import path from 'path';
import {
  fetchIbgeRendaForMunicipio,
  rowsToRendaMap,
  type IbgeRendaFetchResult,
} from './lib/ibgeRendaFtp.ts';
import type { RendaByIbgeFile } from './lib/enrichBairrosCatalogRenda.ts';

const ROOT = process.cwd();
const OUT_PATH = path.join(ROOT, 'data/processed/renda-bairro-by-ibge.json');
const CACHE_DIR = path.join(ROOT, 'data/cache/ibge-renda');
const DEFAULT_IBGE = ['3106200', '3509502', '3518800', '4314902'];

function parseArgs(): { ibges: string[]; overwrite: boolean } {
  const overwrite = process.argv.includes('--overwrite');
  const allNew = process.argv.includes('--all-new');
  const raw =
    process.argv.find((a) => a.startsWith('--ibge='))?.split('=').slice(1).join('=') ||
    process.argv[process.argv.indexOf('--ibge') + 1];
  if (allNew) return { ibges: DEFAULT_IBGE, overwrite };
  if (!raw) {
    console.error('Uso: --ibge 3106200,3509502 | --all-new [--overwrite]');
    process.exit(1);
  }
  return { ibges: raw.split(/[,\s]+/).map((s) => s.trim()).filter(Boolean), overwrite };
}

async function loadOut(): Promise<RendaByIbgeFile> {
  try {
    return JSON.parse(await fs.readFile(OUT_PATH, 'utf8')) as RendaByIbgeFile;
  } catch {
    return {};
  }
}

async function main(): Promise<void> {
  const { ibges, overwrite } = parseArgs();
  const out = await loadOut();
  const details: IbgeRendaFetchResult[] = [];

  for (const ibge of ibges) {
    if (out[ibge] && !overwrite) {
      console.log(`Skip ${ibge}: já existe (${Object.keys(out[ibge]).length} bairros)`);
      continue;
    }
    console.log(`Fetch ${ibge}…`);
    const result = await fetchIbgeRendaForMunicipio(ibge, CACHE_DIR);
    out[ibge] = rowsToRendaMap(result.rows);
    details.push(result);
    console.log(`  ${ibge}: ${result.rows.length} unidades — ${result.fonte}`);
  }

  await fs.mkdir(path.dirname(OUT_PATH), { recursive: true });
  await fs.writeFile(OUT_PATH, `${JSON.stringify(out, null, 2)}\n`, 'utf8');
  console.log(`Wrote ${OUT_PATH} (${Object.keys(out).length} municípios)`);

  const metaPath = path.join(ROOT, 'data/processed/renda-bairro-by-ibge.meta.json');
  await fs.writeFile(
    metaPath,
    `${JSON.stringify({ updated_at: new Date().toISOString(), details }, null, 2)}\n`,
    'utf8',
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
