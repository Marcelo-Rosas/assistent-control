export type AggregatorBairroStats = {
  gym_count: number;
  bairros_with_gyms: number;
  bairros_distinct: string[];
  parseable_count: number;
  parseable_pct: number | null;
  coverage_pct: number | null;
  missing_bairros: string[];
  failures: string[];
  index_hit_count?: number;
  cep_hit_count?: number;
};

export type MunicipioTier = 'T1' | 'T2' | 'T3' | 'T4';

export type MunicipioCoverageRow = {
  municipio_key: string;
  cidade: string;
  uf: string;
  ibge: string | null;
  populacao?: number | null;
  tier?: MunicipioTier | null;
  reference_source: 'catalog' | 'receita' | 'derived_union' | 'none';
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
  resolved_pct: number | null;
  resolved_cep_pct: number | null;
};

export type MissingBairrosT3PlusEntry = {
  municipio_key: string;
  cidade: string;
  uf: string;
  tier: MunicipioTier;
  populacao: number | null;
  reference_source: MunicipioCoverageRow['reference_source'];
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
  baseline_2026_09_02?: {
    avg_tp_coverage_pct: number;
    note: string;
  };
  summary: {
    municipios_audited: number;
    municipios_with_catalog: number;
    municipios_with_receita_ref: number;
    municipios_t3_plus?: number;
    avg_wh_coverage_pct: number | null;
    avg_tp_coverage_pct: number | null;
    avg_tp_coverage_pct_t3_plus?: number | null;
    avg_tp_parseable_pct?: number | null;
    tp_parseable_pct_gym_weighted?: number | null;
    avg_gp_coverage_pct: number | null;
    tp_index?: TpIndexAuditStats | null;
    honesty_notes?: string[];
    aggregator_failures: Record<string, string[]>;
  };
  plan_100pct_review: {
    wellhub: string[];
    totalpass: string[];
    gurupass: string[];
  };
  missing_bairros_t3_plus?: MissingBairrosT3PlusEntry[];
  rows: MunicipioCoverageRow[];
};
