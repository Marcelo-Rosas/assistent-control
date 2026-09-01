/**
 * Normaliza GuruPass bruto → AcademiaNormalizada (mesmo schema do Wellhub ingest).
 *
 * Input:  data/raw/gurupass-brasil-all.json  ({ data: GuruPassGymRaw[] })
 *         ou array puro / data/raw/gurupass-raw.json
 * Output: data/processed/gurupass-normalized.json
 *
 * Run: npm run normalize:gurupass
 */
import fs from 'fs/promises';
import path from 'path';
import type { GuruPassGymRaw, GuruPassProduct } from './scrape-gurupass-brasil';

export type AcademiaNormalizada = {
  id_externo: string;
  nome: string;
  cidade: string;
  bairro: string;
  endereco: string;
  plano_minimo: string;
  valor_plano_minimo: string;
  warning_message: string;
  lat: number;
  lng: number;
  modalidades_extraidas: { nome: string; plano_minimo: string; creditos_minimos?: number }[];
  enriquecimento_status: 'success' | 'failed';
  source_aggregator: 'gurupass';
  creditos_minimos: number | null;
};

/** product/modality label → chave canônica */
export const GURUPASS_MODALITY_MAP: Record<string, string> = {
  pilates: 'pilates',
  'aula de pilates': 'pilates',
  'pilates solo': 'pilates',
  'mat pilates': 'pilates',
  'pilates funcional': 'pilates',
  funcional: 'funcional',
  'treinamento funcional': 'funcional',
  'treino funcional': 'funcional',
  musculação: 'musculacao',
  musculacao: 'musculacao',
  'aula de musculação': 'musculacao',
  fitness: 'musculacao',
  'muay thai': 'muay_thai',
  'aula de muay thai': 'muay_thai',
  boxe: 'boxe',
  'aula de boxe': 'boxe',
  yoga: 'yoga',
  'hatha yoga': 'yoga',
  'vinyasa yoga': 'yoga',
  'aula de yoga': 'yoga',
  crossfit: 'crossfit',
  'cross fit': 'crossfit',
  'cross training': 'crossfit',
  'jiu-jitsu': 'jiu_jitsu',
  'jiu jitsu': 'jiu_jitsu',
  'ju-jitsu': 'jiu_jitsu',
  natação: 'natacao',
  natacao: 'natacao',
  hidroginástica: 'natacao',
  dança: 'danca',
  danca: 'danca',
  zumba: 'danca',
  'pole dance': 'pole_dance',
  massagem: 'massoterapia',
  massoterapia: 'massoterapia',
  fisioterapia: 'fisioterapia',
  meditação: 'yoga',
  alongamento: 'funcional',
  hiit: 'funcional',
  bike: 'funcional',
  spinning: 'funcional',
  'beach tennis': 'beach_tennis',
  'personal trainer': 'personal',
};

const PLANO = 'GuruPass Créditos';
const ROOT = process.cwd();
const INPUT_PATH =
  process.env.INPUT_PATH || path.join(ROOT, 'data/raw/gurupass-brasil-all.json');
const OUTPUT_PATH =
  process.env.OUTPUT_PATH || path.join(ROOT, 'data/processed/gurupass-normalized.json');

function mapModality(label: string): string | null {
  const key = String(label || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
  // try exact then includes
  if (GURUPASS_MODALITY_MAP[key]) return GURUPASS_MODALITY_MAP[key];
  const withAccents = String(label || '').toLowerCase().trim();
  if (GURUPASS_MODALITY_MAP[withAccents]) return GURUPASS_MODALITY_MAP[withAccents];

  for (const [k, v] of Object.entries(GURUPASS_MODALITY_MAP)) {
    const kNorm = k.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    if (key.includes(kNorm) || kNorm.includes(key)) return v;
  }
  return null;
}

function resolveAddress(g: GuruPassGymRaw): string {
  const a =
    (g.fullAddress || g.fullAddres || '').trim() ||
    [g.street, g.neighborhood, g.city, g.state].filter(Boolean).join(', ');
  return a || 'Endereço não informado';
}

function resolveCoords(g: GuruPassGymRaw): { lat: number; lng: number } {
  const coords = g.location?.coordinates;
  if (Array.isArray(coords) && coords.length >= 2) {
    const lng = Number(coords[0]);
    const lat = Number(coords[1]);
    if (Number.isFinite(lat) && Number.isFinite(lng)) return { lat, lng };
  }
  const lat = Number(g.latitude);
  const lng = Number(g.longitude);
  if (Number.isFinite(lat) && Number.isFinite(lng)) return { lat, lng };
  return { lat: 0, lng: 0 };
}

function minCredits(products: GuruPassProduct[] | undefined): number | null {
  if (!products?.length) return null;
  let min = Number.POSITIVE_INFINITY;
  for (const p of products) {
    const c = Number(p.final_cost_credits ?? p.cost_credits);
    if (Number.isFinite(c) && c >= 0 && c < min) min = c;
  }
  return Number.isFinite(min) ? min : null;
}

function collectLabels(g: GuruPassGymRaw): string[] {
  const labels: string[] = [];
  if (Array.isArray(g.modalities)) labels.push(...g.modalities);
  if (Array.isArray(g.tags)) labels.push(...g.tags);
  if (Array.isArray(g.products)) {
    for (const p of g.products) {
      if (p?.name) labels.push(p.name);
    }
  }
  return labels;
}

export function normalizeGuruPassGym(g: GuruPassGymRaw): AcademiaNormalizada | null {
  const id = g.gurupass_id || (g as { id?: string }).id;
  if (!id || typeof id !== 'string') return null;

  const labels = collectLabels(g);
  const mapped = labels
    .map((l) => mapModality(l))
    .filter((x): x is string => !!x);
  const unique = [...new Set(mapped)];

  const credits = minCredits(g.products);
  const fromLowest =
    typeof g.lowestPrice?.lowerPrice === 'number' ? g.lowestPrice.lowerPrice : null;
  const creditosMinimos = credits ?? fromLowest;

  const planoLabel = PLANO;
  const valor =
    creditosMinimos != null ? `A partir de ${creditosMinimos} créditos` : 'Créditos GuruPass';

  const warnings: string[] = [];
  if (g.neighborhood) warnings.push(`Bairro: ${g.neighborhood}`);
  if (creditosMinimos != null) warnings.push(`Mínimo ${creditosMinimos} créditos`);

  const { lat, lng } = resolveCoords(g);

  return {
    id_externo: id,
    nome: (g.name || '').trim() || 'Academia sem nome',
    cidade: (g.city || '').trim() || 'N/D',
    bairro: (g.neighborhood || '').trim() || '',
    endereco: resolveAddress(g),
    plano_minimo: planoLabel,
    valor_plano_minimo: valor,
    warning_message: warnings.join(' | '),
    lat,
    lng,
    modalidades_extraidas:
      unique.length > 0
        ? unique.map((nome) => ({
            nome,
            plano_minimo: planoLabel,
            creditos_minimos: creditosMinimos ?? undefined,
          }))
        : [
            {
              nome: 'academia_geral',
              plano_minimo: planoLabel,
              creditos_minimos: creditosMinimos ?? undefined,
            },
          ],
    enriquecimento_status: 'success',
    source_aggregator: 'gurupass',
    creditos_minimos: creditosMinimos,
  };
}

async function main(): Promise<void> {
  console.log('Normalizando GuruPass…\n');

  let raw: unknown;
  try {
    raw = JSON.parse(await fs.readFile(INPUT_PATH, 'utf-8'));
  } catch (err) {
    console.error(`Falha ao ler ${INPUT_PATH}:`, err instanceof Error ? err.message : err);
    console.error('Rode antes: npm run fetch:gurupass-br');
    process.exit(1);
  }

  let gyms: GuruPassGymRaw[];
  if (Array.isArray(raw)) {
    gyms = raw as GuruPassGymRaw[];
  } else if (raw && typeof raw === 'object' && Array.isArray((raw as { data?: unknown }).data)) {
    gyms = (raw as { data: GuruPassGymRaw[] }).data;
  } else {
    console.error('JSON inválido: esperado array ou { data: [] }');
    process.exit(1);
  }

  console.log(`Brutos: ${gyms.length}`);

  const out: AcademiaNormalizada[] = [];
  let skipped = 0;
  for (const g of gyms) {
    const n = normalizeGuruPassGym(g);
    if (!n) {
      skipped += 1;
      continue;
    }
    out.push(n);
  }

  await fs.mkdir(path.dirname(OUTPUT_PATH), { recursive: true });
  await fs.writeFile(OUTPUT_PATH, JSON.stringify(out, null, 2), 'utf-8');

  console.log(`Normalizados: ${out.length} (skipped=${skipped})`);
  console.log(`Output: ${OUTPUT_PATH}`);
  if (out[0]) {
    console.log('\nExemplo:');
    console.log(JSON.stringify(out[0], null, 2));
  }
  console.log('\nPróximo: npm run ingest:gurupass');
}

main().catch((err) => {
  console.error('Erro fatal:', err);
  process.exit(1);
});
