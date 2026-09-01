/** Types for academia.train.json (fase 1 SP WH+TP). */

import type { MercadoMunicipio } from './municipioContext';

export type AggBucket = {
  count: number;
  plan_histogram: Record<string, number>;
  modality_histogram: Record<string, number>;
  plan_rank_mean: number;
  plan_rank_max: number;
};

export type AcademiaTrainRecord = {
  id_externo: string;
  nome: string;
  cidade: string;
  endereco: string;
  plano_minimo: string;
  valor_plano_minimo: string;
  warning_message: string;
  lat: number;
  lng: number;
  modalidades_extraidas: { nome: string; plano_minimo: string }[];
  enriquecimento_status: 'success' | 'failed';
  source_aggregator: 'wellhub' | 'totalpass' | 'gurupass';
  uf?: string;
  plano_minimo_rank: number;
  modalidades: string[];
  modality_primary: boolean;
  has_coords: boolean;
  cidade_key: string;
};

export type CidadeTrainRecord = {
  ibge: string;
  cidade: string;
  uf: string;
  region: string;
  pop: number;
  /** Renda, empresas CEMPRE/RAIS proxy, Receita CNAE — WH + TP */
  mercado: MercadoMunicipio;
  wellhub: AggBucket;
  totalpass: AggBucket;
  gurupass?: AggBucket;
  aggregators_present: number;
  gap_agg: number;
  pattern: string;
  score: number;
  modality_profile: string[];
  plan_profile_wh: string | null;
  plan_profile_tp: string | null;
  plan_profile_gp?: string | null;
  /** Plano mais frequente no agregador presente no município */
  plano_dominante: string | null;
  agregador_presente: 'wellhub' | 'totalpass' | 'gurupass' | null;
  /** Modalidades das academias no plano dominante local */
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
  /** O que o município já tem (WH / TP / DESERTO vazio) */
  plano_municipio: string | null;
  agregador_presente: 'wellhub' | 'totalpass' | null;
  modalidades_municipio: string[];
  /** Só o agregador faltante; espelho = cidade WH+TP com pop similar */
  sugestao_agregador: 'wellhub' | 'totalpass' | 'ambos' | null;
  sugestao_plano: string | null;
  sugestao_plano_wh: string | null;
  sugestao_plano_tp: string | null;
  sugestao_modalidades: string[];
  cidade_espelho: string | null;
  /** Legado — preenchido vazio; usar campos acima */
  suggested_entry?: {
    modalidades: string[];
    plano_wh_hint: string | null;
    plano_tp_hint: string | null;
  };
};

export type AcademiaTrainFile = {
  version: '1';
  generated_at: string;
  pilot_uf: string;
  definition: string;
  context_sources?: {
    municipio_context: string;
    ibge_cempre: string;
    ibge_renda: string;
  };
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
    n_academias_gp?: number;
    n_cidades: number;
    n_deserto: number;
    n_recomendacoes: number;
  };
  academias: AcademiaTrainRecord[];
  cidades: CidadeTrainRecord[];
  recomendacoes: RecomendacaoCidade[];
};

export const PATTERN_LABELS = ['DESERTO', 'WH', 'TP', 'WH+TP', 'outro'] as const;

export const PATTERN_FILTER_OPTIONS = ['DESERTO', 'WH', 'TP', 'WH+TP'] as const;

export type PatternLabel = (typeof PATTERN_LABELS)[number];

export function normalizePattern(pattern: string): PatternLabel {
  if (pattern === 'só_WH') return 'WH';
  if (pattern === 'só_TP') return 'TP';
  const i = PATTERN_LABELS.indexOf(pattern as PatternLabel);
  return i >= 0 ? (pattern as PatternLabel) : 'outro';
}

export function patternToIndex(pattern: string): number {
  const i = PATTERN_LABELS.indexOf(normalizePattern(pattern));
  return i >= 0 ? i : PATTERN_LABELS.length - 1;
}

export const N_FEATURES = 13;
export const N_CLASSES = PATTERN_LABELS.length;
