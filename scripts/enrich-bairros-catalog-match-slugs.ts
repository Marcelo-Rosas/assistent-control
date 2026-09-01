/**
 * Enriquece catálogo oficial com match_slugs derivados da Receita CNAE.
 *
 * Run: npx tsx scripts/enrich-bairros-catalog-match-slugs.ts --cidade "São Paulo" --uf SP
 */
import fs from 'fs/promises';
import path from 'path';
import {
  catalogFileName,
  loadBairrosCatalog,
  type BairrosCatalog,
} from './lib/wellhubBairrosCatalog.ts';
import {
  buildReceitaBairrosFromJson,
} from './lib/bairroCoverageAudit.ts';
import { enrichCatalogMatchSlugsFromReceita } from './lib/catalogDistritoResolver.ts';

const ROOT = process.cwd();
const RECEITA_PATH = path.join(
  ROOT,
  'data/processed/receita-cnae-9313100-principal-ativos.json',
);
const BAIRROS_DIR = path.join(ROOT, 'data/geo/bairros');

function parseArgs(): { cidade: string; uf: string } {
  const cidade =
    process.argv.find((a) => a.startsWith('--cidade='))?.split('=').slice(1).join('=') ||
    process.argv[process.argv.indexOf('--cidade') + 1];
  const uf = (
    process.argv.find((a) => a.startsWith('--uf='))?.split('=')[1] ||
    process.argv[process.argv.indexOf('--uf') + 1] ||
    ''
  ).toUpperCase();
  if (!cidade || !uf) {
    console.error('Uso: --cidade "São Paulo" --uf SP');
    process.exit(1);
  }
  return { cidade, uf };
}

async function main(): Promise<void> {
  const { cidade, uf } = parseArgs();
  const catalog = await loadBairrosCatalog(cidade, uf, BAIRROS_DIR);
  if (!catalog?.ibge) {
    console.error(`Catálogo não encontrado para ${cidade}-${uf}`);
    process.exit(1);
  }

  const receitaByIbge = buildReceitaBairrosFromJson(RECEITA_PATH);
  const receitaSet = receitaByIbge.get(catalog.ibge);
  if (!receitaSet?.size) {
    console.error(`Sem bairros Receita para IBGE ${catalog.ibge}`);
    process.exit(1);
  }

  const enriched = enrichCatalogMatchSlugsFromReceita(catalog, receitaSet);
  let aliasCount = 0;
  for (const b of enriched.bairros) {
    aliasCount += b.match_slugs?.length ?? 0;
  }

  const outPath = path.join(BAIRROS_DIR, catalogFileName(cidade, uf));
  await fs.writeFile(outPath, `${JSON.stringify(enriched, null, 2)}\n`, 'utf-8');

  console.log(`Wrote ${outPath}`);
  console.log(`Distritos: ${enriched.bairros.length} · match_slugs: ${aliasCount}`);
  console.log(
    `Ex.: ${enriched.bairros
      .filter((b) => (b.match_slugs?.length ?? 0) > 0)
      .slice(0, 3)
      .map((b) => `${b.bairro}(${b.match_slugs!.length})`)
      .join(', ')}`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
