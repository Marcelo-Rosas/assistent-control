/**
 * Retry gyms listed in totalpass-enrich-failures.json (or --gym-id=).
 *
 * Run:
 *   npx tsx scripts/retry-totalpass-enrich-failures.ts
 *   npx tsx scripts/retry-totalpass-enrich-failures.ts --gym-id=16bc5e3f-...
 */
import fs from 'fs/promises';
import path from 'path';
import { fetchTotalPassDetailSchema } from './lib/totalpassDetailSchema.ts';

type ListGym = {
  id: string;
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
  };
};

const ROOT = process.cwd();
const INPUT_PATH = path.join(ROOT, 'data/raw/totalpass-brasil-all.json');
const OUTPUT_DIR = path.join(ROOT, 'data/processed/totalpass-enriched/by-id');
const PROGRESS_PATH = path.join(ROOT, 'data/processed/totalpass-enrich-progress.json');
const FAILURES_PATH = path.join(ROOT, 'data/processed/totalpass-enrich-failures.json');
const MAX_RETRIES = Number(process.env.MAX_RETRIES || 5);

const GYM_ID_ARG = process.argv.find((a) => a.startsWith('--gym-id='))?.split('=')[1];

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function toListSnapshot(gym: ListGym) {
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

async function enrichSlug(slug: string) {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await fetchTotalPassDetailSchema(slug);
    } catch (err) {
      lastErr = err;
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`  retry ${attempt}/${MAX_RETRIES}: ${msg}`);
      if (attempt < MAX_RETRIES) await sleep(1500 * attempt);
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

async function writeFailuresSnapshot(
  progress: { completed: string[]; failed: Array<{ gym_id: string; slug: string; error: string }> },
  totalGyms: number,
): Promise<void> {
  const payload = {
    updated_at: new Date().toISOString(),
    summary: {
      total_gyms: totalGyms,
      completed: progress.completed.length,
      failed: progress.failed.length,
      pending: totalGyms - progress.completed.length - progress.failed.length,
      pct_complete: `${((progress.completed.length / totalGyms) * 100).toFixed(1)}%`,
    },
    failures: progress.failed.map((f) => ({
      gym_id: f.gym_id,
      slug: f.slug,
      url: `https://totalpass.com/br/academias/${f.slug}/`,
      error: f.error,
    })),
  };
  const tmp = `${FAILURES_PATH}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(payload, null, 2), 'utf-8');
  await fs.rename(tmp, FAILURES_PATH);
}

async function main(): Promise<void> {
  const failuresRaw = JSON.parse(await fs.readFile(FAILURES_PATH, 'utf-8')) as {
    failures?: Array<{ gym_id: string; slug: string }>;
  };
  let targetIds = GYM_ID_ARG
    ? [GYM_ID_ARG]
    : (failuresRaw.failures ?? []).map((f) => f.gym_id);

  if (!targetIds.length) {
    console.log('Nenhuma falha para retry.');
    return;
  }

  const raw = JSON.parse(await fs.readFile(INPUT_PATH, 'utf-8')) as { data?: ListGym[] };
  const gyms = (raw.data ?? []).filter((g) => g?.id && g.attributes?.slug?.trim());
  const byId = new Map(gyms.map((g) => [g.id, g]));

  const progress = JSON.parse(await fs.readFile(PROGRESS_PATH, 'utf-8')) as {
    completed: string[];
    failed: Array<{ gym_id: string; slug: string; error: string }>;
    lastUpdate: string;
  };
  const completed = new Set(progress.completed);

  console.log(`Retry TP enrich: ${targetIds.length} gym(s)\n`);

  let ok = 0;
  let errCount = 0;

  for (const gymId of targetIds) {
    const gym = byId.get(gymId);
    if (!gym) {
      console.warn(`SKIP ${gymId}: não encontrado no dump`);
      continue;
    }
    const slug = gym.attributes.slug!.trim();
    const label = gym.attributes.name?.trim() || slug;
    console.log(`${label} (${slug})`);

    progress.failed = progress.failed.filter((f) => f.gym_id !== gymId);

    try {
      const detail = await enrichSlug(slug);
      const record = {
        gym_id: gymId,
        slug,
        enriched_at: new Date().toISOString(),
        list: toListSnapshot(gym),
        detail,
      };
      await fs.mkdir(OUTPUT_DIR, { recursive: true });
      const out = path.join(OUTPUT_DIR, `${gymId}.json`);
      const tmp = `${out}.tmp`;
      await fs.writeFile(tmp, JSON.stringify(record), 'utf-8');
      await fs.rename(tmp, out);
      completed.add(gymId);
      ok += 1;
      console.log(
        `  OK modalidades=${detail.modalidades.length} comodidades=${detail.comodidades.length}`,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      progress.failed.push({ gym_id: gymId, slug, error: message });
      errCount += 1;
      console.warn(`  ERRO: ${message}`);
    }
  }

  progress.completed = [...completed];
  progress.lastUpdate = new Date().toISOString();
  const tmpProgress = `${PROGRESS_PATH}.tmp`;
  await fs.writeFile(tmpProgress, JSON.stringify(progress), 'utf-8');
  await fs.rename(tmpProgress, PROGRESS_PATH);
  await writeFailuresSnapshot(progress, gyms.length);

  console.log(`\nOK=${ok} ERRO=${errCount} · completed=${progress.completed.length} failed=${progress.failed.length}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
