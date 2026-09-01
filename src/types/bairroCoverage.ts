export type AggregatorBairroStats = {
  gym_count: number;
  bairros_with_gyms: number;
  bairros_distinct: string[];
  parseable_count: number;
  parseable_pct: number | null;
  coverage_pct: number | null;
  missing_bairros: string[];
  failures: string[];
};

export type MunicipioCoverageRow = {
  municipio_key: string;
  cidade: string;
  uf: string;
  ibge: string | null;
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

export type BairroCoverageAuditReport = {
  version: '1';
  generated_at: string;
  filter_uf: string | null;
  summary: {
    municipios_audited: number;
    municipios_with_catalog: number;
    municipios_with_receita_ref: number;
    avg_wh_coverage_pct: number | null;
    avg_tp_coverage_pct: number | null;
    avg_gp_coverage_pct: number | null;
    aggregator_failures: Record<string, string[]>;
  };
  plan_100pct_review: {
    wellhub: string[];
    totalpass: string[];
    gurupass: string[];
  };
  rows: MunicipioCoverageRow[];
};
