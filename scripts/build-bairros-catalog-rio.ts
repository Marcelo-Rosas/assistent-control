/**
 * Gera data/geo/bairros/rio-de-janeiro-rj.json — universo oficial de bairros
 * da cidade do Rio de Janeiro (166 bairros, Lei municipal 5.407/2012).
 *
 * Fonte oficial única (Prefeitura da Cidade do Rio de Janeiro):
 *   ArcGIS REST — Cartografia/Limites_administrativos, layer "Limite de Bairros" (ID 4)
 *   https://pgeo3.rio.rj.gov.br/arcgis/rest/services/Cartografia/Limites_administrativos/FeatureServer/4
 *   Campos usados: nome (acentuação oficial) e Shape__Area (área planar em m²,
 *   CRS SIRGAS 2000 / UTM 23S — wkid 31983, portanto área real, não Web
 *   Mercator). Retorna exatamente 166 feições. (O campo area_plane vem
 *   arredondado/inconsistente e NÃO é usado.)
 *
 * Demografia: area_ha vem de Shape__Area/10000. População 2022 e renda NÃO
 * entram — não estão nesta layer; Data.Rio publica o Censo 2022 por bairro em
 * tabela separada (pendente, NÃO inventar).
 *
 * Run: npx tsx scripts/build-bairros-catalog-rio.ts
 */
import fs from 'fs/promises';
import path from 'path';
import {
  bairroSlug,
  type BairrosCatalog,
  type BairroCatalogEntry,
} from './lib/wellhubBairrosCatalog.ts';

const LAYER =
  'https://pgeo3.rio.rj.gov.br/arcgis/rest/services/Cartografia/Limites_administrativos/FeatureServer/4';

type Feature = {
  attributes: { nome?: string; Shape__Area?: number; regiao_adm?: string };
};

async function main(): Promise<void> {
  const url =
    `${LAYER}/query?where=1%3D1&outFields=*` +
    `&returnGeometry=false&orderByFields=nome&f=json`;
  const res = await fetch(url, {
    headers: { 'User-Agent': 'GymSitePipeline/1.0 (bairros-rio)' },
  });
  if (!res.ok) throw new Error(`ArcGIS ${res.status}`);
  const data = (await res.json()) as { features?: Feature[] };
  const feats = data.features ?? [];
  if (!feats.length) throw new Error('ArcGIS retornou 0 feições');

  const seen = new Set<string>();
  let withArea = 0;
  const bairros: BairroCatalogEntry[] = [];
  for (const f of feats) {
    const bairro = String(f.attributes.nome || '').trim();
    if (!bairro) continue;
    const slug = bairroSlug(bairro);
    if (seen.has(slug)) continue; // dedup defensivo
    seen.add(slug);
    const entry: BairroCatalogEntry = { slug, bairro };
    const m2 = Number(f.attributes.Shape__Area);
    if (Number.isFinite(m2) && m2 > 0) {
      entry.area_ha = Math.round(m2 / 10000);
      withArea += 1;
    }
    bairros.push(entry);
  }

  const catalog: BairrosCatalog = {
    cidade: 'Rio de Janeiro',
    uf: 'RJ',
    ibge: '3304557',
    fonte:
      'Prefeitura da Cidade do Rio de Janeiro — ArcGIS Limites_administrativos, layer "Limite de Bairros" (Lei municipal 5.407/2012); area_plane em km²',
    bairros,
  };

  const outPath = path.join(process.cwd(), 'data/geo/bairros/rio-de-janeiro-rj.json');
  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, JSON.stringify(catalog, null, 2), 'utf-8');
  console.log(`Wrote ${bairros.length} bairros (${withArea} com area_ha) → ${outPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
