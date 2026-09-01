/**
 * Cruzamento de academias entre agregadores (geo + nome).
 */
import { fold, parseCityUfFromAddress } from './academia-normalize.ts';
import type { WellhubGymRaw } from '../scrape-wellhub-brasil.ts';

export type AggregatorId = 'wellhub' | 'totalpass' | 'gurupass';

export type OverlapGym = {
  aggregator: AggregatorId;
  id: string;
  name: string;
  lat: number;
  lng: number;
  cidade: string;
  uf: string;
  address: string;
};

export type MatchParams = {
  max_dist_m: number;
  min_name_score: number;
};

export type OverlapPair = {
  source: OverlapGym;
  target: OverlapGym;
  dist_m: number;
  name_score: number;
  match_score: number;
};

export type PairwiseOverlapReport = {
  source: AggregatorId;
  target: AggregatorId;
  pairs: number;
  source_overlap_pct: number | null;
  target_overlap_pct: number | null;
  source_exclusive: number;
  target_exclusive: number;
  avg_dist_m: number | null;
  matched_source_ids: string[];
  matched_target_ids: string[];
};

export type AggregatorOverlapReport = {
  version: '1';
  generated_at: string;
  filter: { cidade: string | null; uf: string | null };
  match_params: MatchParams;
  counts: Record<AggregatorId, number>;
  pairwise: {
    tp_wh: PairwiseOverlapReport;
    tp_gp: PairwiseOverlapReport;
    wh_gp: PairwiseOverlapReport;
  };
  triple: {
    tp_in_wh_and_gp: number;
    tp_in_wh_and_gp_pct: number | null;
    wh_in_tp_and_gp: number;
    wh_in_tp_and_gp_pct: number | null;
  };
  samples: {
    tp_wh: Array<{ tp: string; wh: string; dist_m: number; name_score: number }>;
    tp_gp: Array<{ tp: string; gp: string; dist_m: number; name_score: number }>;
    wh_gp: Array<{ wh: string; gp: string; dist_m: number; name_score: number }>;
    triple_tp: Array<{ tp: string; wh: string; gp: string }>;
  };
};

const DEFAULT_PARAMS: MatchParams = { max_dist_m: 150, min_name_score: 0.5 };
const GRID_CELL = 0.002;

function refName(value: string | { name?: string } | undefined): string {
  if (!value) return '';
  if (typeof value === 'string') return value.trim();
  return String(value.name ?? '').trim();
}

export function normGymName(name: string): string {
  return fold(name)
    .replace(/\b(academia|fitness|gym|studio|unidade|centro|club|cross|training|spa)\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function nameScore(a: string, b: string): number {
  const x = normGymName(a);
  const y = normGymName(b);
  if (!x || !y) return 0;
  if (x === y) return 1;
  if (x.includes(y) || y.includes(x)) return 0.85;
  const tx = new Set(x.split(' '));
  const ty = new Set(y.split(' '));
  let inter = 0;
  for (const t of tx) {
    if (ty.has(t) && t.length > 2) inter += 1;
  }
  return inter / Math.max(tx.size, ty.size, 1);
}

export function haversineM(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const R = 6371000;
  const toR = (x: number) => (x * Math.PI) / 180;
  const dLat = toR(b.lat - a.lat);
  const dLng = toR(b.lng - a.lng);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toR(a.lat)) * Math.cos(toR(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

function isMunicipioSaoPaulo(g: OverlapGym): boolean {
  if (fold(g.cidade) === 'sao paulo') return true;
  return /,\s*s[aã]o paulo\s*-\s*sp\b/i.test(g.address);
}

const UF_BY_STATE_NAME: Record<string, string> = {
  'sao paulo': 'SP',
  'rio de janeiro': 'RJ',
  'minas gerais': 'MG',
};

function resolveUf(stateRef: string): string {
  const s = fold(stateRef);
  if (stateRef.trim().length === 2) return stateRef.trim().toUpperCase();
  return UF_BY_STATE_NAME[s] || '';
}

export function wellhubToOverlap(g: WellhubGymRaw): OverlapGym | null {
  const lat = Number(g.location?.lat);
  const lng = Number(g.location?.lon);
  if (!g.id || !g.name || !Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const parsed = parseCityUfFromAddress(g.fullAddress || '');
  const spBusca = g.municipios_busca?.find((m) => /^s[aã]o paulo$/i.test(String(m).trim()));
  const cidade = parsed?.cidade || spBusca || g.municipios_busca?.[0] || '';
  const uf = (parsed?.uf || g.uf || '').toUpperCase();
  return {
    aggregator: 'wellhub',
    id: g.id,
    name: g.name,
    lat,
    lng,
    cidade,
    uf,
    address: g.fullAddress || '',
  };
}

export function totalpassToOverlap(g: {
  id?: string;
  attributes?: {
    name?: string;
    full_address?: string;
    uf?: string;
    location?: { lat?: number; lng?: number };
    municipios_busca?: string[];
    municipios_relacionados?: string[];
  };
}): OverlapGym | null {
  const a = g.attributes ?? {};
  const lat = Number(a.location?.lat);
  const lng = Number(a.location?.lng);
  if (!g.id || !a.name || !Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const busca = [...(a.municipios_busca ?? []), ...(a.municipios_relacionados ?? [])];
  const parsed = parseCityUfFromAddress(a.full_address || '');
  const spBusca = busca.find((m) => /^s[aã]o paulo$/i.test(String(m).trim()));
  const cidade = parsed?.cidade || spBusca || busca[0] || '';
  const uf = (parsed?.uf || a.uf || '').toUpperCase();
  return {
    aggregator: 'totalpass',
    id: g.id,
    name: a.name,
    lat,
    lng,
    cidade,
    uf,
    address: a.full_address || '',
  };
}

export function gurupassToOverlap(g: {
  gurupass_id?: string;
  id?: string;
  name?: string;
  fullAddress?: string;
  fullAddres?: string;
  street?: string;
  city?: string | { name?: string };
  state?: string | { name?: string };
  neighborhood?: string | { name?: string };
  latitude?: string | number;
  longitude?: string | number;
  municipios_busca?: string[];
}): OverlapGym | null {
  const id = g.gurupass_id || g.id;
  const lat = Number(g.latitude);
  const lng = Number(g.longitude);
  if (!id || !g.name || !Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const cidade = refName(g.city) || g.municipios_busca?.[0] || '';
  const uf = resolveUf(refName(g.state));
  const addr =
    g.fullAddress ||
    g.fullAddres ||
    [g.street, refName(g.neighborhood), cidade, uf].filter(Boolean).join(', ');
  const parsed = parseCityUfFromAddress(addr);
  return {
    aggregator: 'gurupass',
    id,
    name: g.name,
    lat,
    lng,
    cidade: parsed?.cidade || cidade,
    uf: parsed?.uf || uf,
    address: addr,
  };
}

export function filterOverlapGyms(
  gyms: OverlapGym[],
  filter: { cidade: string | null; uf: string | null },
): OverlapGym[] {
  if (!filter.cidade && !filter.uf) return gyms;
  return gyms.filter((g) => {
    if (filter.cidade) {
      if (fold(filter.cidade) === 'sao paulo') return isMunicipioSaoPaulo(g);
      const cidadeOk = fold(g.cidade) === fold(filter.cidade);
      const ufOk = !filter.uf || g.uf === filter.uf.toUpperCase();
      return cidadeOk && ufOk;
    }
    return !filter.uf || g.uf === filter.uf.toUpperCase();
  });
}

function buildGrid(gyms: OverlapGym[]): Map<string, OverlapGym[]> {
  const grid = new Map<string, OverlapGym[]>();
  for (const g of gyms) {
    const cx = Math.floor(g.lat / GRID_CELL);
    const cy = Math.floor(g.lng / GRID_CELL);
    for (let dx = -1; dx <= 1; dx += 1) {
      for (let dy = -1; dy <= 1; dy += 1) {
        const k = `${cx + dx},${cy + dy}`;
        if (!grid.has(k)) grid.set(k, []);
        grid.get(k)!.push(g);
      }
    }
  }
  return grid;
}

export function matchAggregatorLists(
  source: OverlapGym[],
  target: OverlapGym[],
  params: MatchParams = DEFAULT_PARAMS,
): OverlapPair[] {
  const grid = buildGrid(target);
  const pairs: OverlapPair[] = [];

  for (const s of source) {
    const cx = Math.floor(s.lat / GRID_CELL);
    const cy = Math.floor(s.lng / GRID_CELL);
    let best: OverlapPair | null = null;

    for (let dx = -1; dx <= 1; dx += 1) {
      for (let dy = -1; dy <= 1; dy += 1) {
        for (const t of grid.get(`${cx + dx},${cy + dy}`) ?? []) {
          const dist_m = haversineM(s, t);
          if (dist_m > params.max_dist_m) continue;
          const ns = nameScore(s.name, t.name);
          if (ns < params.min_name_score) continue;
          const match_score =
            ns * 0.7 + (1 - Math.min(dist_m, params.max_dist_m) / params.max_dist_m) * 0.3;
          const row: OverlapPair = { source: s, target: t, dist_m, name_score: ns, match_score };
          if (!best || row.match_score > best.match_score) best = row;
        }
      }
    }
    if (best) pairs.push(best);
  }

  return pairs;
}

function pairwiseReport(
  source: AggregatorId,
  target: AggregatorId,
  sourceGyms: OverlapGym[],
  targetGyms: OverlapGym[],
  pairs: OverlapPair[],
): PairwiseOverlapReport {
  const matchedSource = new Set(pairs.map((p) => p.source.id));
  const matchedTarget = new Set(pairs.map((p) => p.target.id));
  const avg =
    pairs.length > 0
      ? Math.round(pairs.reduce((a, p) => a + p.dist_m, 0) / pairs.length)
      : null;

  return {
    source,
    target,
    pairs: pairs.length,
    source_overlap_pct:
      sourceGyms.length > 0
        ? Math.round((pairs.length / sourceGyms.length) * 1000) / 10
        : null,
    target_overlap_pct:
      targetGyms.length > 0
        ? Math.round((pairs.length / targetGyms.length) * 1000) / 10
        : null,
    source_exclusive: sourceGyms.length - matchedSource.size,
    target_exclusive: targetGyms.length - matchedTarget.size,
    avg_dist_m: avg,
    matched_source_ids: [...matchedSource],
    matched_target_ids: [...matchedTarget],
  };
}

export function buildAggregatorOverlapReport(opts: {
  wellhub: OverlapGym[];
  totalpass: OverlapGym[];
  gurupass: OverlapGym[];
  filter: { cidade: string | null; uf: string | null };
  params?: MatchParams;
}): AggregatorOverlapReport {
  const params = opts.params ?? DEFAULT_PARAMS;
  const tpWhPairs = matchAggregatorLists(opts.totalpass, opts.wellhub, params);
  const tpGpPairs = matchAggregatorLists(opts.totalpass, opts.gurupass, params);
  const whGpPairs = matchAggregatorLists(opts.wellhub, opts.gurupass, params);

  const tpWhMap = new Map(tpWhPairs.map((p) => [p.source.id, p]));
  const tpGpMap = new Map(tpGpPairs.map((p) => [p.source.id, p]));
  const tripleTp = [...tpWhMap.keys()].filter((id) => tpGpMap.has(id));

  const whTpTargetIds = new Set(tpWhPairs.map((p) => p.target.id));
  const whGpByWh = new Map(whGpPairs.map((p) => [p.source.id, p]));
  const tripleWh = [...whTpTargetIds].filter((id) => whGpByWh.has(id));

  return {
    version: '1',
    generated_at: new Date().toISOString(),
    filter: opts.filter,
    match_params: params,
    counts: {
      wellhub: opts.wellhub.length,
      totalpass: opts.totalpass.length,
      gurupass: opts.gurupass.length,
    },
    pairwise: {
      tp_wh: pairwiseReport('totalpass', 'wellhub', opts.totalpass, opts.wellhub, tpWhPairs),
      tp_gp: pairwiseReport('totalpass', 'gurupass', opts.totalpass, opts.gurupass, tpGpPairs),
      wh_gp: pairwiseReport('wellhub', 'gurupass', opts.wellhub, opts.gurupass, whGpPairs),
    },
    triple: {
      tp_in_wh_and_gp: tripleTp.length,
      tp_in_wh_and_gp_pct:
        opts.totalpass.length > 0
          ? Math.round((tripleTp.length / opts.totalpass.length) * 1000) / 10
          : null,
      wh_in_tp_and_gp: tripleWh.length,
      wh_in_tp_and_gp_pct:
        opts.wellhub.length > 0
          ? Math.round((tripleWh.length / opts.wellhub.length) * 1000) / 10
          : null,
    },
    samples: {
      tp_wh: tpWhPairs.slice(0, 8).map((p) => ({
        tp: p.source.name,
        wh: p.target.name,
        dist_m: Math.round(p.dist_m),
        name_score: Math.round(p.name_score * 100) / 100,
      })),
      tp_gp: tpGpPairs.slice(0, 8).map((p) => ({
        tp: p.source.name,
        gp: p.target.name,
        dist_m: Math.round(p.dist_m),
        name_score: Math.round(p.name_score * 100) / 100,
      })),
      wh_gp: whGpPairs.slice(0, 8).map((p) => ({
        wh: p.source.name,
        gp: p.target.name,
        dist_m: Math.round(p.dist_m),
        name_score: Math.round(p.name_score * 100) / 100,
      })),
      triple_tp: tripleTp.slice(0, 8).map((id) => {
        const wh = tpWhMap.get(id)!;
        const gp = tpGpMap.get(id)!;
        return { tp: wh.source.name, wh: wh.target.name, gp: gp.target.name };
      }),
    },
  };
}
