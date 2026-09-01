import type { CidadeTrainRecord } from '../types/academiaTrain';
import { N_CLASSES, N_FEATURES, normalizePattern, patternToIndex } from '../types/academiaTrain';

const CAPS = {
  pop: 1_200_000,
  gymCount: 80,
  whPlanMax: 5,
  tpPlanMax: 10,
  score: 2_000_000,
  rendaPc: 5_000,
  empresasPorMil: 120,
  scoreCorporativo: 500_000,
};

export function normLog(x: number, cap: number): number {
  if (x <= 0) return 0;
  return Math.min(1, Math.log1p(x) / Math.log1p(cap));
}

export function cityFeatures(c: CidadeTrainRecord): number[] {
  const total = c.wellhub.count + c.totalpass.count;
  const marketshare_wh = total > 0 ? c.wellhub.count / total : 0;
  const marketshare_tp = total > 0 ? c.totalpass.count / total : 0;
  const primaryRatio =
    total > 0
      ? (c.modality_profile.filter((m) =>
          ['musculacao', 'crossfit', 'funcional', 'natacao', 'boxe', 'muay_thai', 'jiu_jitsu'].includes(m),
        ).length /
          Math.max(1, c.modality_profile.length))
      : 0;

  const m = c.mercado;

  return [
    normLog(c.pop, CAPS.pop),
    normLog(c.wellhub.count, CAPS.gymCount),
    normLog(c.totalpass.count, CAPS.gymCount),
    marketshare_wh,
    marketshare_tp,
    c.wellhub.plan_rank_mean / CAPS.whPlanMax,
    c.totalpass.plan_rank_mean / CAPS.tpPlanMax,
    c.gap_agg / 2,
    normLog(c.score, CAPS.score),
    primaryRatio,
    normLog(m.renda_pc_mediana ?? 0, CAPS.rendaPc),
    normLog(m.empresas_por_mil ?? 0, CAPS.empresasPorMil),
    normLog(m.score_corporativo ?? 0, CAPS.scoreCorporativo),
  ];
}

function shuffleInPlace<T>(arr: T[]): void {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

/** Split estratificado por pattern — evita val só WH+TP quando cidades estão ordenadas por score. */
export function stratifiedCitySplit(
  cidades: CidadeTrainRecord[],
  valFraction = 0.2,
): { train: CidadeTrainRecord[]; val: CidadeTrainRecord[] } {
  const byPattern = new Map<string, CidadeTrainRecord[]>();
  for (const c of cidades) {
    const key = normalizePattern(c.pattern);
    const bucket = byPattern.get(key) ?? [];
    bucket.push(c);
    byPattern.set(key, bucket);
  }

  const train: CidadeTrainRecord[] = [];
  const val: CidadeTrainRecord[] = [];

  for (const group of byPattern.values()) {
    shuffleInPlace(group);
    if (group.length === 1) {
      train.push(group[0]);
      continue;
    }
    const nVal = Math.max(1, Math.round(group.length * valFraction));
    val.push(...group.slice(0, nVal));
    train.push(...group.slice(nVal));
  }

  shuffleInPlace(train);
  return { train, val };
}

export function buildCityTensors(cidades: CidadeTrainRecord[]) {
  const n = cidades.length;
  const xs = new Float32Array(n * N_FEATURES);
  const ys = new Float32Array(n * N_CLASSES);

  for (let i = 0; i < n; i++) {
    const feat = cityFeatures(cidades[i]);
    for (let j = 0; j < N_FEATURES; j++) {
      xs[i * N_FEATURES + j] = Math.max(0, feat[j]);
    }
    const label = patternToIndex(cidades[i].pattern);
    ys[i * N_CLASSES + label] = 1;
  }

  return { xs, ys, n };
}

export function buildCityTensorsStratified(cidades: CidadeTrainRecord[], valFraction = 0.2) {
  const { train, val } = stratifiedCitySplit(cidades, valFraction);
  const trainT = buildCityTensors(train);
  const valT = buildCityTensors(val);
  return {
    xs: trainT.xs,
    ys: trainT.ys,
    n: trainT.n,
    xsVal: valT.xs,
    ysVal: valT.ys,
    nVal: valT.n,
  };
}

export function scatterPopVsPlan(cidades: CidadeTrainRecord[]) {
  return cidades
    .filter((c) => c.wellhub.count + c.totalpass.count > 0)
    .map((c) => ({
      x: normLog(c.pop, CAPS.pop),
      y: (c.wellhub.plan_rank_mean + c.totalpass.plan_rank_mean) / 2 / CAPS.tpPlanMax,
      label: c.cidade,
      pattern: c.pattern,
    }));
}

export function modalityHistogram(cidades: CidadeTrainRecord[]) {
  const h: Record<string, number> = {};
  for (const c of cidades) {
    for (const [mod, n] of Object.entries(c.wellhub.modality_histogram)) {
      h[mod] = (h[mod] || 0) + n;
    }
    for (const [mod, n] of Object.entries(c.totalpass.modality_histogram)) {
      h[mod] = (h[mod] || 0) + n;
    }
  }
  return Object.entries(h).map(([label, value]) => ({ label, value }));
}
