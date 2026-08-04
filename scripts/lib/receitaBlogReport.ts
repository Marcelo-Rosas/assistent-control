import {
  parseRfDate,
  monthOf,
  normalizeBairro,
  type CnpjRow,
} from './receitaKpis.ts';

export type { CnpjRow };

const QUARTER_RE = /^\d{4}-Q[1-4]$/;
const DAYS_PER_YEAR = 365.25;

export type ReceitaBlogFicha = {
  generated_at: string;
  quarter: string;
  city_key: string;
  city_label: string;
  uf: string;
  ibge?: string;
  rankings: {
    mortalidade?: { rank: number; baixados: number };
    crescimento?: { rank: number; saldo: number };
  };
  movimento: {
    ativos: number;
    entrantes: number;
    baixados: number;
    saldo: number;
  };
  vida_baixados: {
    n: number;
    median_years: number | null;
    faixas: { lt_1y: number; y1_3: number; y3_5: number; y5_plus: number };
    faixas_pct: { lt_1y: number; y1_3: number; y3_5: number; y5_plus: number };
  };
  bairros_fechamento: Array<{
    bairro: string;
    n: number;
    median_years: number | null;
  }>;
  onda: {
    lookback_months: number;
    baixados_por_mes: Array<{ month: string; n: number }>;
  };
  gymsite: {
    status: 'ok' | 'indisponivel';
    pib?: {
      populacao: number;
      pib_reais: number;
      pib_per_capita: number;
      ano: number;
      fonte: string;
    };
    renda?: {
      n_bairros: number;
      renda_pc_mediana: number;
      top3: Array<{ bairro: string; renda_pc: number }>;
      fonte: string;
    };
    motivo?: string;
  };
  fontes: string[];
};

export type CityMovimento = {
  key: string;
  label: string;
  uf: string;
  ibge?: string;
  ativos: number;
  entrantes: number;
  baixados: number;
  saldo: number;
};

export type VidaStats = {
  n: number;
  median_years: number | null;
  faixas: { lt_1y: number; y1_3: number; y3_5: number; y5_plus: number };
  faixas_pct: { lt_1y: number; y1_3: number; y3_5: number; y5_plus: number };
};

export function parseQuarter(q: string): { year: number; q: number } {
  if (!QUARTER_RE.test(q)) {
    throw new Error(`Invalid quarter: ${q}`);
  }
  const [yearStr, qStr] = q.split('-Q');
  return { year: Number(yearStr), q: Number(qStr) };
}

export function monthsInQuarter(quarter: string): string[] {
  const { year, q } = parseQuarter(quarter);
  const startMonth = (q - 1) * 3 + 1;
  return [0, 1, 2].map((offset) => {
    const month = startMonth + offset;
    return `${year}-${String(month).padStart(2, '0')}`;
  });
}

function daysBetween(isoStart: string, isoEnd: string): number {
  const [y1, m1, d1] = isoStart.split('-').map(Number);
  const [y2, m2, d2] = isoEnd.split('-').map(Number);
  const t1 = Date.UTC(y1, m1 - 1, d1);
  const t2 = Date.UTC(y2, m2 - 1, d2);
  return Math.round((t2 - t1) / 86_400_000);
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1]! + sorted[mid]!) / 2;
  }
  return sorted[mid]!;
}

function yearsFromDays(days: number): number {
  return days / DAYS_PER_YEAR;
}

function bucketYears(years: number): keyof VidaStats['faixas'] {
  if (years < 1) return 'lt_1y';
  if (years < 3) return 'y1_3';
  if (years < 5) return 'y3_5';
  return 'y5_plus';
}

export function lifeDays(inicioRaw: string, baixaRaw: string): number | null {
  const inicio = parseRfDate(inicioRaw);
  const baixa = parseRfDate(baixaRaw);
  if (inicio === null || baixa === null) return null;
  const days = daysBetween(inicio, baixa);
  if (days < 0) return null;
  return days;
}

export function buildVidaStats(lifeDaysList: number[]): VidaStats {
  const faixas = { lt_1y: 0, y1_3: 0, y3_5: 0, y5_plus: 0 };
  for (const days of lifeDaysList) {
    faixas[bucketYears(yearsFromDays(days))] += 1;
  }

  const n = lifeDaysList.length;
  const medDays = median(lifeDaysList);
  const median_years = medDays === null ? null : yearsFromDays(medDays);

  const faixas_pct = { lt_1y: 0, y1_3: 0, y3_5: 0, y5_plus: 0 };
  if (n > 0) {
    for (const key of Object.keys(faixas) as Array<keyof typeof faixas>) {
      faixas_pct[key] = (faixas[key] / n) * 100;
    }
  }

  return { n, median_years, faixas, faixas_pct };
}

function sortMortalidade(a: CityMovimento, b: CityMovimento): number {
  if (b.baixados !== a.baixados) return b.baixados - a.baixados;
  if (b.entrantes !== a.entrantes) return b.entrantes - a.entrantes;
  return a.key.localeCompare(b.key);
}

function sortCrescimento(a: CityMovimento, b: CityMovimento): number {
  if (b.saldo !== a.saldo) return b.saldo - a.saldo;
  if (b.entrantes !== a.entrantes) return b.entrantes - a.entrantes;
  return a.key.localeCompare(b.key);
}

export function rankTopN(
  cities: CityMovimento[],
  n: number,
): { mortalidade: CityMovimento[]; crescimento: CityMovimento[] } {
  const mortalidade = [...cities].sort(sortMortalidade).slice(0, n);
  const crescimento = [...cities].sort(sortCrescimento).slice(0, n);
  return { mortalidade, crescimento };
}

export function mergeRankedCities(
  mort: CityMovimento[],
  cresc: CityMovimento[],
): Array<CityMovimento & { rankings: ReceitaBlogFicha['rankings'] }> {
  const byKey = new Map<
    string,
    CityMovimento & { rankings: ReceitaBlogFicha['rankings'] }
  >();

  for (const [idx, city] of mort.entries()) {
    byKey.set(city.key, {
      ...city,
      rankings: {
        mortalidade: { rank: idx + 1, baixados: city.baixados },
      },
    });
  }

  for (const [idx, city] of cresc.entries()) {
    const existing = byKey.get(city.key);
    const crescimento = { rank: idx + 1, saldo: city.saldo };
    if (existing) {
      existing.rankings.crescimento = crescimento;
    } else {
      byKey.set(city.key, { ...city, rankings: { crescimento } });
    }
  }

  return [...byKey.values()].sort((a, b) => a.key.localeCompare(b.key));
}

function monthsLookback(endMonth: string, lookback: number): string[] {
  const [year, monthStr] = endMonth.split('-');
  let y = Number(year);
  let m = Number(monthStr);
  const months: string[] = [];

  for (let i = lookback - 1; i >= 0; i -= 1) {
    let month = m - i;
    let yearAdj = y;
    while (month <= 0) {
      month += 12;
      yearAdj -= 1;
    }
    months.push(`${yearAdj}-${String(month).padStart(2, '0')}`);
  }

  return months;
}

export function buildOnda(
  baixadosRows: CnpjRow[],
  cityKey: string,
  endMonth: string,
  lookback: number,
  resolveKey: (row: CnpjRow) => string,
): ReceitaBlogFicha['onda'] {
  const months = monthsLookback(endMonth, lookback);
  const counts = new Map<string, number>(months.map((month) => [month, 0]));

  for (const row of baixadosRows) {
    if (resolveKey(row) !== cityKey) continue;
    const iso = parseRfDate(row.data_situacao_cadastral);
    if (iso === null) continue;
    const month = monthOf(iso);
    if (counts.has(month)) {
      counts.set(month, (counts.get(month) ?? 0) + 1);
    }
  }

  return {
    lookback_months: lookback,
    baixados_por_mes: months.map((month) => ({
      month,
      n: counts.get(month) ?? 0,
    })),
  };
}

function bairroLabel(raw: string): string {
  const trimmed = String(raw ?? '').trim();
  return trimmed || '(sem bairro)';
}

export function buildBairrosFechamento(
  baixadosInQuarter: CnpjRow[],
  cityKey: string,
  resolveKey: (row: CnpjRow) => string,
  minN = 2,
): ReceitaBlogFicha['bairros_fechamento'] {
  const groups = new Map<string, { label: string; lifeDays: number[] }>();

  for (const row of baixadosInQuarter) {
    if (resolveKey(row) !== cityKey) continue;
    const days = lifeDays(row.data_inicio_atividade, row.data_situacao_cadastral);
    if (days === null) continue;

    const key = normalizeBairro(row.bairro);
    let group = groups.get(key);
    if (!group) {
      group = { label: bairroLabel(row.bairro), lifeDays: [] };
      groups.set(key, group);
    }
    group.lifeDays.push(days);
  }

  return [...groups.values()]
    .filter((g) => g.lifeDays.length >= minN)
    .map((g) => {
      const medDays = median(g.lifeDays);
      return {
        bairro: g.label,
        n: g.lifeDays.length,
        median_years: medDays === null ? null : yearsFromDays(medDays),
      };
    })
    .sort((a, b) => b.n - a.n || a.bairro.localeCompare(b.bairro));
}

export type BuildFichaBaseParams = {
  quarter: string;
  city: CityMovimento;
  rankings: ReceitaBlogFicha['rankings'];
  vidaBaixados: VidaStats;
  bairrosFechamento: ReceitaBlogFicha['bairros_fechamento'];
  onda: ReceitaBlogFicha['onda'];
  fontes?: string[];
  generatedAt?: string;
};

export function buildFichaBase(params: BuildFichaBaseParams): ReceitaBlogFicha {
  const {
    quarter,
    city,
    rankings,
    vidaBaixados,
    bairrosFechamento,
    onda,
    fontes = [],
    generatedAt = new Date().toISOString(),
  } = params;

  return {
    generated_at: generatedAt,
    quarter,
    city_key: city.key,
    city_label: city.label,
    uf: city.uf,
    ...(city.ibge ? { ibge: city.ibge } : {}),
    rankings,
    movimento: {
      ativos: city.ativos,
      entrantes: city.entrantes,
      baixados: city.baixados,
      saldo: city.saldo,
    },
    vida_baixados: vidaBaixados,
    bairros_fechamento: bairrosFechamento,
    onda,
    gymsite: { status: 'indisponivel', motivo: 'pending_enrich' },
    fontes,
  };
}
