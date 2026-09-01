/**
 * Pass 2 — enrich TotalPass via páginas de detalhe (schema completo).
 *
 * Input:  data/raw/totalpass-brasil-all.json
 * Output: data/processed/totalpass-enriched/by-id/<gym_id>.json
 * Checkpoint: data/processed/totalpass-enrich-progress.json
 *
 * Run: npm run enrich:tp-details
 *
 * Env:
 *   INPUT_PATH
 *   OUTPUT_DIR
 *   PROGRESS_PATH
 *   DELAY_MS=500
 *   LIMIT=0
 *   CHECKPOINT_EVERY=25
 *   MAX_RETRIES=3
 */
import fs from 'fs/promises';
import path from 'path';
import { fetchTotalPassDetailSchema } from './lib/totalpassDetailSchema.ts';

type ListGym = {
  id: string;
  type?: string;
  attributes: {
    name?: string;
    slug?: string;
    full_address?: string;
    location?: { lat?: number; lng?: number };
    municipios_relacionados?: string[];
    municipios_busca?: string[];
    accessible_on_plans?: unknown[];
    accessible_from_company_plan?: unknown;
    warning_message?: string;
    featured_modality_id?: string | number;
    [key: string]: unknown;
  };
};

type EnrichedRecord = {
  gym_id: string;
  slug: string;
  enriched_at: string;
  list: {
    name: string | null;
    full_address: string | null;
    location: { lat?: number; lng?: number } | null;
    municipios_relacionados: string[];
    municipios_busca: string[];
    accessible_on_plans: unknown[];
    accessible_from_company_plan: unknown;
    warning_message: string | null;
    featured_modality_id: string | null;
  };
  detail: Awaited<ReturnType<typeof fetchTotalPassDetailSchema>>;
};

type ProgressState = {
  completed: string[];
  failed: Array<{ gym_id: string; slug: string; error: string }>;
  lastUpdate: string;
};

const ROOT = process.cwd();
const INPUT_PATH =
  process.env.INPUT_PATH || path.join(ROOT, 'data/raw/totalpass-brasil-all.json');
const OUTPUT_DIR =
  process.env.OUTPUT_DIR || path.join(ROOT, 'data/processed/totalpass-enriched/by-id');
const PROGRESS_PATH =
  process.env.PROGRESS_PATH ||
  path.join(ROOT, 'data/processed/totalpass-enrich-progress.json');
const FAILURES_PATH =
  process.env.FAILURES_PATH ||
  path.join(ROOT, 'data/processed/totalpass-enrich-failures.json');
const DELAY_MS = Number(process.env.DELAY_MS || 500);
const LIMIT = Number(process.env.LIMIT || 0);
const CHECKPOINT_EVERY = Number(process.env.CHECKPOINT_EVERY || 25);
const MAX_RETRIES = Number(process.env.MAX_RETRIES || 3);

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function emptyProgress(): ProgressState {
  return { completed: [], failed: [], lastUpdate: new Date().toISOString() };
}

async function loadProgress(): Promise<ProgressState> {
  try {
    const raw = await fs.readFile(PROGRESS_PATH, 'utf-8');
    const parsed = JSON.parse(raw) as ProgressState;
    return {
      completed: Array.isArray(parsed.completed) ? parsed.completed : [],
      failed: Array.isArray(parsed.failed) ? parsed.failed : [],
      lastUpdate: parsed.lastUpdate || new Date().toISOString(),
    };
  } catch {
    return emptyProgress();
  }
}

async function saveProgress(state: ProgressState): Promise<void> {
  state.lastUpdate = new Date().toISOString();
  await fs.mkdir(path.dirname(PROGRESS_PATH), { recursive: true });
  const tmp = `${PROGRESS_PATH}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(state), 'utf-8');
  await fs.rename(tmp, PROGRESS_PATH);
}

async function writeFailuresSnapshot(
  state: ProgressState,
  totalGyms: number,
): Promise<void> {
  const payload = {
    updated_at: new Date().toISOString(),
    summary: {
      total_gyms: totalGyms,
      completed: state.completed.length,
      failed: state.failed.length,
      pending: totalGyms - state.completed.length - state.failed.length,
      pct_complete: `${((state.completed.length / totalGyms) * 100).toFixed(1)}%`,
    },
    failures: state.failed.map((f) => ({
      gym_id: f.gym_id,
      slug: f.slug,
      url: `https://totalpass.com/br/academias/${f.slug}/`,
      error: f.error,
    })),
  };
  await fs.mkdir(path.dirname(FAILURES_PATH), { recursive: true });
  const tmp = `${FAILURES_PATH}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(payload, null, 2), 'utf-8');
  await fs.rename(tmp, FAILURES_PATH);
}

async function writeEnriched(record: EnrichedRecord): Promise<void> {
  await fs.mkdir(OUTPUT_DIR, { recursive: true });
  const file = path.join(OUTPUT_DIR, `${record.gym_id}.json`);
  const tmp = `${file}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(record), 'utf-8');
  await fs.rename(tmp, file);
}

function toListSnapshot(gym: ListGym): EnrichedRecord['list'] {
  const a = gym.attributes || {};
  return {
    name: a.name?.trim() || null,
    full_address: a.full_address?.trim() || null,
    location: a.location || null,
    municipios_relacionados: Array.isArray(a.municipios_relacionados)
      ? a.municipios_relacionados.filter((m) => typeof m === 'string')
      : [],
    municipios_busca: Array.isArray(a.municipios_busca)
      ? a.municipios_busca.filter((m) => typeof m === 'string')
      : [],
    accessible_on_plans: Array.isArray(a.accessible_on_plans) ? a.accessible_on_plans : [],
    accessible_from_company_plan: a.accessible_from_company_plan || null,
    warning_message: a.warning_message?.trim() || null,
    featured_modality_id: a.featured_modality_id != null ? String(a.featured_modality_id) : null,
  };
}

async function enrichOne(gym: ListGym): Promise<EnrichedRecord> {
  const slug = gym.attributes?.slug?.trim();
  if (!slug) throw new Error('slug ausente');

  let lastErr: unknown;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const detail = await fetchTotalPassDetailSchema(slug);
      return {
        gym_id: gym.id,
        slug,
        enriched_at: new Date().toISOString(),
        list: toListSnapshot(gym),
        detail,
      };
    } catch (err) {
      lastErr = err;
      const msg = err instanceof Error ? err.message : String(err);
      const retryable = /429|5\d\d|timeout|fetch failed/i.test(msg);
      if (!retryable || attempt === MAX_RETRIES) break;
      const backoff = 1000 * 2 ** (attempt - 1);
      console.warn(`  retry ${attempt}/${MAX_RETRIES}: ${msg} wait=${backoff}ms`);
      await sleep(backoff);
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

async function main(): Promise<void> {
  console.log('Enrich TotalPass — detail pages (Pass 2)\n');
  console.log(`DELAY_MS=${DELAY_MS} CHECKPOINT_EVERY=${CHECKPOINT_EVERY} LIMIT=${LIMIT || '∞'}`);

  const raw = JSON.parse(await fs.readFile(INPUT_PATH, 'utf-8')) as { data?: ListGym[] };
  const gyms = (raw.data || []).filter((g) => g?.id && g.attributes?.slug?.trim());
  if (!gyms.length) {
    console.error(`Nenhuma academia com slug em ${INPUT_PATH}`);
    process.exit(1);
  }

  const progress = await loadProgress();
  const completed = new Set(progress.completed);
  const failedIds = new Set(progress.failed.map((f) => f.gym_id));

  let pending = gyms.filter((g) => !completed.has(g.id) && !failedIds.has(g.id));
  if (LIMIT > 0) pending = pending.slice(0, LIMIT);

  console.log(
    `Total=${gyms.length} completed=${completed.size} failed=${progress.failed.length} pending=${pending.length}\n`,
  );

  let sinceCheckpoint = 0;
  let ok = 0;
  let errCount = 0;

  for (let i = 0; i < pending.length; i++) {
    const gym = pending[i];
    const slug = gym.attributes.slug!.trim();
    const label = gym.attributes.name?.trim() || slug;
    console.log(`[${i + 1}/${pending.length}] ${label}`);

    try {
      const record = await enrichOne(gym);
      await writeEnriched(record);
      completed.add(gym.id);
      ok += 1;
      console.log(
        `  OK modalidades=${record.detail.modalidades.length} comodidades=${record.detail.comodidades.length}`,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(`  ERRO: ${message}`);
      progress.failed.push({ gym_id: gym.id, slug, error: message });
      errCount += 1;
    }

    progress.completed = [...completed];
    sinceCheckpoint += 1;

    if (sinceCheckpoint >= CHECKPOINT_EVERY) {
      await saveProgress(progress);
      await writeFailuresSnapshot(progress, gyms.length);
      sinceCheckpoint = 0;
      console.log(`  💾 checkpoint (${completed.size} ok · ${progress.failed.length} failed)`);
    }

    if (i < pending.length - 1) await sleep(DELAY_MS);
  }

  progress.completed = [...completed];
  await saveProgress(progress);
  await writeFailuresSnapshot(progress, gyms.length);

  console.log('\n=== Resumo ===');
  console.log(`OK nesta rodada: ${ok}`);
  console.log(`Erros nesta rodada: ${errCount}`);
  console.log(`Total enriched: ${completed.size}`);
  console.log(`Total failed: ${progress.failed.length}`);
  console.log(`Output: ${OUTPUT_DIR}`);
  console.log(`Progress: ${PROGRESS_PATH}`);
  console.log(`Failures: ${FAILURES_PATH}`);
}

main().catch((err) => {
  console.error('Erro fatal:', err);
  process.exit(1);
});
