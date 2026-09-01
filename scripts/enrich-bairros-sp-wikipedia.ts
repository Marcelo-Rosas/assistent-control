/**
 * Enriquece data/geo/bairros/sao-paulo-sp.json com demografia opcional
 * (area_ha, densidade_hab_ha) extraída dos infoboxes dos artigos de cada
 * distrito na Wikipédia lusófona, via MediaWiki API (wikitext cru — sem
 * sumarização/LLM, portanto sem risco de número inventado).
 *
 * Cadeia de fonte:
 *   - Títulos dos artigos: tabela "Lista dos distritos de São Paulo por população"
 *     https://pt.wikipedia.org/wiki/Lista_dos_distritos_de_São_Paulo_por_população
 *   - area (km²): campo |area do infobox de cada distrito, que por sua vez cita
 *     IBGE (cidades.ibge.gov.br) e Prefeitura de São Paulo (dados abertos /
 *     GeoSampa) — ver refs nos próprios artigos.
 *   - populacao_2022 já vem do build (IBGE Censo 2022).
 *   - densidade_hab_ha é RECALCULADA (populacao_2022 / area_ha) para ficar
 *     internamente consistente com a população IBGE.
 *   - renda_media_sm NÃO é preenchida (sem fonte oficial por distrito).
 *
 * Run: npx tsx scripts/enrich-bairros-sp-wikipedia.ts
 *      (não sobrescreve nomes/slugs/pop; só acrescenta area_ha/densidade.)
 */
import fs from 'fs/promises';
import path from 'path';
import {
  bairroSlug,
  type BairrosCatalog,
} from './lib/wellhubBairrosCatalog.ts';

const API = 'https://pt.wikipedia.org/w/api.php';
const POP_LIST_PAGE = 'Lista dos distritos de São Paulo por população';

async function apiJson(params: Record<string, string>): Promise<any> {
  const qs = new URLSearchParams({ format: 'json', ...params }).toString();
  const res = await fetch(`${API}?${qs}`, {
    headers: { 'User-Agent': 'GymSitePipeline/1.0 (bairros-enrich)' },
  });
  if (!res.ok) throw new Error(`API ${res.status} for ${params.titles || params.page}`);
  return res.json();
}

/** Parse pt-BR number: "3.922" → 3922, "8,4" → 8.4, "92" → 92 */
function parsePtNumber(raw: string): number | undefined {
  let s = String(raw || '').trim();
  if (!s) return undefined;
  // strip any trailing unit/refs
  s = s.replace(/<.*$/s, '').replace(/\[.*$/s, '').trim();
  s = s.replace(/\s/g, '');
  if (s.includes(',')) {
    // comma is decimal sep; dots are thousands
    s = s.replace(/\./g, '').replace(',', '.');
  } else if (/^\d{1,3}(\.\d{3})+$/.test(s)) {
    // pure thousands grouping
    s = s.replace(/\./g, '');
  }
  const v = Number(s);
  return Number.isFinite(v) ? v : undefined;
}

/** Extract [[Target|Display]] / [[Name]] links → map slug(display) → article title */
function linkTitleMap(wikitext: string): Map<string, string> {
  const map = new Map<string, string>();
  const re = /\[\[([^\]|]+?)(?:\|([^\]]+?))?\]\]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(wikitext))) {
    const target = m[1].trim();
    const display = (m[2] || m[1]).trim();
    // só links de distrito
    if (!/distrito|São Paulo/i.test(target) && !map.has(bairroSlug(display))) {
      map.set(bairroSlug(display), target);
    }
    if (/distrito/i.test(target)) map.set(bairroSlug(display), target);
  }
  return map;
}

function parseInfoboxArea(wikitext: string): number | undefined {
  // |area = 92  ·  |área = 92  ·  |area_total = 92  (km²)
  const m = wikitext.match(/\|\s*(?:área|area(?:_total)?)\s*=\s*([\d.,]+)/i);
  if (!m) return undefined;
  return parsePtNumber(m[1]);
}

async function main(): Promise<void> {
  const catalogPath = path.join(process.cwd(), 'data/geo/bairros/sao-paulo-sp.json');
  const catalog = JSON.parse(await fs.readFile(catalogPath, 'utf-8')) as BairrosCatalog;

  // 1) títulos dos artigos a partir da lista por população
  const popList = await apiJson({ action: 'parse', page: POP_LIST_PAGE, prop: 'wikitext' });
  const listWikitext = popList.parse.wikitext['*'] as string;
  const titleMap = linkTitleMap(listWikitext);

  const titleFor = (bairro: string): string =>
    titleMap.get(bairroSlug(bairro)) || `${bairro} (distrito de São Paulo)`;

  const titles = catalog.bairros.map((b) => titleFor(b.bairro));

  // 2) batch fetch dos infoboxes (50 títulos por request)
  const areaByTitleSlug = new Map<string, number>();
  const requestedToFinal = new Map<string, string>(); // slug(requested) → final title
  for (let i = 0; i < titles.length; i += 50) {
    const batch = titles.slice(i, i + 50);
    const j = await apiJson({
      action: 'query',
      prop: 'revisions',
      rvslots: 'main',
      rvprop: 'content',
      titles: batch.join('|'),
      redirects: '1',
    });
    const pages = j.query?.pages ?? {};
    // requested title → final (após normalize + redirect)
    const chain = new Map<string, string>();
    for (const n of j.query?.normalized ?? []) chain.set(n.from, n.to);
    for (const r of j.query?.redirects ?? []) chain.set(r.from, r.to);
    for (const reqTitle of batch) {
      let t = reqTitle;
      // segue normalize→redirect (no máx. 2 saltos)
      for (let hop = 0; hop < 3 && chain.has(t); hop++) t = chain.get(t)!;
      requestedToFinal.set(bairroSlug(reqTitle), t);
    }
    for (const p of Object.values<any>(pages)) {
      if (!p.revisions) continue;
      const w = p.revisions[0].slots.main['*'] as string;
      const area = parseInfoboxArea(w);
      if (area !== undefined) areaByTitleSlug.set(bairroSlug(p.title), area);
    }
  }

  // 3) merge (resolve via título final pós-redirect)
  let filled = 0;
  const missing: string[] = [];
  for (const entry of catalog.bairros) {
    const title = titleFor(entry.bairro);
    const finalTitle = requestedToFinal.get(bairroSlug(title)) || title;
    const areaKm2 = areaByTitleSlug.get(bairroSlug(finalTitle));
    if (areaKm2 === undefined || areaKm2 <= 0) {
      missing.push(entry.bairro);
      continue;
    }
    const area_ha = Math.round(areaKm2 * 100);
    entry.area_ha = area_ha;
    if (entry.populacao_2022 && area_ha > 0) {
      entry.densidade_hab_ha = Math.round((entry.populacao_2022 / area_ha) * 10) / 10;
    }
    filled += 1;
  }

  await fs.writeFile(catalogPath, JSON.stringify(catalog, null, 2), 'utf-8');
  console.log(`area_ha preenchido: ${filled}/${catalog.bairros.length}`);
  if (missing.length) console.log(`sem area (${missing.length}): ${missing.join(', ')}`);
  console.log(`Wrote ${catalogPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
