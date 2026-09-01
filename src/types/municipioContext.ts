/** Contexto de mercado municipal — renda, empresas (CEMPRE/RAIS proxy), Receita CNAE. */

export type PopBand = '50' | '100' | '200+';

export const POP_BAND_OPTIONS: PopBand[] = ['50', '100', '200+'];

export type MercadoMunicipio = {
  /** Censo 2022 — rendimento domiciliar per capita mediano (IBGE SIDRA 10295) */
  renda_pc_mediana: number | null;
  /** Censo 2022 — rendimento domiciliar per capita médio */
  renda_pc_media: number | null;
  /** GymSite municipio_pib quando disponível */
  pib_per_capita: number | null;
  /** CEMPRE 9509 — empresas e organizações atuantes (proxy base corporativa WH+TP) */
  empresas_atuantes: number | null;
  /** CEMPRE — unidades locais */
  unidades_locais: number | null;
  /** CEMPRE — pessoal ocupado total */
  pessoal_ocupado_total: number | null;
  /** CEMPRE — pessoal assalariado (proxy emprego formal / benefícios corporativos) */
  pessoal_assalariado: number | null;
  /** CEMPRE — salário médio mensal (R$) */
  salario_medio_mensal: number | null;
  /** Receita CNAE 9313100 — academias ativas (quando KPIs disponíveis) */
  academias_receita_ativos: number | null;
  /** pessoal_assalariado / pop */
  indice_formal: number | null;
  /** empresas_atuantes / pop × 1000 */
  empresas_por_mil: number | null;
  /**
   * Índice mercado corporativo (WH + TP): assalariados × (renda_pc/1000).
   * Proxy de massa salarial formal elegível a benefícios.
   */
  score_corporativo: number | null;
  fontes: string[];
};

export type MunicipioContextRecord = {
  ibge: string;
  cidade: string;
  uf: string;
  region: string;
  pop: number;
  lat: number | null;
  lng: number | null;
  mercado: MercadoMunicipio;
};

export type MunicipioContextFile = {
  version: '1';
  generated_at: string;
  pilot_uf: string | null;
  definition: string;
  sources: {
    ibge_cempre: string;
    ibge_renda: string;
    receita_cnae: string | null;
    gymsite_supabase: string | null;
  };
  stats: {
    n_municipios: number;
    n_with_renda: number;
    n_with_empresas: number;
    n_with_receita: number;
    n_with_gymsite_pib: number;
  };
  municipios: MunicipioContextRecord[];
};

export function popBand(pop: number): PopBand | null {
  if (pop <= 50_000) return '50';
  if (pop <= 100_000) return '100';
  if (pop >= 200_000) return '200+';
  return null;
}

export function matchesPopBand(pop: number, selected: PopBand[]): boolean {
  if (selected.length === 0) return true;
  return selected.some((p) => {
    if (p === '50') return pop <= 50_000;
    if (p === '100') return pop <= 100_000;
    return pop >= 200_000;
  });
}

export type RendaFilter = '1' | '2' | '3';

export const RENDA_FILTER_OPTIONS: RendaFilter[] = ['1', '2', '3'];

/** Faixas de renda domiciliar per capita mediana (R$) — chips só com numerais. */
export function rendaBand(rendaPc: number | null | undefined): RendaFilter | null {
  if (rendaPc == null || !Number.isFinite(rendaPc)) return null;
  if (rendaPc < 1_500) return '1';
  if (rendaPc < 2_500) return '2';
  return '3';
}

export function matchesRendaFilter(
  rendaPc: number | null | undefined,
  selected: RendaFilter[],
): boolean {
  if (selected.length === 0) return true;
  const band = rendaBand(rendaPc);
  if (!band) return false;
  return selected.includes(band);
}

export type CorporativoFilter = '1' | '2' | '3';

export const CORPORATIVO_FILTER_OPTIONS: CorporativoFilter[] = ['1', '2', '3'];

/** Faixas empresas_atuantes / 1000 hab — chips numéricos. */
export function corporativoBand(empresasPorMil: number | null | undefined): CorporativoFilter | null {
  if (empresasPorMil == null || !Number.isFinite(empresasPorMil)) return null;
  if (empresasPorMil < 40) return '1';
  if (empresasPorMil < 60) return '2';
  return '3';
}

export function matchesCorporativoFilter(
  empresasPorMil: number | null | undefined,
  selected: CorporativoFilter[],
): boolean {
  if (selected.length === 0) return true;
  const band = corporativoBand(empresasPorMil);
  if (!band) return false;
  return selected.includes(band);
}

export function computeMercadoIndices(
  pop: number,
  partial: Pick<
    MercadoMunicipio,
    'renda_pc_mediana' | 'empresas_atuantes' | 'pessoal_assalariado'
  >,
): Pick<MercadoMunicipio, 'indice_formal' | 'empresas_por_mil' | 'score_corporativo'> {
  const popSafe = pop > 0 ? pop : 0;
  const assalariado = partial.pessoal_assalariado;
  const empresas = partial.empresas_atuantes;
  const renda = partial.renda_pc_mediana;

  const indice_formal =
    popSafe > 0 && assalariado != null ? assalariado / popSafe : null;
  const empresas_por_mil =
    popSafe > 0 && empresas != null ? (empresas / popSafe) * 1000 : null;
  const score_corporativo =
    assalariado != null && renda != null && renda > 0
      ? assalariado * (renda / 1000)
      : null;

  return { indice_formal, empresas_por_mil, score_corporativo };
}
