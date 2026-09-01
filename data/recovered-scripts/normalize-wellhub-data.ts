/**
 * Normaliza Wellhub bruto → AcademiaNormalizada (schema do ingest-wellhub).
 *
 * Input (prioridade):
 *   1. INPUT_PATH env
 *   2. data/raw/wellhub-brasil-all.json  ({ data: Gym[] })
 *   3. data/raw/wellhub-raw.json         (array sample legado)
 *
 * Output: data/processed/wellhub-normalized.json
 *
 * Run: npm run normalize:wellhub
 *
 * Env: INPUT_PATH | OUTPUT_PATH | LIMIT
 */
import fs from 'fs/promises';
import path from 'path';
import { inferModalityFromName } from '../supabase/functions/_shared/ragAnswer.ts';

const MODALITY_MAP: Record<string, string> = {
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

const PLAN_MAP: Record<string, { nome: string; rank: number }> = {
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
  source_aggregator: 'wellhub';
  uf?: string;
};

const PRIMARY_GYM_KEYS = new Set([
  'musculacao',
  'crossfit',
  'funcional',
  'natacao',
  'boxe',
  'muay_thai',
  'jiu_jitsu',
]);
const SECONDARY_CLASS_KEYS = new Set(['pilates', 'yoga', 'danca', 'alongamento']);

const ROOT = process.cwd();
const DEFAULT_BR = path.join(ROOT, 'data/raw/wellhub-brasil-all.json');
const DEFAULT_LEGACY = path.join(ROOT, 'data/raw/wellhub-raw.json');
const OUTPUT_PATH =
  process.env.OUTPUT_PATH || path.join(ROOT, 'data/processed/wellhub-normalized.json');
const LIMIT = Number(process.env.LIMIT || 0);

function isSpecialtyStudio(gymName: string): boolean {
  const n = gymName.toLowerCase();
  if (/\bacademia\b/.test(n)) return false;
  return /\b(pilates|studio|yoga)\b/.test(n);
}

function extractModalities(activities: string[], gymName: string): string[] {
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

/** "..., São Paulo - SP, 01316-030, Brasil" → { cidade, uf } */
function parseCityUfFromAddress(addr: string): { cidade: string; uf: string } | null {
  const m = String(addr || '').match(/,\s*([^,]+?)\s*-\s*([A-Z]{2})\s*,/);
  if (!m) return null;
  const cidade = m[1].trim();
  const uf = m[2].trim();
  if (!cidade || cidade.length < 2) return null;
  return { cidade, uf };
}

function resolveCidade(gym: WellhubGym): { cidade: string; uf: string } {
  const fromMun = gym.municipios_busca?.find((x) => typeof x === 'string' && x.trim());
  if (fromMun) {
    return { cidade: fromMun.trim(), uf: (gym.uf || '').toUpperCase() };
  }

  const fromAddr = parseCityUfFromAddress(gym.fullAddress || '');
  if (fromAddr) {
    return {
      cidade: fromAddr.cidade,
      uf: (gym.uf || fromAddr.uf || '').toUpperCase(),
    };
  }

  return {
    cidade: gym.uf ? `Município (${gym.uf})` : 'Não especificado',
    uf: (gym.uf || '').toUpperCase(),
  };
}

function normalizeWellhubGym(gym: WellhubGym): AcademiaNormalizada | null {
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

async function resolveInputPath(): Promise<string> {
  if (process.env.INPUT_PATH) return process.env.INPUT_PATH;
  try {
    await fs.access(DEFAULT_BR);
    return DEFAULT_BR;
  } catch {
    return DEFAULT_LEGACY;
  }
}

function loadGyms(parsed: unknown): WellhubGym[] {
  if (Array.isArray(parsed)) return parsed as WellhubGym[];
  if (parsed && typeof parsed === 'object' && Array.isArray((parsed as { data?: unknown }).data)) {
    return (parsed as { data: WellhubGym[] }).data;
  }
  throw new Error('JSON inválido: esperado array ou { data: Gym[] }');
}

async function main(): Promise<void> {
  console.log('Normalizando Wellhub…\n');

  const inputPath = await resolveInputPath();
  console.log(`Input: ${inputPath}`);

  let rawText: string;
  try {
    rawText = await fs.readFile(inputPath, 'utf-8');
  } catch {
    console.error(`Arquivo ausente: ${inputPath}`);
    console.error('Rode: npm run scrape:wellhub-br');
    process.exit(1);
  }

  let gyms: WellhubGym[];
  try {
    gyms = loadGyms(JSON.parse(rawText));
  } catch (err) {
    console.error('Parse falhou:', err instanceof Error ? err.message : err);
    console.error('Primeiros 200 chars:', rawText.slice(0, 200));
    process.exit(1);
  }

  if (LIMIT > 0) {
    gyms = gyms.slice(0, LIMIT);
    console.log(`LIMIT=${LIMIT}`);
  }

  console.log(`Brutos: ${gyms.length}`);

  const normalized: AcademiaNormalizada[] = [];
  let skipped = 0;
  for (const g of gyms) {
    const row = normalizeWellhubGym(g);
    if (!row) {
      skipped += 1;
      continue;
    }
    normalized.push(row);
  }

  await fs.mkdir(path.dirname(OUTPUT_PATH), { recursive: true });
  await fs.writeFile(OUTPUT_PATH, JSON.stringify(normalized, null, 2), 'utf-8');

  const byUf = new Map<string, number>();
  for (const n of normalized) {
    const k = n.uf || '?';
    byUf.set(k, (byUf.get(k) || 0) + 1);
  }
  const ufTop = [...byUf.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);

  console.log(`Normalizados: ${normalized.length} (skipped=${skipped})`);
  console.log(`Output: ${OUTPUT_PATH}`);
  console.log(`UF top: ${ufTop.map(([u, c]) => `${u}=${c}`).join(', ')}`);
  console.log('\nExemplo:');
  console.log(JSON.stringify(normalized[0], null, 2));
  console.log('\nPróximo: npm run ingest:wellhub');
}

main().catch((err) => {
  console.error('Erro fatal:', err);
  process.exit(1);
});
