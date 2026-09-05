/**
 * Auditoria de cobertura de bairros por município e agregador.
 */
import fs from 'fs';
import fsPromises from 'fs/promises';
import path from 'path';
import {
  bairroSlug,
  catalogFileName,
  type BairrosCatalog,
} from './wellhubBairrosCatalog.ts';
import { fold, parseCityUfFromAddress, cidadeKey } from './academia-normalize.ts';
import { CODIGO_RFB_PARA_MUNICIPIO } from './municipioMapper.ts';
import {
  buildReceitaToCatalogAliasMap,
  enrichCatalogMatchSlugsFromReceita,
  matchesDistritoSlug,
  registerAggregatorBairro,
} from './catalogDistritoResolver.ts';
import {
  classifyMunicipioTier,
  isTierAtLeast,
  MUNICIPIO_TIER_DEFINITION,
  type MunicipioTier,
} from './municipioTier.ts';

export { matchesDistritoSlug };
export { classifyMunicipioTier, isTierAtLeast, MUNICIPIO_TIER_DEFINITION };
export type { MunicipioTier };

export type AggregatorId = 'wellhub' | 'totalpass' | 'gurupass';

export type ReferenceSource = 'catalog' | 'receita' | 'derived_union' | 'none';

export type AggregatorBairroStats = {
  gym_count: number;
  bairros_with_gyms: number;
  bairros_distinct: string[];
  parseable_count: number;
  parseable_pct: number | null;
  coverage_pct: number | null;
  missing_bairros: string[];
  failures: string[];
  /** TP: gyms cujo bairro veio do índice (CEP/Nominatim/cache). */
  index_hit_count?: number;
  /** TP: subset de index_hit com source CEP (receita_cep / cep_municipio / receita_logradouro_cep). */
  cep_hit_count?: number;
};

export type MunicipioCoverageRow = {
  municipio_key: string;
  cidade: string;
  uf: string;
  ibge: string | null;
  populacao: number | null;
  tier: MunicipioTier | null;
  reference_source: ReferenceSource;
  reference_bairro_count: number;
  catalog_file: string | null;
  receita_bairro_count: number;
  wellhub: AggregatorBairroStats;
  totalpass: AggregatorBairroStats;
  gurupass: AggregatorBairroStats;
  union_bairros_discovered: number;
  wh_scrape_bairros_planned: number | null;
  wh_scrape_bairros_done: number | null;
  wh_scrape_completion_pct: number | null;
  gaps: string[];
};

export type TpIndexAuditStats = {
  total: number;
  resolved: number;
  resolved_cep: number;
  failed: number;
  provider: string | null;
  /** % resolved / total no índice. */
  resolved_pct: number | null;
  /** % resolved_cep / total — métrica CEP honesta (≠ 100% sem CEP em todo gym). */
  resolved_cep_pct: number | null;
};

export type MissingBairrosT3PlusEntry = {
  municipio_key: string;
  cidade: string;
  uf: string;
  tier: MunicipioTier;
  populacao: number | null;
  reference_source: ReferenceSource;
  reference_bairro_count: number;
  tp_gym_count: number;
  tp_parseable_pct: number | null;
  tp_coverage_pct: number | null;
  tp_cep_hit_count: number;
  tp_index_hit_count: number;
  missing_bairros: string[];
};

export type BairroCoverageAuditReport = {
  version: '1';
  generated_at: string;
  filter_uf: string | null;
  /** Baseline histórico pré-re-run CEP (audit 2026-09-02). */
  baseline_2026_09_02?: {
    avg_tp_coverage_pct: number;
    note: string;
  };
  summary: {
    municipios_audited: number;
    municipios_with_catalog: number;
    municipios_with_receita_ref: number;
    municipios_t3_plus: number;
    avg_wh_coverage_pct: number | null;
    avg_tp_coverage_pct: number | null;
    /** Média cov% TP só em T3+ com gyms TP e coverage mensurável. */
      avg_tp_coverage_pct_t3_plus: number | null;
    avg_tp_parseable_pct: number | null;
    /** Parseable TP ponderado por gym_count (mais honesto que média municipal). */
    tp_parseable_pct_gym_weighted: number | null;
    avg_gp_coverage_pct: number | null;
    tp_index: TpIndexAuditStats | null;
    honesty_notes: string[];
    aggregator_failures: Record<AggregatorId, string[]>;
  };
  plan_100pct_review: {
    wellhub: string[];
    totalpass: string[];
    gurupass: string[];
  };
  missing_bairros_t3_plus: MissingBairrosT3PlusEntry[];
  rows: MunicipioCoverageRow[];
};

const CEP_SOURCES = new Set([
  'receita_cep',
  'cep_municipio',
  'receita_logradouro_cep',
  'detail_cep',
  'list_cep',
  'viacep',
  'brasilapi',
]);

export function isCepBairroSource(source: string | undefined | null): boolean {
  if (!source) return false;
  const s = source.toLowerCase();
  if (CEP_SOURCES.has(s)) return true;
  return s.includes('cep') && !s.includes('nominatim');
}

/** Padrão WH: "... - Bairro, Cidade - UF, CEP" */
export function extractBairroFromAddress(endereco: string, cidade?: string): string {
  const addr = String(endereco || '');
  if (cidade) {
    const needle = `, ${cidade} -`;
    const idx = addr.toLowerCase().lastIndexOf(needle.toLowerCase());
    if (idx >= 0) {
      const before = addr.slice(0, idx);
      const parts = before.split(' - ');
      const last = (parts[parts.length - 1] || '').trim();
      if (last.length >= 3 && last.length <= 48 && !/^\d/.test(last)) {
        if (!/conjunto|sala|loja|andar|bloco|apto|apartamento/i.test(last)) {
          return last;
        }
      }
    }
  }
  return extractBairroFromEndereco(addr);
}

export function extractBairroFromEndereco(endereco: string): string {
  const m = String(endereco || '').match(/-\s*([^,]+),\s*[^,]+-\s*[A-Z]{2}/);
  return m?.[1]?.trim() || '';
}

function emptyAggStats(): AggregatorBairroStats {
  return {
    gym_count: 0,
    bairros_with_gyms: 0,
    bairros_distinct: [],
    parseable_count: 0,
    parseable_pct: null,
    coverage_pct: null,
    missing_bairros: [],
    failures: [],
    index_hit_count: 0,
    cep_hit_count: 0,
  };
}

function pct(num: number, den: number): number | null {
  if (den <= 0) return null;
  return Math.round((num / den) * 1000) / 10;
}

function catalogSlugSet(catalog: BairrosCatalog): Map<string, string> {
  const map = new Map<string, string>();
  for (const b of catalog.bairros) {
    map.set(bairroSlug(b.bairro), b.bairro);
    if (b.wellhub_slug) map.set(bairroSlug(b.wellhub_slug), b.bairro);
    for (const alias of b.match_slugs ?? []) {
      map.set(bairroSlug(alias), b.bairro);
    }
  }
  return map;
}

function receitaSlug(bairro: string): string {
  return bairroSlug(bairro.replace(/\/.*/g, '').trim());
}

export function buildReceitaBairrosByIbge(csvPath: string): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>();
  if (!fs.existsSync(csvPath)) return map;

  const text = fs.readFileSync(csvPath, 'utf8');
  const lines = text.split(/\r?\n/);
  const header = lines[0]?.split(',') ?? [];
  const bairroIdx = header.indexOf('bairro');
  const munIdx = header.indexOf('municipio');
  if (bairroIdx < 0 || munIdx < 0) return map;

  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(',');
    if (cols.length < header.length) continue;
    const rfb = cols[munIdx]?.trim();
    const bairro = cols[bairroIdx]?.trim();
    if (!bairro || !rfb) continue;
    const ref = CODIGO_RFB_PARA_MUNICIPIO[rfb.padStart(4, '0')];
    const ibge = ref?.ibge;
    if (!ibge) continue;
    if (!map.has(ibge)) map.set(ibge, new Set());
    map.get(ibge)!.add(receitaSlug(bairro));
  }
  return map;
}

export function buildReceitaBairrosFromJson(jsonPath: string): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>();
  if (!fs.existsSync(jsonPath)) return map;

  const raw = JSON.parse(fs.readFileSync(jsonPath, 'utf8')) as unknown;
  const rows = Array.isArray(raw) ? raw : ((raw as { data?: unknown[] }).data ?? []);
  for (const row of rows as Array<{ bairro?: string; municipio?: string | number }>) {
    const bairro = String(row.bairro ?? '').trim();
    const rfb = String(row.municipio ?? '').trim();
    if (!bairro || !rfb) continue;
    const ref = CODIGO_RFB_PARA_MUNICIPIO[rfb.padStart(4, '0')];
    const ibge = ref?.ibge;
    if (!ibge) continue;
    if (!map.has(ibge)) map.set(ibge, new Set());
    map.get(ibge)!.add(receitaSlug(bairro));
  }
  return map;
}

type GymRecord = { bairroNorm: string; bairroLabel: string };

function finalizeAgg(
  stats: AggregatorBairroStats,
  bairroMap: Map<string, GymRecord>,
  referenceSlugs: Set<string> | null,
  referenceLabels: Map<string, string> | null,
): void {
  stats.bairros_distinct = [...bairroMap.keys()].sort();
  stats.bairros_with_gyms = stats.bairros_distinct.length;
  stats.parseable_pct = pct(stats.parseable_count, stats.gym_count);

  if (referenceSlugs && referenceSlugs.size > 0 && bairroMap.size > 0) {
    const gymSlugs = stats.bairros_distinct;
    const catalogMode = referenceLabels != null && referenceLabels.size > 0;
    const hit = [...referenceSlugs].filter(
      (s) =>
        bairroMap.has(s) ||
        (catalogMode && gymSlugs.some((gs) => matchesDistritoSlug(gs, s))),
    );
    stats.coverage_pct = pct(hit.length, referenceSlugs.size);
    const labelFromSlug = (slug: string) => {
      if (referenceLabels?.has(slug)) return referenceLabels.get(slug)!;
      const fromGyms = bairroMap.get(slug)?.bairroLabel;
      return fromGyms ?? slug.replace(/-/g, ' ');
    };
    stats.missing_bairros = [...referenceSlugs]
      .filter((s) => !hit.includes(s))
      .map(labelFromSlug)
      .sort((a, b) => a.localeCompare(b, 'pt-BR'));
  } else if (referenceSlugs && referenceSlugs.size > 0 && stats.gym_count > 0 && bairroMap.size === 0) {
    stats.coverage_pct = null;
    stats.failures.push('bairro_nao_resolvivel');
  }
}

export async function loadBairrosCatalogs(dir: string): Promise<Map<string, BairrosCatalog>> {
  const out = new Map<string, BairrosCatalog>();
  try {
    const files = await fsPromises.readdir(dir);
    for (const f of files.filter((x) => x.endsWith('.json'))) {
      const raw = await fsPromises.readFile(path.join(dir, f), 'utf8');
      const cat = JSON.parse(raw) as BairrosCatalog;
      if (!cat?.cidade || !cat?.uf || !cat?.bairros?.length) continue;
      out.set(cidadeKey(cat.cidade, cat.uf), cat);
    }
  } catch {
    /* empty dir */
  }
  return out;
}

type WhGym = {
  id?: string;
  fullAddress?: string;
  uf?: string;
  municipios_busca?: string[];
  wh_bairro_busca?: string[];
};

type TpGym = {
  id?: string;
  attributes?: {
    full_address?: string;
    uf?: string;
    location?: { lat?: number; lng?: number };
    municipios_busca?: string[];
    municipios_relacionados?: string[];
  };
};

type GpGym = {
  gurupass_id?: string;
  city?: string;
  state?: string;
  uf?: string;
  neighborhood?: string;
  address?: string;
  municipios_busca?: string[];
};

function gymBelongsToMunicipio(
  cidade: string,
  uf: string,
  busca: string[] | undefined,
  endereco: string,
): boolean {
  const key = cidadeKey(cidade, uf);
  if (busca?.some((m) => cidadeKey(m, uf) === key || fold(m) === fold(cidade))) return true;
  const parsed = parseCityUfFromAddress(endereco);
  if (parsed && fold(parsed.cidade) === fold(cidade) && parsed.uf === uf) return true;
  return false;
}

function addBairro(
  map: Map<string, GymRecord>,
  label: string,
): void {
  const norm = bairroSlug(label);
  if (!norm) return;
  if (!map.has(norm)) map.set(norm, { bairroNorm: norm, bairroLabel: label.trim() });
}

function indexGymsByMunicipio<T>(
  gyms: T[],
  assign: (g: T, index: Map<string, T[]>) => void,
): Map<string, T[]> {
  const index = new Map<string, T[]>();
  for (const g of gyms) assign(g, index);
  return index;
}

export function buildMunicipioCoverageRows(opts: {
  municipios: Array<{ nome: string; uf: string; ibge?: string; populacao?: number }>;
  filterUf: string | null;
  catalogs: Map<string, BairrosCatalog>;
  receitaByIbge: Map<string, Set<string>>;
  whGyms: WhGym[];
  tpGyms: TpGym[];
  gpGyms: GpGym[];
  tpBairroByGymId?: Record<
    string,
    { bairro: string; bairro_slug?: string; source?: string; cep?: string }
  >;
  whProgress?: Record<string, { bairros_planned?: number; bairros_done?: number }>;
}): MunicipioCoverageRow[] {
  const whIndex = indexGymsByMunicipio(opts.whGyms, (g, index) => {
    const addr = g.fullAddress ?? '';
    const parsed = parseCityUfFromAddress(addr);
    const keys = new Set<string>();
    if (parsed?.cidade && parsed.uf) keys.add(cidadeKey(parsed.cidade, parsed.uf));
    for (const m of g.municipios_busca ?? []) {
      if (g.uf) keys.add(cidadeKey(m, g.uf));
    }
    for (const k of keys) {
      if (!index.has(k)) index.set(k, []);
      index.get(k)!.push(g);
    }
  });

  const tpIndex = indexGymsByMunicipio(opts.tpGyms, (g, index) => {
    const a = g.attributes ?? {};
    const addr = a.full_address ?? '';
    const parsed = parseCityUfFromAddress(addr);
    const keys = new Set<string>();
    if (parsed?.cidade && parsed.uf) keys.add(cidadeKey(parsed.cidade, parsed.uf));
    const uf = a.uf ?? parsed?.uf ?? '';
    for (const m of [...(a.municipios_busca ?? []), ...(a.municipios_relacionados ?? [])]) {
      if (uf) keys.add(cidadeKey(m, uf));
    }
    for (const k of keys) {
      if (!index.has(k)) index.set(k, []);
      index.get(k)!.push(g);
    }
  });

  const gpIndex = indexGymsByMunicipio(opts.gpGyms, (g, index) => {
    const addr = g.address ?? '';
    const parsed = parseCityUfFromAddress(addr);
    const cidade = typeof g.city === 'string' ? g.city : parsed?.cidade ?? '';
    const uf = g.uf ?? g.state ?? parsed?.uf ?? '';
    const keys = new Set<string>();
    if (cidade && uf) keys.add(cidadeKey(cidade, uf));
    for (const m of g.municipios_busca ?? []) {
      if (uf) keys.add(cidadeKey(m, uf));
    }
    for (const k of keys) {
      if (!index.has(k)) index.set(k, []);
      index.get(k)!.push(g);
    }
  });

  const activeKeys = new Set<string>([
    ...whIndex.keys(),
    ...tpIndex.keys(),
    ...gpIndex.keys(),
    ...opts.catalogs.keys(),
  ]);

  const rows: MunicipioCoverageRow[] = [];

  for (const mun of opts.municipios) {
    if (opts.filterUf && mun.uf !== opts.filterUf) continue;

    const key = cidadeKey(mun.nome, mun.uf);
    if (!activeKeys.has(key)) continue;
    const catalogRaw = opts.catalogs.get(key) ?? null;
    const receitaSet = mun.ibge ? opts.receitaByIbge.get(mun.ibge) : undefined;
    const catalog =
      catalogRaw && receitaSet?.size
        ? enrichCatalogMatchSlugsFromReceita(catalogRaw, receitaSet)
        : catalogRaw;
    const receitaAlias =
      catalog && receitaSet?.size
        ? buildReceitaToCatalogAliasMap(catalog, receitaSet)
        : undefined;

    let referenceSource: ReferenceSource = 'none';
    let referenceSlugs: Set<string> | null = null;
    let referenceLabels: Map<string, string> | null = null;
    let referenceCount = 0;

    if (catalog) {
      referenceSource = 'catalog';
      referenceLabels = catalogSlugSet(catalog);
      referenceSlugs = new Set(catalog.bairros.map((b) => b.slug));
      referenceCount = catalog.bairros.length;
    } else if (receitaSet && receitaSet.size > 0) {
      referenceSource = 'receita';
      referenceSlugs = new Set(receitaSet);
      referenceCount = receitaSet.size;
    }

    const wh = emptyAggStats();
    const tp = emptyAggStats();
    const gp = emptyAggStats();
    const whBairros = new Map<string, GymRecord>();
    const tpBairros = new Map<string, GymRecord>();
    const gpBairros = new Map<string, GymRecord>();
    const union = new Set<string>();

    for (const g of whIndex.get(key) ?? []) {
      const addr = g.fullAddress ?? '';
      wh.gym_count += 1;
      const b = extractBairroFromAddress(addr, mun.nome);
      if (b) {
        wh.parseable_count += 1;
        registerAggregatorBairro(whBairros, b, catalog, receitaAlias);
        union.add(bairroSlug(b));
      } else {
        wh.failures.push('endereco_sem_bairro');
      }
      for (const buscaSlug of g.wh_bairro_busca ?? []) {
        const label = referenceLabels?.get(buscaSlug) ?? buscaSlug.replace(/-/g, ' ');
        addBairro(whBairros, label);
        union.add(buscaSlug);
      }
    }

    for (const g of tpIndex.get(key) ?? []) {
      const a = g.attributes ?? {};
      const addr = a.full_address ?? '';
      tp.gym_count += 1;
      const geocoded = g.id ? opts.tpBairroByGymId?.[g.id] : undefined;
      if (geocoded?.bairro?.trim()) {
        tp.index_hit_count = (tp.index_hit_count ?? 0) + 1;
        if (isCepBairroSource(geocoded.source) || (geocoded.cep && geocoded.cep.replace(/\D/g, '').length === 8)) {
          tp.cep_hit_count = (tp.cep_hit_count ?? 0) + 1;
        }
      }
      const b =
        geocoded?.bairro?.trim() ||
        extractBairroFromAddress(addr, mun.nome) ||
        extractBairroFromEndereco(addr);
      if (b) {
        tp.parseable_count += 1;
        registerAggregatorBairro(tpBairros, b, catalog, receitaAlias);
        union.add(bairroSlug(b));
      } else {
        tp.failures.push(geocoded ? 'geocode_sem_bairro' : 'endereco_sem_bairro');
      }
    }

    for (const g of gpIndex.get(key) ?? []) {
      const addr = g.address ?? '';
      gp.gym_count += 1;
      const b = (g.neighborhood ?? '').trim() || extractBairroFromAddress(addr, mun.nome);
      if (b) {
        gp.parseable_count += 1;
        registerAggregatorBairro(gpBairros, b, catalog, receitaAlias);
        union.add(bairroSlug(b));
      } else {
        gp.failures.push('sem_neighborhood');
      }
    }

    if (!referenceSlugs && union.size > 0) {
      referenceSource = 'derived_union';
      referenceSlugs = new Set(union);
      referenceCount = union.size;
    }

    if (catalog) {
      for (const entry of catalog.bairros) {
        if (!entry.wellhub_absent) continue;
        addBairro(whBairros, entry.bairro);
        union.add(entry.slug);
      }
    }

    finalizeAgg(wh, whBairros, referenceSlugs, referenceLabels);
    finalizeAgg(tp, tpBairros, referenceSlugs, referenceLabels);
    finalizeAgg(gp, gpBairros, referenceSlugs, referenceLabels);

    const gaps: string[] = [];
    if (!catalog && (wh.gym_count > 0 || tp.gym_count > 0 || gp.gym_count > 0)) {
      gaps.push('sem_catalogo_oficial');
    }
    if (wh.gym_count === 0 && tp.gym_count === 0 && gp.gym_count === 0) {
      gaps.push('zero_gyms_todos_agregadores');
    }
    if (catalog && wh.coverage_pct !== null && wh.coverage_pct < 100) {
      gaps.push('wellhub_bairro_gap');
    }
    if (catalog && tp.coverage_pct !== null && tp.coverage_pct < 100 && tp.gym_count > 0) {
      gaps.push('totalpass_distrito_ausente');
    }
    if (wh.parseable_pct !== null && wh.parseable_pct < 90) gaps.push('wellhub_parse_baixo');
    if (tp.parseable_pct !== null && tp.parseable_pct < 90) gaps.push('totalpass_parse_baixo');
    if (gp.parseable_pct !== null && gp.parseable_pct < 90) gaps.push('gurupass_neighborhood_baixo');

    const prog = opts.whProgress?.[key];
    const planned = prog?.bairros_planned ?? null;
    const done = prog?.bairros_done ?? null;

    const populacao =
      typeof mun.populacao === 'number' && Number.isFinite(mun.populacao)
        ? mun.populacao
        : null;
    const tier = classifyMunicipioTier(populacao);

    rows.push({
      municipio_key: key,
      cidade: mun.nome,
      uf: mun.uf,
      ibge: mun.ibge ?? null,
      populacao,
      tier,
      reference_source: referenceSource,
      reference_bairro_count: referenceCount,
      catalog_file: catalog ? catalogFileName(mun.nome, mun.uf) : null,
      receita_bairro_count: receitaSet?.size ?? 0,
      wellhub: wh,
      totalpass: tp,
      gurupass: gp,
      union_bairros_discovered: union.size,
      wh_scrape_bairros_planned: planned,
      wh_scrape_bairros_done: done,
      wh_scrape_completion_pct:
        planned && done != null && planned > 0 ? pct(done, planned) : null,
      gaps,
    });
  }

  return rows.sort((a, b) => {
    const ga = a.gaps.length;
    const gb = b.gaps.length;
    if (gb !== ga) return gb - ga;
    return b.wellhub.gym_count + b.totalpass.gym_count + b.gurupass.gym_count -
      (a.wellhub.gym_count + a.totalpass.gym_count + a.gurupass.gym_count);
  });
}

export function buildMissingBairrosT3Plus(
  rows: MunicipioCoverageRow[],
): MissingBairrosT3PlusEntry[] {
  return rows
    .filter(
      (r) =>
        isTierAtLeast(r.tier, 'T3') &&
        r.totalpass.gym_count > 0 &&
        r.reference_bairro_count > 0,
    )
    .map((r) => ({
      municipio_key: r.municipio_key,
      cidade: r.cidade,
      uf: r.uf,
      tier: r.tier!,
      populacao: r.populacao,
      reference_source: r.reference_source,
      reference_bairro_count: r.reference_bairro_count,
      tp_gym_count: r.totalpass.gym_count,
      tp_parseable_pct: r.totalpass.parseable_pct,
      tp_coverage_pct: r.totalpass.coverage_pct,
      tp_cep_hit_count: r.totalpass.cep_hit_count ?? 0,
      tp_index_hit_count: r.totalpass.index_hit_count ?? 0,
      missing_bairros: r.totalpass.missing_bairros,
    }))
    .sort((a, b) => {
      const ma = a.missing_bairros.length;
      const mb = b.missing_bairros.length;
      if (mb !== ma) return mb - ma;
      return (b.populacao ?? 0) - (a.populacao ?? 0);
    });
}

export function summarizeReport(
  rows: MunicipioCoverageRow[],
  filterUf: string | null,
  tpIndexStats?: TpIndexAuditStats | null,
): BairroCoverageAuditReport {
  const avg = (vals: (number | null)[]) => {
    const ok = vals.filter((v): v is number => v != null);
    if (!ok.length) return null;
    return Math.round((ok.reduce((a, b) => a + b, 0) / ok.length) * 10) / 10;
  };

  const t3plus = rows.filter((r) => isTierAtLeast(r.tier, 'T3'));
  const missingT3 = buildMissingBairrosT3Plus(rows);

  const tpWithGyms = rows.filter((r) => r.totalpass.gym_count > 0);
  const tpGymTotal = tpWithGyms.reduce((s, r) => s + r.totalpass.gym_count, 0);
  const tpParseableTotal = tpWithGyms.reduce((s, r) => s + r.totalpass.parseable_count, 0);

  const honesty_notes = [
    'cov% = bairros da referência (catálogo/Receita) com ≥1 gym do agregador — NÃO é % de gyms com CEP.',
    'Meta 100% cov vs universo oficial é irrealista sem CEP em todo gym TP e sem catálogo completo.',
    'TP pós-CEP: use parseable_pct / tp_parseable_pct_gym_weighted + tp_index.resolved_cep_pct (fonte CEP).',
    'avg_tp_coverage_pct é média municipal (não ponderada) — T3+ e index CEP são leituras melhores.',
    `Tiers: ${MUNICIPIO_TIER_DEFINITION}`,
  ];

  return {
    version: '1',
    generated_at: new Date().toISOString(),
    filter_uf: filterUf,
    baseline_2026_09_02: {
      avg_tp_coverage_pct: 35.6,
      note: 'Audit 2026-09-02 (index ~25800 resolved / 864 failed; Nominatim-heavy).',
    },
    summary: {
      municipios_audited: rows.length,
      municipios_with_catalog: rows.filter((r) => r.catalog_file).length,
      municipios_with_receita_ref: rows.filter((r) => r.receita_bairro_count > 0).length,
      municipios_t3_plus: t3plus.length,
      avg_wh_coverage_pct: avg(rows.map((r) => r.wellhub.coverage_pct)),
      avg_tp_coverage_pct: avg(rows.map((r) => r.totalpass.coverage_pct)),
      avg_tp_coverage_pct_t3_plus: avg(
        t3plus
          .filter((r) => r.totalpass.gym_count > 0)
          .map((r) => r.totalpass.coverage_pct),
      ),
      avg_tp_parseable_pct: avg(tpWithGyms.map((r) => r.totalpass.parseable_pct)),
      tp_parseable_pct_gym_weighted: pct(tpParseableTotal, tpGymTotal),
      avg_gp_coverage_pct: avg(rows.map((r) => r.gurupass.coverage_pct)),
      tp_index: tpIndexStats ?? null,
      honesty_notes,
      aggregator_failures: {
        wellhub: [
          'Catálogo oficial só em municípios piloto — resto usa SEED+heurística MAX 50 bairros',
          'Teto 100 resultados/URL — sub-grid não implementado',
          'Bairro só via parse endereço pós-scrape',
        ],
        totalpass: [
          'Scrape só lat/lng por município — zero tiling bairro',
          'Bairro canônico via CEP (CLA-22); Nominatim legado no index ainda presente',
          'Index: data/processed/tp-bairro-index.json — residual sem CEP = CLA-27',
          '100% cov vs Receita/catálogo exige CEP em todo gym + ref completa — não prometido',
          'Municípios sem lat/lng ignorados no scrape',
        ],
        gurupass: [
          'Scrape por citySlug — sem nível bairro',
          'neighborhood nativo mas cobertura varia',
          'Homônimos citySlug possíveis',
        ],
      },
    },
    plan_100pct_review: {
      wellhub: [
        '100% exige catálogo JSON por município-alvo (data/geo/bairros/{slug}-{uf}.json)',
        'Tiling exaustivo já suportado quando catálogo existe',
        'Falha conhecida: 100-cap Wellhub + aliases wellhub_slug',
        'Heurística sem catálogo NÃO garante 100% — cap MAX_BAIRROS=50',
      ],
      totalpass: [
        '100% bairro no TP exigiria API/search por bairro ou CEP em 100% dos gyms — não existe hoje',
        'F2 CEP canônico (ViaCEP/BrasilAPI + Receita) — Nominatim deprecated',
        'Métrica honesta: resolved_cep_pct no index + parseable_pct + cov% vs ref (esperado <<100)',
        'Residual failures (~sem CEP) = CLA-27 — não bloquear audit F3 em 100% CEP',
        'Re-audit: npm run audit:bairro-coverage após resolve:tp-bairros',
      ],
      gurupass: [
        'Melhor agregador para bairro (neighborhood nativo)',
        '100% vs universo oficial ainda precisa catálogo ou Receita como referência',
      ],
    },
    missing_bairros_t3_plus: missingT3,
    rows,
  };
}
