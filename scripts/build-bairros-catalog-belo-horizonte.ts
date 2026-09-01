/**
 * Gera data/geo/bairros/belo-horizonte-mg.json — bairros oficiais BH (Lei 11.490/2023).
 *
 * Fonte: Prefeitura de Belo Horizonte — Portal Dados Abertos PBH
 *   dataset bairro-popular (Lei 11.490/2023)
 *   CSV 20240902_bairro_popular.csv — campos NOME, AREA_KM2
 *
 * Run: npx tsx scripts/build-bairros-catalog-belo-horizonte.ts
 */
import fs from 'fs/promises';
import path from 'path';
import {
  bairroSlug,
  type BairrosCatalog,
  type BairroCatalogEntry,
} from './lib/wellhubBairrosCatalog.ts';

const CSV_URL =
  'https://ckan.pbh.gov.br/dataset/d890ccf6-d424-43bd-b513-b492306a0957/resource/710e73a6-c0b8-41e5-ad08-b6b9e33564dd/download/20240902_bairro_popular.csv';

function parseCsvLine(line: string): { nome: string; areaKm2: number | null } | null {
  const parts = line.split(';');
  if (parts.length < 4) return null;
  const nome = parts[2]?.trim();
  if (!nome) return null;
  const areaRaw = parts[3]?.trim().replace(',', '.');
  const areaKm2 = areaRaw ? Number(areaRaw) : NaN;
  return { nome, areaKm2: Number.isFinite(areaKm2) ? areaKm2 : null };
}

async function main(): Promise<void> {
  const res = await fetch(CSV_URL, {
    headers: { 'User-Agent': 'GymSitePipeline/1.0 (bairros-bh)' },
  });
  if (!res.ok) throw new Error(`PBH CSV HTTP ${res.status}`);

  const text = await res.text();
  const lines = text.split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) throw new Error('CSV vazio');

  const bySlug = new Map<string, BairroCatalogEntry>();
  for (const line of lines.slice(1)) {
    const row = parseCsvLine(line);
    if (!row) continue;
    const slug = bairroSlug(row.nome);
    if (!slug) continue;
    const prev = bySlug.get(slug);
    const area_ha =
      row.areaKm2 != null ? Math.max(1, Math.round(row.areaKm2 * 100)) : undefined;
    if (!prev) {
      bySlug.set(slug, { slug, bairro: row.nome, ...(area_ha ? { area_ha } : {}) });
      continue;
    }
    if (area_ha && prev.area_ha) prev.area_ha += area_ha;
    else if (area_ha && !prev.area_ha) prev.area_ha = area_ha;
  }

  const bairros = [...bySlug.values()].sort((a, b) => a.bairro.localeCompare(b.bairro, 'pt-BR'));

  const catalog: BairrosCatalog = {
    cidade: 'Belo Horizonte',
    uf: 'MG',
    ibge: '3106200',
    fonte:
      'Prefeitura de Belo Horizonte — Dados Abertos PBH, dataset bairro-popular (Lei municipal 11.490/2023); CSV 20240902_bairro_popular',
    bairros,
  };

  const outPath = path.join(process.cwd(), 'data/geo/bairros/belo-horizonte-mg.json');
  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, `${JSON.stringify(catalog, null, 2)}\n`, 'utf-8');
  console.log(`Wrote ${bairros.length} bairros → ${outPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
