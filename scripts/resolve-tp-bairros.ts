/**
 * F2 — Resolve bairro TP via reverse geocode (Nominatim) lat/lng.
 *
 * Input:  data/raw/totalpass-brasil-all.json
 * Output: data/processed/tp-bairro-index.json
 * Cache:  data/processed/tp-bairro-geocode-cache.json
 * Progress: data/processed/tp-bairro-resolve-progress.json
 *
 * Run:
 *   npm run resolve:tp-bairros
 *   npm run resolve:tp-bairros -- --uf=RS --limit=50
 *   npm run smoke:tp-bairro-geocode
 */
import fs from 'fs/promises';
import path from 'path';
import { cidadeKey } from './lib/academia-normalize.ts';
import {
  loadGeocodeCache,
  loadTpBairroIndex,
  reverseGeocodeBairro,
  saveGeocodeCache,
  saveTpBairroIndex,
  type TpBairroIndex,
  type TpBairroResolved,
} from './lib/tpBairroResolver.ts';

type ListGym = {
  id: string;
  attributes?: {
    location?: { lat?: number; lng?: number };
    municipios_busca?: string[];
    municipios_relacionados?: string[];
    uf?: string;
  };
};

type ProgressState = {
  completed: string[];
  failed: Array<{ gym_id: string; error: string }>;
  lastUpdate: string;
};

const ROOT = process.cwd();
const INPUT_PATH =
  process.env.INPUT_PATH || path.join(ROOT, 'data/raw/totalpass-brasil-all.json');
const INDEX_PATH =
  process.env.INDEX_PATH || path.join(ROOT, 'data/processed/tp-bairro-index.json');
const PROGRESS_PATH =
  process.env.PROGRESS_PATH || path.join(ROOT, 'data/processed/tp-bairro-resolve-progress.json');
const DELAY_MS = Number(process.env.DELAY_MS || 1100);
const LIMIT_ARG = process.argv.find((a) => a.startsWith('--limit='))?.split('=')[1];
const LIMIT = Number(process.env.LIMIT || LIMIT_ARG || 0);
const CHECKPOINT_EVERY = Number(process.env.CHECKPOINT_EVERY || 50);
const UF_ARG = process.argv.find((a) => a.startsWith('--uf='))?.split('=')[1]?.toUpperCase() ?? null;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function gymUf(g: ListGym): string | null {
  const uf = g.attributes?.uf?.trim().toUpperCase();
  if (uf) return uf;
  return null;
}

function gymCoords(g: ListGym): { lat: number; lng: number } | null {
  const lat = Number(g.attributes?.location?.lat);
  const lng = Number(g.attributes?.location?.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat === 0 && lng === 0) return null;
  return { lat, lng };
}

async function loadProgress(): Promise<ProgressState> {
  try {
    const raw = await fs.readFile(PROGRESS_PATH, 'utf8');
    const p = JSON.parse(raw) as ProgressState;
    return {
      completed: Array.isArray(p.completed) ? p.completed : [],
      failed: Array.isArray(p.failed) ? p.failed : [],
      lastUpdate: p.lastUpdate || new Date().toISOString(),
    };
  } catch {
    return { completed: [], failed: [], lastUpdate: new Date().toISOString() };
  }
}

async function saveProgress(state: ProgressState): Promise<void> {
  state.lastUpdate = new Date().toISOString();
  await fs.mkdir(path.dirname(PROGRESS_PATH), { recursive: true });
  const tmp = `${PROGRESS_PATH}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(state), 'utf8');
  await fs.rename(tmp, PROGRESS_PATH);
}

async function main(): Promise<void> {
  console.log(`Resolve TP bairros (Nominatim)${UF_ARG ? ` UF=${UF_ARG}` : ''}`);
  console.log(`DELAY_MS=${DELAY_MS} LIMIT=${LIMIT || '∞'} CHECKPOINT_EVERY=${CHECKPOINT_EVERY}\n`);

  const raw = JSON.parse(await fs.readFile(INPUT_PATH, 'utf8')) as { data?: ListGym[] };
  let gyms = (raw.data ?? []).filter((g) => g?.id && gymCoords(g));

  if (UF_ARG) {
    const municipios = JSON.parse(
      await fs.readFile(path.join(ROOT, 'data/municipios-brasil.json'), 'utf8'),
    ) as Array<{ nome: string; uf: string }>;
    const ufMunKeys = new Set(
      municipios.filter((m) => m.uf === UF_ARG).map((m) => cidadeKey(m.nome, m.uf)),
    );
    gyms = gyms.filter((g) => {
      const uf = gymUf(g);
      if (uf === UF_ARG) return true;
      const busca = [
        ...(g.attributes?.municipios_busca ?? []),
        ...(g.attributes?.municipios_relacionados ?? []),
      ];
      return busca.some((m) => ufMunKeys.has(cidadeKey(m, UF_ARG)));
    });
  }

  const progress = await loadProgress();
  const completed = new Set(progress.completed);
  const cache = await loadGeocodeCache();
  const existing = (await loadTpBairroIndex(INDEX_PATH)) ?? {
    version: '1' as const,
    generated_at: new Date().toISOString(),
    provider: 'nominatim' as const,
    stats: { total: 0, resolved: 0, failed: 0 },
    by_gym_id: {},
    failures: [],
  };

  let pending = gyms.filter((g) => !completed.has(g.id));
  if (LIMIT > 0) pending = pending.slice(0, LIMIT);

  console.log(
    `Com coords: ${gyms.length} · já ok: ${completed.size} · pending: ${pending.length}\n`,
  );

  let sinceCheckpoint = 0;
  let ok = 0;
  let fail = 0;

  for (let i = 0; i < pending.length; i++) {
    const gym = pending[i];
    const coords = gymCoords(gym)!;
    console.log(`[${i + 1}/${pending.length}] ${gym.id.slice(0, 8)}… ${coords.lat},${coords.lng}`);

    try {
      const resolved = await reverseGeocodeBairro(coords.lat, coords.lng, { cache });
      if (resolved) {
        existing.by_gym_id[gym.id] = { ...resolved, source: 'nominatim' };
        console.log(`  OK bairro=${resolved.bairro} (${resolved.bairro_slug})`);
        ok += 1;
      } else {
        existing.failures.push({
          gym_id: gym.id,
          lat: coords.lat,
          lng: coords.lng,
          error: 'sem_bairro_nominatim',
        });
        progress.failed.push({ gym_id: gym.id, error: 'sem_bairro_nominatim' });
        fail += 1;
        console.warn('  WARN sem bairro no endereço Nominatim');
      }
      completed.add(gym.id);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      existing.failures.push({
        gym_id: gym.id,
        lat: coords.lat,
        lng: coords.lng,
        error: message,
      });
      progress.failed.push({ gym_id: gym.id, error: message });
      fail += 1;
      console.warn(`  ERRO: ${message}`);
    }

    progress.completed = [...completed];
    sinceCheckpoint += 1;

    if (sinceCheckpoint >= CHECKPOINT_EVERY) {
      existing.stats = {
        total: completed.size,
        resolved: Object.keys(existing.by_gym_id).length,
        failed: existing.failures.length,
      };
      existing.generated_at = new Date().toISOString();
      await saveGeocodeCache(cache);
      await saveTpBairroIndex(INDEX_PATH, existing);
      await saveProgress(progress);
      sinceCheckpoint = 0;
      console.log(`  💾 checkpoint resolved=${existing.stats.resolved}`);
    }

    if (i < pending.length - 1) await sleep(DELAY_MS);
  }

  existing.stats = {
    total: completed.size,
    resolved: Object.keys(existing.by_gym_id).length,
    failed: existing.failures.length,
  };
  existing.generated_at = new Date().toISOString();
  await saveGeocodeCache(cache);
  await saveTpBairroIndex(INDEX_PATH, existing);
  await saveProgress(progress);

  console.log('\n=== Resumo ===');
  console.log(`OK nesta rodada: ${ok}`);
  console.log(`Falhas nesta rodada: ${fail}`);
  console.log(`Total resolved index: ${existing.stats.resolved}`);
  console.log(`Index: ${INDEX_PATH}`);
  console.log(`Cache: data/processed/tp-bairro-geocode-cache.json`);
}

main().catch((err) => {
  console.error('Erro fatal:', err);
  process.exit(1);
});
