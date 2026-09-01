/**
 * Gera data/academia.train.json — fase 1 SP, Wellhub + TotalPass + GuruPass.
 *
 * Run: npm run train:academia:build
 */
import fs from 'fs';
import path from 'path';
import { PLANO_RANK } from '../src/lib/modalityClassifier.ts';
import {
  type MercadoMunicipio,
  type MunicipioContextFile,
} from '../src/types/municipioContext.ts';
import {
  REGION_BY_UF,
  cidadeKey,
  normalizeTotalPassGym,
  normalizeWellhubGym,
  parseCityUfFromAddress,
  PLAN_MAP,
  MODALITY_MAP,
  PRIMARY_GYM_KEYS,
  SECONDARY_CLASS_KEYS,
  type AcademiaNormalizada,
  type WellhubGym,
  type TotalPassGymRaw,
} from './lib/academia-normalize.ts';
import { normalizeGuruPassGym } from './normalize-gurupass-data.ts';
import type { GuruPassGymRaw } from './scrape-gurupass-brasil.ts';

const ROOT = process.cwd();
const PILOT_UF = 'SP';
const OUT_DATA = path.join(ROOT, 'data/academia.train.json');
const OUT_PUBLIC = path.join(ROOT, 'public/data/academia.train.json');
const CONTEXT_PATH = path.join(ROOT, 'data/municipio-context.json');
const GP_PATH = path.join(ROOT, 'data/raw/gurupass-brasil-all.json');

const STATE_TO_UF: Record<string, string> = {
  Acre: 'AC',
  Alagoas: 'AL',
  Amapá: 'AP',
  Amazonas: 'AM',
  Bahia: 'BA',
  Ceará: 'CE',
  'Distrito Federal': 'DF',
  'Espírito Santo': 'ES',
  Goiás: 'GO',
  Maranhão: 'MA',
  'Mato Grosso': 'MT',
  'Mato Grosso do Sul': 'MS',
  'Minas Gerais': 'MG',
  Pará: 'PA',
  Paraíba: 'PB',
  Paraná: 'PR',
  Pernambuco: 'PE',
  Piauí: 'PI',
  'Rio de Janeiro': 'RJ',
  'Rio Grande do Norte': 'RN',
  'Rio Grande do Sul': 'RS',
  Rondônia: 'RO',
  Roraima: 'RR',
  'Santa Catarina': 'SC',
  'São Paulo': 'SP',
  Sergipe: 'SE',
  Tocantins: 'TO',
};

function resolveGpUf(g: GuruPassGymRaw): string {
  const raw = String(g.uf || STATE_TO_UF[g.state || ''] || '').toUpperCase();
  return raw.length === 2 ? raw : '';
}

function resolveGpCidade(g: GuruPassGymRaw, endereco: string): string {
  const fromAddr = parseCityUfFromAddress(endereco);
  if (fromAddr?.cidade) return fromAddr.cidade;
  const fromCity = String(g.city || '').trim();
  if (fromCity) return fromCity;
  const fromBusca = g.municipios_busca?.find((x) => typeof x === 'string' && x.trim());
  return fromBusca?.trim() || 'N/D';
}

function emptyMercado(): MercadoMunicipio {
  return {
    renda_pc_mediana: null,
    renda_pc_media: null,
    pib_per_capita: null,
    empresas_atuantes: null,
    unidades_locais: null,
    pessoal_ocupado_total: null,
    pessoal_assalariado: null,
    salario_medio_mensal: null,
    academias_receita_ativos: null,
    indice_formal: null,
    empresas_por_mil: null,
    score_corporativo: null,
    fontes: [],
  };
}

function loadMercadoByIbge(): Map<string, MercadoMunicipio> {
  if (!fs.existsSync(CONTEXT_PATH)) {
    console.warn('Aviso: data/municipio-context.json ausente — rode npm run fetch:municipio-context');
    return new Map();
  }
  const file = JSON.parse(fs.readFileSync(CONTEXT_PATH, 'utf-8')) as MunicipioContextFile;
  return new Map(file.municipios.map((m) => [m.ibge, m.mercado]));
}


export type AcademiaTrainRecord = AcademiaNormalizada & {
  plano_minimo_rank: number;
  modalidades: string[];
  modality_primary: boolean;
  has_coords: boolean;
  cidade_key: string;
};

export type AggBucket = {
  count: number;
  plan_histogram: Record<string, number>;
  modality_histogram: Record<string, number>;
  plan_rank_mean: number;
  plan_rank_max: number;
};

export type CidadeTrainRecord = {
  ibge: string;
  cidade: string;
  uf: string;
  region: string;
  pop: number;
  mercado: MercadoMunicipio;
  wellhub: AggBucket;
  totalpass: AggBucket;
  gurupass: AggBucket;
  aggregators_present: number;
  gap_agg: number;
  pattern: string;
  score: number;
  modality_profile: string[];
  plan_profile_wh: string | null;
  plan_profile_tp: string | null;
  plan_profile_gp: string | null;
  plano_dominante: string | null;
  agregador_presente: 'wellhub' | 'totalpass' | 'gurupass' | null;
  modalidades_plano_dominante: string[];
};

export type RecomendacaoCidade = {
  ibge: string;
  cidade: string;
  uf: string;
  region: string;
  pop: number;
  mercado: MercadoMunicipio;
  score: number;
  pattern: string;
  motivo: string;
  prioridade: 'alta' | 'media' | 'baixa';
  plano_municipio: string | null;
  agregador_presente: 'wellhub' | 'totalpass' | null;
  modalidades_municipio: string[];
  sugestao_agregador: 'wellhub' | 'totalpass' | 'ambos' | null;
  sugestao_plano: string | null;
  sugestao_plano_wh: string | null;
  sugestao_plano_tp: string | null;
  sugestao_modalidades: string[];
  cidade_espelho: string | null;
};

export type AcademiaTrainFile = {
  version: '1';
  generated_at: string;
  pilot_uf: string;
  definition: string;
  taxonomy: {
    modality_map_wellhub: Record<string, string>;
    plan_map_wellhub: Record<string, { nome: string; rank: number }>;
    primary_gym_keys: string[];
    secondary_class_keys: string[];
    plano_rank_totalpass: Record<string, number>;
  };
  stats: {
    n_academias_wh: number;
    n_academias_tp: number;
    n_academias_gp: number;
    n_cidades: number;
    n_deserto: number;
    n_recomendacoes: number;
  };
  academias: AcademiaTrainRecord[];
  cidades: CidadeTrainRecord[];
  recomendacoes: RecomendacaoCidade[];
};

function emptyBucket(): AggBucket {
  return {
    count: 0,
    plan_histogram: {},
    modality_histogram: {},
    plan_rank_mean: 0,
    plan_rank_max: 0,
  };
}

function whPlanRank(plano: string): number {
  const key = plano.toLowerCase().replace('wellhub ', '').trim();
  return PLAN_MAP[key]?.rank ?? 1;
}

function tpPlanRank(plano: string): number {
  return PLANO_RANK[plano.trim()] ?? 0;
}

function gpPlanRank(): number {
  return 1;
}

function bumpHistogram(h: Record<string, number>, key: string): void {
  if (!key) return;
  h[key] = (h[key] || 0) + 1;
}

function topKeys(h: Record<string, number>, n = 5): string[] {
  return Object.entries(h)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([k]) => k);
}

function topKey(h: Record<string, number>): string | null {
  const t = topKeys(h, 1);
  return t[0] ?? null;
}

function enrichWh(row: AcademiaNormalizada): AcademiaTrainRecord {
  const modalidades = row.modalidades_extraidas.map((m) => m.nome);
  const rank = whPlanRank(row.plano_minimo);
  const lat = row.lat;
  const lng = row.lng;
  const hasCoords = Number.isFinite(lat) && Number.isFinite(lng) && lat !== 0 && lng !== 0;
  const uf = row.uf || PILOT_UF;
  return {
    ...row,
    plano_minimo_rank: rank,
    modalidades,
    modality_primary: modalidades.some((m) => PRIMARY_GYM_KEYS.has(m)),
    has_coords: hasCoords,
    cidade_key: cidadeKey(row.cidade, uf),
  };
}

function enrichGp(raw: GuruPassGymRaw): AcademiaTrainRecord | null {
  const normalized = normalizeGuruPassGym(raw);
  if (!normalized) return null;

  const uf = resolveGpUf(raw);
  if (uf !== PILOT_UF) return null;

  const cidade = resolveGpCidade(raw, normalized.endereco);
  const modalidades = normalized.modalidades_extraidas.map((m) => m.nome);
  const lat = normalized.lat;
  const lng = normalized.lng;
  const hasCoords = Number.isFinite(lat) && Number.isFinite(lng) && lat !== 0 && lng !== 0;

  return {
    id_externo: normalized.id_externo,
    nome: normalized.nome,
    cidade,
    endereco: normalized.endereco,
    plano_minimo: normalized.plano_minimo,
    valor_plano_minimo: normalized.valor_plano_minimo,
    warning_message: normalized.warning_message,
    lat,
    lng,
    modalidades_extraidas: normalized.modalidades_extraidas.map((m) => ({
      nome: m.nome,
      plano_minimo: m.plano_minimo,
    })),
    enriquecimento_status: hasCoords ? 'success' : normalized.enriquecimento_status,
    source_aggregator: 'gurupass',
    uf,
    plano_minimo_rank: gpPlanRank(),
    modalidades,
    modality_primary: modalidades.some((m) => PRIMARY_GYM_KEYS.has(m)),
    has_coords: hasCoords,
    cidade_key: cidadeKey(cidade, uf),
  };
}

function enrichTp(row: AcademiaNormalizada): AcademiaTrainRecord {
  const modalidades = row.modalidades_extraidas.map((m) => m.nome);
  const rank = tpPlanRank(row.plano_minimo);
  const lat = row.lat;
  const lng = row.lng;
  const hasCoords = Number.isFinite(lat) && Number.isFinite(lng) && lat !== 0 && lng !== 0;
  const uf = row.uf || PILOT_UF;
  return {
    ...row,
    plano_minimo_rank: rank,
    modalidades,
    modality_primary: modalidades.some((m) => PRIMARY_GYM_KEYS.has(m)),
    has_coords: hasCoords,
    cidade_key: cidadeKey(row.cidade, uf),
  };
}

function aggregateAcademias(
  academias: AcademiaTrainRecord[],
  agg: 'wellhub' | 'totalpass' | 'gurupass',
  buckets: Map<string, CidadeTrainRecord>,
): void {
  for (const a of academias) {
    if (a.source_aggregator !== agg) continue;
    const city = buckets.get(a.cidade_key);
    if (!city) continue;
    const bucket =
      agg === 'wellhub'
        ? city.wellhub
        : agg === 'totalpass'
          ? city.totalpass
          : city.gurupass;
    bucket.count += 1;
    bumpHistogram(bucket.plan_histogram, a.plano_minimo);
    for (const mod of a.modalidades) bumpHistogram(bucket.modality_histogram, mod);
  }

  for (const city of buckets.values()) {
    const bucket =
      agg === 'wellhub'
        ? city.wellhub
        : agg === 'totalpass'
          ? city.totalpass
          : city.gurupass;
    const subset = academias.filter(
      (a) => a.cidade_key === cidadeKey(city.cidade, city.uf) && a.source_aggregator === agg,
    );
    if (!subset.length) continue;
    const ranks = subset.map((a) => a.plano_minimo_rank).filter((r) => r > 0);
    bucket.plan_rank_mean = ranks.length ? ranks.reduce((s, r) => s + r, 0) / ranks.length : 0;
    bucket.plan_rank_max = ranks.length ? Math.max(...ranks) : 0;
  }
}

function resolvePattern(wh: number, tp: number, gp: number): string {
  if (wh === 0 && tp === 0 && gp === 0) return 'DESERTO';
  const parts: string[] = [];
  if (wh > 0) parts.push('WH');
  if (tp > 0) parts.push('TP');
  if (gp > 0) parts.push('GP');
  const joined = parts.join('+');
  if (joined === 'WH' || joined === 'TP' || joined === 'WH+TP') return joined;
  return joined || 'outro';
}

function prioridade(pattern: string, pop: number): RecomendacaoCidade['prioridade'] {
  if (pattern === 'DESERTO' && pop >= 50000) return 'alta';
  if (pattern === 'DESERTO' || pattern === 'WH' || pattern === 'TP') return 'media';
  return 'baixa';
}

function modalidadesNoPlano(
  academias: AcademiaTrainRecord[],
  cidadeKeyStr: string,
  agg: 'wellhub' | 'totalpass',
  plano: string,
  limit = 6,
): string[] {
  const hist: Record<string, number> = {};
  for (const a of academias) {
    if (a.cidade_key !== cidadeKeyStr || a.source_aggregator !== agg || a.plano_minimo !== plano) continue;
    for (const m of a.modalidades) bumpHistogram(hist, m);
  }
  return topKeys(hist, limit);
}

function computePresenteMunicipio(
  city: CidadeTrainRecord,
  academiasWh: AcademiaTrainRecord[],
  academiasTp: AcademiaTrainRecord[],
): Pick<CidadeTrainRecord, 'plano_dominante' | 'agregador_presente' | 'modalidades_plano_dominante'> {
  const key = cidadeKey(city.cidade, city.uf);
  if (city.pattern === 'WH' && city.plan_profile_wh) {
    const plano = city.plan_profile_wh;
    return {
      plano_dominante: plano,
      agregador_presente: 'wellhub',
      modalidades_plano_dominante: modalidadesNoPlano(academiasWh, key, 'wellhub', plano),
    };
  }
  if (city.pattern === 'TP' && city.plan_profile_tp) {
    const plano = city.plan_profile_tp;
    return {
      plano_dominante: plano,
      agregador_presente: 'totalpass',
      modalidades_plano_dominante: modalidadesNoPlano(academiasTp, key, 'totalpass', plano),
    };
  }
  if (city.pattern === 'WH+TP') {
    const useWh = city.wellhub.count >= city.totalpass.count;
    const agg = useWh ? 'wellhub' : 'totalpass';
    const plano = useWh ? city.plan_profile_wh : city.plan_profile_tp;
    if (!plano) return { plano_dominante: null, agregador_presente: null, modalidades_plano_dominante: [] };
    const list = useWh ? academiasWh : academiasTp;
    return {
      plano_dominante: plano,
      agregador_presente: agg,
      modalidades_plano_dominante: modalidadesNoPlano(list, key, agg, plano),
    };
  }
  return { plano_dominante: null, agregador_presente: null, modalidades_plano_dominante: [] };
}

function findSimilarCity(targetPop: number, covered: CidadeTrainRecord[]): CidadeTrainRecord | null {
  const logPop = Math.log1p(targetPop);
  let best: CidadeTrainRecord | null = null;
  let bestDist = Infinity;
  for (const c of covered) {
    if (c.pattern !== 'WH+TP') continue;
    const d = Math.abs(Math.log1p(c.pop) - logPop);
    if (d < bestDist) {
      bestDist = d;
      best = c;
    }
  }
  return best;
}

function buildSugestao(
  city: CidadeTrainRecord,
  mirror: CidadeTrainRecord | null,
  academiasWh: AcademiaTrainRecord[],
  academiasTp: AcademiaTrainRecord[],
): Pick<
  RecomendacaoCidade,
  | 'sugestao_agregador'
  | 'sugestao_plano'
  | 'sugestao_plano_wh'
  | 'sugestao_plano_tp'
  | 'sugestao_modalidades'
  | 'cidade_espelho'
> {
  const espelho = mirror?.cidade ?? null;
  const mirrorKey = mirror ? cidadeKey(mirror.cidade, mirror.uf) : '';

  if (city.pattern === 'WH') {
    const tpPlan = mirror?.plan_profile_tp ?? 'TP 4';
    const mods = mirror
      ? modalidadesNoPlano(academiasTp, mirrorKey, 'totalpass', tpPlan)
      : ['musculacao', 'funcional'];
    return {
      sugestao_agregador: 'totalpass',
      sugestao_plano: tpPlan,
      sugestao_plano_wh: null,
      sugestao_plano_tp: tpPlan,
      sugestao_modalidades: mods,
      cidade_espelho: espelho,
    };
  }

  if (city.pattern === 'TP') {
    const whPlan = mirror?.plan_profile_wh ?? 'Wellhub Silver';
    const mods = mirror
      ? modalidadesNoPlano(academiasWh, mirrorKey, 'wellhub', whPlan)
      : ['musculacao', 'funcional'];
    return {
      sugestao_agregador: 'wellhub',
      sugestao_plano: whPlan,
      sugestao_plano_wh: whPlan,
      sugestao_plano_tp: null,
      sugestao_modalidades: mods,
      cidade_espelho: espelho,
    };
  }

  if (city.pattern === 'DESERTO') {
    const whPlan = mirror?.plan_profile_wh ?? 'Wellhub Silver';
    const tpPlan = mirror?.plan_profile_tp ?? 'TP 4';
    const modsWh = mirror ? modalidadesNoPlano(academiasWh, mirrorKey, 'wellhub', whPlan) : [];
    const modsTp = mirror ? modalidadesNoPlano(academiasTp, mirrorKey, 'totalpass', tpPlan) : [];
    const mods = [...new Set([...modsWh, ...modsTp])].slice(0, 6);
    return {
      sugestao_agregador: 'ambos',
      sugestao_plano: null,
      sugestao_plano_wh: whPlan,
      sugestao_plano_tp: tpPlan,
      sugestao_modalidades: mods.length ? mods : ['musculacao', 'funcional'],
      cidade_espelho: espelho,
    };
  }

  return {
    sugestao_agregador: null,
    sugestao_plano: null,
    sugestao_plano_wh: null,
    sugestao_plano_tp: null,
    sugestao_modalidades: [],
    cidade_espelho: espelho,
  };
}

function main(): void {
  const munPath = path.join(ROOT, 'data/municipios-brasil.json');
  const whPath = path.join(ROOT, 'data/raw/wellhub-brasil-all.json');
  const tpPath = path.join(ROOT, 'data/raw/totalpass-brasil-all.json');
  const gpPath = GP_PATH;

  const munis = JSON.parse(fs.readFileSync(munPath, 'utf-8')) as Array<{
    nome: string;
    ibge: string;
    uf: string;
    populacao?: number;
  }>;

  const spMunis = munis.filter((m) => m.uf === PILOT_UF && (m.populacao || 0) > 0);
  const spMunCoords = spMunis.map((m) => ({
    nome: m.nome,
    uf: m.uf,
    lat: Number(m.lat),
    lng: Number(m.lng),
  }));
  const munByKey = new Map(spMunis.map((m) => [cidadeKey(m.nome, m.uf), m]));
  const mercadoByIbge = loadMercadoByIbge();
  const hasContext = mercadoByIbge.size > 0;

  const whRaw = JSON.parse(fs.readFileSync(whPath, 'utf-8')) as { data?: WellhubGym[] };
  const tpRaw = JSON.parse(fs.readFileSync(tpPath, 'utf-8')) as { data?: TotalPassGymRaw[] };
  const gpRaw = JSON.parse(fs.readFileSync(gpPath, 'utf-8')) as { data?: GuruPassGymRaw[] };

  const academiasWh: AcademiaTrainRecord[] = [];
  for (const g of whRaw.data || []) {
    const row = normalizeWellhubGym(g);
    if (!row || row.uf !== PILOT_UF) continue;
    const key = cidadeKey(row.cidade, PILOT_UF);
    if (!munByKey.has(key)) continue;
    academiasWh.push(enrichWh(row));
  }

  const academiasTp: AcademiaTrainRecord[] = [];
  for (const g of tpRaw.data || []) {
    const row = normalizeTotalPassGym(g, PLANO_RANK, spMunCoords);
    if (!row || row.uf !== PILOT_UF) continue;
    const key = cidadeKey(row.cidade, PILOT_UF);
    if (!munByKey.has(key)) continue;
    academiasTp.push(enrichTp(row));
  }

  const academiasGp: AcademiaTrainRecord[] = [];
  for (const g of gpRaw.data || []) {
    const row = enrichGp(g);
    if (!row) continue;
    const key = cidadeKey(row.cidade, PILOT_UF);
    if (!munByKey.has(key)) continue;
    academiasGp.push(row);
  }

  const academias = [...academiasWh, ...academiasTp, ...academiasGp];

  const cidadesMap = new Map<string, CidadeTrainRecord>();
  for (const m of spMunis) {
    const key = cidadeKey(m.nome, m.uf);
    const ibge = String(m.ibge).padStart(7, '0');
    const pop = m.populacao || 0;
    const mercado = mercadoByIbge.get(ibge) ?? emptyMercado();
    cidadesMap.set(key, {
      ibge,
      cidade: m.nome,
      uf: m.uf,
      region: REGION_BY_UF[m.uf] || '?',
      pop,
      mercado,
      wellhub: emptyBucket(),
      totalpass: emptyBucket(),
      gurupass: emptyBucket(),
      aggregators_present: 0,
      gap_agg: 3,
      pattern: 'DESERTO',
      score: 0,
      modality_profile: [],
      plan_profile_wh: null,
      plan_profile_tp: null,
      plan_profile_gp: null,
      plano_dominante: null,
      agregador_presente: null,
      modalidades_plano_dominante: [],
    });
  }

  aggregateAcademias(academiasWh, 'wellhub', cidadesMap);
  aggregateAcademias(academiasTp, 'totalpass', cidadesMap);
  aggregateAcademias(academiasGp, 'gurupass', cidadesMap);

  for (const city of cidadesMap.values()) {
    const whN = city.wellhub.count;
    const tpN = city.totalpass.count;
    const gpN = city.gurupass.count;
    const present = (whN > 0 ? 1 : 0) + (tpN > 0 ? 1 : 0) + (gpN > 0 ? 1 : 0);
    city.aggregators_present = present;
    city.gap_agg = 3 - present;
    city.pattern = resolvePattern(whN, tpN, gpN);
    city.score = city.pop * city.gap_agg;
    city.modality_profile = topKeys(
      {
        ...city.wellhub.modality_histogram,
        ...city.totalpass.modality_histogram,
        ...city.gurupass.modality_histogram,
      },
      6,
    );
    city.plan_profile_wh = topKey(city.wellhub.plan_histogram);
    city.plan_profile_tp = topKey(city.totalpass.plan_histogram);
    city.plan_profile_gp = topKey(city.gurupass.plan_histogram);
    const presente = computePresenteMunicipio(city, academiasWh, academiasTp);
    city.plano_dominante = presente.plano_dominante;
    city.agregador_presente = presente.agregador_presente;
    city.modalidades_plano_dominante = presente.modalidades_plano_dominante;
  }

  const cidades = [...cidadesMap.values()].sort((a, b) => b.score - a.score || b.pop - a.pop);
  const covered = cidades.filter((c) => c.wellhub.count > 0 && c.totalpass.count > 0);

  const recomendacoes: RecomendacaoCidade[] = cidades
    .filter((c) => c.gap_agg >= 1)
    .map((c) => {
      const mirror = findSimilarCity(c.pop, covered);
      const sugestao = buildSugestao(c, mirror, academiasWh, academiasTp);
      const motivo =
        c.pattern === 'DESERTO'
          ? `Sem Wellhub, TotalPass nem GuruPass; pop ${c.pop.toLocaleString('pt-BR')}`
          : c.pattern === 'WH'
            ? `Wellhub (${c.wellhub.count}); TotalPass/GuruPass ausentes`
            : c.pattern === 'TP'
              ? `TotalPass (${c.totalpass.count}); Wellhub/GuruPass ausentes`
              : c.gap_agg > 0
                ? `Gap parcial — ${c.pattern}; score ${c.score}`
                : `Cobertura completa (${c.pattern})`;
      return {
        ibge: c.ibge,
        cidade: c.cidade,
        uf: c.uf,
        region: c.region,
        pop: c.pop,
        mercado: c.mercado,
        score: c.score,
        pattern: c.pattern,
        motivo,
        prioridade: prioridade(c.pattern, c.pop),
        plano_municipio: c.plano_dominante,
        agregador_presente: c.agregador_presente,
        modalidades_municipio: c.modalidades_plano_dominante,
        ...sugestao,
      };
    });

  const out: AcademiaTrainFile = {
    version: '1',
    generated_at: new Date().toISOString(),
    pilot_uf: PILOT_UF,
    definition:
      'Fase 1 SP: WH+TP+GP. Cidade = endereço físico (não municipios_busca). DESERTO = 0 nos três. Mercado = renda+empresas IBGE + Receita.',
    ...(hasContext
      ? {
          context_sources: {
            municipio_context: 'data/municipio-context.json',
            ibge_cempre: 'SIDRA t/9509',
            ibge_renda: 'SIDRA t/10295',
          },
        }
      : {}),
    taxonomy: {
      modality_map_wellhub: MODALITY_MAP,
      plan_map_wellhub: PLAN_MAP,
      primary_gym_keys: [...PRIMARY_GYM_KEYS],
      secondary_class_keys: [...SECONDARY_CLASS_KEYS],
      plano_rank_totalpass: PLANO_RANK,
    },
    stats: {
      n_academias_wh: academiasWh.length,
      n_academias_tp: academiasTp.length,
      n_academias_gp: academiasGp.length,
      n_cidades: cidades.length,
      n_deserto: cidades.filter((c) => c.pattern === 'DESERTO').length,
      n_recomendacoes: recomendacoes.length,
    },
    academias,
    cidades,
    recomendacoes,
  };

  fs.mkdirSync(path.dirname(OUT_DATA), { recursive: true });
  fs.mkdirSync(path.dirname(OUT_PUBLIC), { recursive: true });
  const json = JSON.stringify(out, null, 2);
  fs.writeFileSync(OUT_DATA, json);
  fs.writeFileSync(OUT_PUBLIC, json);

  console.log(
    `SP academias WH=${academiasWh.length} TP=${academiasTp.length} GP=${academiasGp.length}`,
  );
  console.log(`Cidades SP=${cidades.length} DESERTO=${out.stats.n_deserto}`);
  console.log(`Salvo: ${OUT_DATA}`);
  console.log(`Salvo: ${OUT_PUBLIC}`);
}

main();
