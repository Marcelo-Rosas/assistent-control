/**
 * F2 — Resolve bairro TP via CEP (Receita match → ViaCEP / BrasilAPI).
 *
 * Input:  data/raw/totalpass-brasil-all.json
 * Output: data/processed/tp-bairro-index.json
 * CEP cache: data/processed/tp-cep-cache.json
 * Progress: data/processed/tp-bairro-resolve-progress.json
 *
 * Run:
 *   npm run resolve:tp-bairros
 *   npm run resolve:tp-bairros -- --uf=RS --limit=50
 *   npm run resolve:tp-bairros -- --only-failures
 */
import fs from 'fs/promises';
import path from 'path';
import { cidadeKey } from './lib/academia-normalize.ts';
import { loadTpReceitaCepMap } from './lib/tpReceitaCepMatch.ts';
import {
  countTpBairroIndex,
  isValidCepResolved,
  loadTpBairroIndex,
  resolveTpBairroViaCep,
  saveTpBairroIndex,
  type TpBairroIndex,
} from './lib/tpBairroResolver.ts';
import { loadCepCache, saveCepCache, loadLogradouroCache, saveLogradouroCache } from './lib/tpCepResolver.ts';

type ListGym = {
  id: string;
  attributes?: {
    name?: string;
    slug?: string;
    full_address?: string;
    location?: { lat?: number; lng?: number };
    municipios_busca?: string[];
    municipios_relacionados?: string[];
    uf?: string;
  };
};

type EnrichedRecord = {
  detail?: { endereco?: string };
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
const ENRICH_DIR =
  process.env.OUTPUT_DIR || path.join(ROOT, 'data/processed/totalpass-enriched/by-id');
const DELAY_MS = Number(process.env.DELAY_MS || 1100);
const LIMIT_ARG = process.argv.find((a) => a.startsWith('--limit='))?.split('=')[1];
const LIMIT = Number(process.env.LIMIT || LIMIT_ARG || 0);
const CHECKPOINT_EVERY = Number(process.env.CHECKPOINT_EVERY || 50);
const UF_ARG = process.argv.find((a) => a.startsWith('--uf='))?.split('=')[1]?.toUpperCase() ?? null;
const ONLY_FAILURES = process.argv.includes('--only-failures');
const FORCE = process.argv.includes('--force');

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function gymUf(g: ListGym): string | null {
  return g.attributes?.uf?.trim().toUpperCase() ?? null;
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

async function loadDetailAddress(gymId: string): Promise<string | null> {
  try {
    const raw = await fs.readFile(path.join(ENRICH_DIR, `${gymId}.json`), 'utf8');
    const rec = JSON.parse(raw) as EnrichedRecord;
    return rec.detail?.endereco?.trim() || null;
  } catch {
    return null;
  }
}

async function main(): Promise<void> {
  console.log(`Resolve TP bairros (CEP)${UF_ARG ? ` UF=${UF_ARG}` : ''}${ONLY_FAILURES ? ' only-failures' : ''}`);
  console.log(`DELAY_MS=${DELAY_MS} LIMIT=${LIMIT || '∞'} CHECKPOINT_EVERY=${CHECKPOINT_EVERY}\n`);

  const receitaCepMap = await loadTpReceitaCepMap();
  console.log(`Receita match alta → CEP: ${receitaCepMap.size} tp_ids\n`);

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
  const completed = new Set(FORCE ? [] : progress.completed);
  const cepCache = await loadCepCache();
  const logradouroCache = await loadLogradouroCache();
  const existing = (await loadTpBairroIndex(INDEX_PATH)) ?? {
    version: '2' as const,
    generated_at: new Date().toISOString(),
    provider: 'cep' as const,
    stats: { total: 0, resolved: 0, failed: 0 },
    by_gym_id: {},
    failures: [],
  };

  existing.version = '2';
  existing.provider = 'cep';

  const failureIds = new Set((existing.failures ?? []).map((f) => f.gym_id));

  let pending = gyms.filter((g) => {
    if (ONLY_FAILURES && !failureIds.has(g.id)) return false;
    if (!FORCE && existing.by_gym_id[g.id] && isValidCepResolved(existing.by_gym_id[g.id]!)) {
      return false;
    }
    return true;
  });

  if (LIMIT > 0) pending = pending.slice(0, LIMIT);

  console.log(
    `Com coords: ${gyms.length} · receita_cep map: ${receitaCepMap.size} · pending: ${pending.length}\n`,
  );

  let sinceCheckpoint = 0;
  let ok = 0;
  let fail = 0;

  for (let i = 0; i < pending.length; i++) {
    const gym = pending[i]!;
    const coords = gymCoords(gym)!;
    const receitaHit = receitaCepMap.get(gym.id);
    const detailAddress = await loadDetailAddress(gym.id);
    const listAddress = gym.attributes?.full_address ?? null;

    console.log(
      `[${i + 1}/${pending.length}] ${gym.attributes?.name ?? gym.id.slice(0, 8)}…` +
        `${receitaHit ? ' [receita_cep]' : ''}`,
    );

    let hadCache = false;
    try {
      const cepDigits = receitaHit?.cep.replace(/\D/g, '') ?? null;
      hadCache = Boolean(
        cepDigits && cepCache[`cep:${cepDigits}`] && 'bairro' in cepCache[`cep:${cepDigits}`]!,
      );

      const resolved = await resolveTpBairroViaCep({
        gymId: gym.id,
        lat: coords.lat,
        lng: coords.lng,
        receitaHit,
        listAddress,
        detailAddress,
        cepCache,
        logradouroCache,
      });

      existing.failures = (existing.failures ?? []).filter((f) => f.gym_id !== gym.id);

      if (resolved && isValidCepResolved(resolved)) {
        existing.by_gym_id[gym.id] = resolved;
        console.log(
          `  OK cep=${resolved.cep} bairro=${resolved.bairro} (${resolved.bairro_slug}) source=${resolved.source}`,
        );
        ok += 1;
        progress.failed = progress.failed.filter((f) => f.gym_id !== gym.id);
      } else {
        const err = receitaHit || detailAddress || listAddress ? 'cep_lookup_fail' : 'sem_cep';
        existing.failures.push({
          gym_id: gym.id,
          lat: coords.lat,
          lng: coords.lng,
          error: err,
        });
        progress.failed = progress.failed.filter((f) => f.gym_id !== gym.id);
        progress.failed.push({ gym_id: gym.id, error: err });
        fail += 1;
        console.warn(`  FAIL ${err}`);
      }
      completed.add(gym.id);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      existing.failures = (existing.failures ?? []).filter((f) => f.gym_id !== gym.id);
      existing.failures.push({
        gym_id: gym.id,
        lat: coords.lat,
        lng: coords.lng,
        error: message,
      });
      progress.failed = progress.failed.filter((f) => f.gym_id !== gym.id);
      progress.failed.push({ gym_id: gym.id, error: message });
      fail += 1;
      console.warn(`  ERRO: ${message}`);
    }

    progress.completed = [...completed];
    sinceCheckpoint += 1;

    if (sinceCheckpoint >= CHECKPOINT_EVERY) {
      const counts = countTpBairroIndex(existing);
      existing.stats = {
        total: counts.resolved_any + counts.failed,
        resolved: counts.resolved_cep,
        failed: counts.failed,
      };
      existing.generated_at = new Date().toISOString();
      await saveCepCache(cepCache);
      await saveLogradouroCache(logradouroCache);
      await saveTpBairroIndex(INDEX_PATH, existing);
      await saveProgress(progress);
      sinceCheckpoint = 0;
      console.log(`  💾 checkpoint resolved=${existing.stats.resolved}`);
    }

    if (i < pending.length - 1 && !hadCache) await sleep(DELAY_MS);
  }

  const counts = countTpBairroIndex(existing);
  existing.stats = {
    total: counts.resolved_any + counts.failed,
    resolved: counts.resolved_cep,
    failed: counts.failed,
  };
  existing.generated_at = new Date().toISOString();
  await saveCepCache(cepCache);
  await saveLogradouroCache(logradouroCache);
  await saveTpBairroIndex(INDEX_PATH, existing);
  await saveProgress(progress);

  console.log('\n=== Resumo ===');
  console.log(`OK nesta rodada: ${ok}`);
  console.log(`Falhas nesta rodada: ${fail}`);
  console.log(`Total resolved CEP: ${counts.resolved_cep} · legacy+CEP: ${counts.resolved_any}`);
  console.log(`Index: ${INDEX_PATH}`);
  console.log(`CEP cache: data/processed/tp-cep-cache.json`);
}

main().catch((err) => {
  console.error('Erro fatal:', err);
  process.exit(1);
});
