/**
 * Gera data/geo/bairros/campinas-sp.json — universo de bairros Campinas via Receita CNAE.
 *
 * Campinas não publica lista/polígono único de bairros como SP/RJ/BH. Fonte operacional:
 * distritos distintos em CNPJ ativos (CNAE 9313100 principal) no município RFB 6291 / IBGE 3509502.
 *
 * Run: npx tsx scripts/build-bairros-catalog-campinas.ts
 */
import fs from 'fs/promises';
import path from 'path';
import {
  bairroSlug,
  type BairrosCatalog,
  type BairroCatalogEntry,
} from './lib/wellhubBairrosCatalog.ts';

const RECEITA_PATH = path.join(
  process.cwd(),
  'data/processed/receita-cnae-9313100-principal-ativos.json',
);
const RFB_CAMPINAS = '6291';
const IBGE_CAMPINAS = '3509502';

function titleCaseBairro(raw: string): string {
  const lower = raw.trim().toLowerCase();
  return lower.replace(/\b[\p{L}\p{M}']+\b/gu, (w) => w.charAt(0).toUpperCase() + w.slice(1));
}

async function main(): Promise<void> {
  const raw = JSON.parse(await fs.readFile(RECEITA_PATH, 'utf-8')) as
    | Array<{ bairro?: string; municipio?: string | number }>
    | { data?: Array<{ bairro?: string; municipio?: string | number }> };
  const rows = Array.isArray(raw) ? raw : (raw.data ?? []);

  const bySlug = new Map<string, BairroCatalogEntry>();
  for (const row of rows) {
    const rfb = String(row.municipio ?? '').trim().padStart(4, '0');
    if (rfb !== RFB_CAMPINAS) continue;
    const label = titleCaseBairro(String(row.bairro ?? ''));
    if (!label || label.length < 2) continue;
    const slug = bairroSlug(label);
    if (!slug) continue;
    if (!bySlug.has(slug)) bySlug.set(slug, { slug, bairro: label });
  }

  const bairros = [...bySlug.values()].sort((a, b) =>
    a.bairro.localeCompare(b.bairro, 'pt-BR'),
  );
  if (!bairros.length) throw new Error('Nenhum bairro Receita para Campinas');

  const catalog: BairrosCatalog = {
    cidade: 'Campinas',
    uf: 'SP',
    ibge: IBGE_CAMPINAS,
    fonte:
      'Receita Federal — CNAE 9313100 principal ativos, município RFB 6291 (Campinas-SP); sem catálogo oficial único de polígonos de bairro',
    bairros,
  };

  const outPath = path.join(process.cwd(), 'data/geo/bairros/campinas-sp.json');
  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, `${JSON.stringify(catalog, null, 2)}\n`, 'utf-8');
  console.log(`Wrote ${bairros.length} bairros → ${outPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
