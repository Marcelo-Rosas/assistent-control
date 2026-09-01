/**
 * Normalização compartilhada Wellhub → AcademiaNormalizada (train + ingest).
 */
import { inferModalityFromName } from '../../supabase/functions/_shared/ragAnswer.ts';

export const MODALITY_MAP: Record<string, string> = {
  'muay thai': 'muay_thai',
  'jiu-jitsu': 'jiu_jitsu',
  'ju-jitsu': 'jiu_jitsu',
  boxe: 'boxe',
  pilates: 'pilates',
  'mat. pilates (solo)': 'pilates',
  'pilates funcional': 'pilates',
  musculação: 'musculacao',
  musculacao: 'musculacao',
  fitness: 'musculacao',
  'condicionamento físico': 'musculacao',
  crossfit: 'crossfit',
  'cross training': 'crossfit',
  yoga: 'yoga',
  'hatha yoga': 'yoga',
  'vinyasa yoga': 'yoga',
  dança: 'danca',
  danca: 'danca',
  'pole dance': 'pole_dance',
  natação: 'natacao',
  natacao: 'natacao',
  funcional: 'funcional',
  'treinamento funcional': 'funcional',
  massagem: 'massoterapia',
  fisioterapia: 'fisioterapia',
};

export const PLAN_MAP: Record<string, { nome: string; rank: number }> = {
  basic: { nome: 'Wellhub Basic', rank: 1 },
  'basic+': { nome: 'Wellhub Basic', rank: 1 },
  silver: { nome: 'Wellhub Silver', rank: 2 },
  'silver+': { nome: 'Wellhub Silver', rank: 2 },
  gold: { nome: 'Wellhub Gold', rank: 3 },
  'gold+': { nome: 'Wellhub Gold', rank: 3 },
  platinum: { nome: 'Wellhub Platinum', rank: 4 },
  diamond: { nome: 'Wellhub Diamond', rank: 5 },
  'diamond+': { nome: 'Wellhub Diamond', rank: 5 },
  digital: { nome: 'Wellhub Digital', rank: 1 },
};

export const PRIMARY_GYM_KEYS = new Set([
  'musculacao',
  'crossfit',
  'funcional',
  'natacao',
  'boxe',
  'muay_thai',
  'jiu_jitsu',
]);

export const SECONDARY_CLASS_KEYS = new Set(['pilates', 'yoga', 'danca', 'alongamento']);

export const REGION_BY_UF: Record<string, string> = {
  AC: 'N',
  AM: 'N',
  AP: 'N',
  PA: 'N',
  RO: 'N',
  RR: 'N',
  TO: 'N',
  AL: 'NE',
  BA: 'NE',
  CE: 'NE',
  MA: 'NE',
  PB: 'NE',
  PE: 'NE',
  PI: 'NE',
  RN: 'NE',
  SE: 'NE',
  DF: 'CO',
  GO: 'CO',
  MT: 'CO',
  MS: 'CO',
  ES: 'SE',
  MG: 'SE',
  RJ: 'SE',
  SP: 'SE',
  PR: 'S',
  RS: 'S',
  SC: 'S',
};

export type WellhubGym = {
  id: string;
  name: string;
  fullAddress?: string;
  location?: { lat?: number; lon?: number };
  activities?: string[];
  workHours?: string[];
  starterPlan?: { name?: string; formattedPrice?: string };
  exclusivity?: boolean;
  newPartner?: boolean;
  uf?: string;
  municipios_busca?: string[];
};

export type AcademiaNormalizada = {
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
};

export function fold(s: string): string {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function cidadeKey(cidade: string, uf: string): string {
  return `${fold(cidade)}|${uf.toUpperCase()}`;
}

function isSpecialtyStudio(gymName: string): boolean {
  const n = gymName.toLowerCase();
  if (/\bacademia\b/.test(n)) return false;
  return /\b(pilates|studio|yoga)\b/.test(n);
}

export function extractModalities(activities: string[], gymName: string): string[] {
  const fromName = inferModalityFromName(gymName);
  if (fromName) return [fromName];

  const mapped = (activities || [])
    .map((act) => MODALITY_MAP[String(act).toLowerCase().trim()])
    .filter(Boolean) as string[];
  let unique = [...new Set(mapped)];
  if (!unique.length) return ['academia_geral'];

  const hasPrimary = unique.some((m) => PRIMARY_GYM_KEYS.has(m));
  if (hasPrimary && !isSpecialtyStudio(gymName)) {
    unique = unique.filter((m) => !SECONDARY_CLASS_KEYS.has(m));
  }
  if (!unique.length) unique = ['musculacao'];
  return unique;
}

/** "..., São Paulo - SP, 01316-030, Brasil" ou "..., Poá, SP, 08567, Brasil" */
export function parseCityUfFromAddress(addr: string): { cidade: string; uf: string } | null {
  const s = String(addr || '');
  let last: { cidade: string; uf: string } | null = null;

  const dashRe = /,\s*([^,]+?)\s*-\s*([A-Z]{2})\s*,/g;
  let m: RegExpExecArray | null;
  while ((m = dashRe.exec(s)) !== null) {
    const cidade = m[1].trim();
    const uf = m[2].trim();
    if (cidade.length >= 2 && uf.length === 2 && !/^\d/.test(cidade)) {
      last = { cidade, uf };
    }
  }
  if (last) return last;

  const commaRe = /,\s*([^,]+?)\s*,\s*([A-Z]{2})\s*,/g;
  while ((m = commaRe.exec(s)) !== null) {
    const cidade = m[1].trim();
    const uf = m[2].trim();
    if (
      cidade.length >= 2 &&
      uf.length === 2 &&
      !/^\d/.test(cidade) &&
      !/\d{4,}/.test(cidade)
    ) {
      last = { cidade, uf };
    }
  }
  return last;
}

export function resolveCidade(gym: WellhubGym): { cidade: string; uf: string } {
  const fromAddr = parseCityUfFromAddress(gym.fullAddress || '');
  if (fromAddr) {
    return {
      cidade: fromAddr.cidade,
      uf: (fromAddr.uf || gym.uf || '').toUpperCase(),
    };
  }

  const fromMun = gym.municipios_busca?.find((x) => typeof x === 'string' && x.trim());
  if (fromMun) {
    return { cidade: fromMun.trim(), uf: (gym.uf || '').toUpperCase() };
  }

  return {
    cidade: gym.uf ? `Município (${gym.uf})` : 'Não especificado',
    uf: (gym.uf || '').toUpperCase(),
  };
}

export function normalizeWellhubGym(gym: WellhubGym): AcademiaNormalizada | null {
  if (!gym?.id || !gym?.name) return null;

  const { cidade, uf } = resolveCidade(gym);
  const modalidadesUnicas = extractModalities(gym.activities || [], gym.name);

  const planNameRaw = gym.starterPlan?.name?.toLowerCase().trim() || 'basic';
  const planInfo = PLAN_MAP[planNameRaw] || { nome: 'Wellhub Basic', rank: 1 };

  const warnings: string[] = [];
  if (gym.workHours && gym.workHours.length > 0) {
    warnings.push(`Horário: ${gym.workHours.join(', ')}`);
  }
  if (gym.exclusivity) warnings.push('Unidade Exclusiva Wellhub');
  if (gym.newPartner) warnings.push('Nova parceira');
  if (uf) warnings.unshift(`UF: ${uf}`);

  const lat = Number(gym.location?.lat);
  const lng = Number(gym.location?.lon);
  const hasCoords = Number.isFinite(lat) && Number.isFinite(lng);

  return {
    id_externo: gym.id,
    nome: gym.name,
    cidade,
    endereco: gym.fullAddress || 'Endereço não informado',
    plano_minimo: planInfo.nome,
    valor_plano_minimo: gym.starterPlan?.formattedPrice || 'N/A',
    warning_message: warnings.join(' | '),
    lat: hasCoords ? lat : 0,
    lng: hasCoords ? lng : 0,
    modalidades_extraidas: modalidadesUnicas.map((mod) => ({
      nome: mod,
      plano_minimo: planInfo.nome,
    })),
    enriquecimento_status: hasCoords ? 'success' : 'failed',
    source_aggregator: 'wellhub',
    uf: uf || undefined,
  };
}

export type TotalPassGymRaw = {
  id: string;
  attributes?: {
    name?: string;
    full_address?: string;
    uf?: string;
    location?: { lat?: number; lng?: number };
    municipios_busca?: string[];
    municipios_relacionados?: string[];
    accessible_from_company_plan?: { name?: string };
    warning_message?: string;
  };
};

export type MunCoord = { nome: string; uf: string; lat: number; lng: number };

function haversineKm(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6371;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLng = ((bLng - aLng) * Math.PI) / 180;
  const s1 = Math.sin(dLat / 2);
  const s2 = Math.sin(dLng / 2);
  const h =
    s1 * s1 +
    Math.cos((aLat * Math.PI) / 180) * Math.cos((bLat * Math.PI) / 180) * s2 * s2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Município IBGE mais próximo — evita usar 1º de municipios_busca (vizinho errado). */
export function nearestMunicipio(
  lat: number,
  lng: number,
  muns: MunCoord[],
  maxKm = 30,
): { cidade: string; uf: string } | null {
  let best: MunCoord | null = null;
  let bestD = Infinity;
  for (const m of muns) {
    if (!Number.isFinite(m.lat) || !Number.isFinite(m.lng)) continue;
    const d = haversineKm(lat, lng, m.lat, m.lng);
    if (d < bestD) {
      bestD = d;
      best = m;
    }
  }
  if (!best || bestD > maxKm) return null;
  return { cidade: best.nome, uf: best.uf };
}

export function resolveTpCidade(
  attrs: TotalPassGymRaw['attributes'],
  muns?: MunCoord[],
): { cidade: string; uf: string } {
  const uf = String(attrs?.uf || '').toUpperCase();

  const fromAddr = parseCityUfFromAddress(attrs?.full_address || '');
  if (fromAddr) {
    return { cidade: fromAddr.cidade, uf: uf || fromAddr.uf };
  }

  const lat = Number(attrs?.location?.lat);
  const lng = Number(attrs?.location?.lng);
  if (muns?.length && Number.isFinite(lat) && Number.isFinite(lng)) {
    const near = nearestMunicipio(lat, lng, muns);
    if (near) return near;
  }

  const buscaOnly = (attrs?.municipios_busca || []).filter(
    (x) => typeof x === 'string' && x.trim(),
  ) as string[];
  if (buscaOnly.length === 1) {
    return { cidade: buscaOnly[0].trim(), uf };
  }

  return { cidade: uf ? `Município (${uf})` : 'Não especificado', uf };
}

export function normalizeTotalPassGym(
  gym: TotalPassGymRaw,
  planoRank: Record<string, number>,
  muns?: MunCoord[],
): AcademiaNormalizada | null {
  const attrs = gym.attributes;
  if (!gym?.id || !attrs?.name) return null;

  const { cidade, uf } = resolveTpCidade(attrs, muns);
  const planName = String(attrs.accessible_from_company_plan?.name || 'TP 1').trim();
  const modalidades = extractModalities([], attrs.name);

  const lat = Number(attrs.location?.lat);
  const lng = Number(attrs.location?.lng);
  const hasCoords = Number.isFinite(lat) && Number.isFinite(lng);

  const warnings: string[] = [];
  if (attrs.warning_message) warnings.push(attrs.warning_message);
  if (uf) warnings.unshift(`UF: ${uf}`);

  return {
    id_externo: gym.id,
    nome: attrs.name,
    cidade,
    endereco: attrs.full_address || 'Endereço não informado',
    plano_minimo: planName,
    valor_plano_minimo: planoRank[planName] ? `rank ${planoRank[planName]}` : 'N/A',
    warning_message: warnings.join(' | '),
    lat: hasCoords ? lat : 0,
    lng: hasCoords ? lng : 0,
    modalidades_extraidas: modalidades.map((mod) => ({
      nome: mod,
      plano_minimo: planName,
    })),
    enriquecimento_status: hasCoords ? 'success' : 'failed',
    source_aggregator: 'totalpass',
    uf: uf || undefined,
  };
}
