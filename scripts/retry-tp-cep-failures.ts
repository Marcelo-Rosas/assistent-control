/**
 * Re-tenta resolução CEP para:
 * 1) failures[] no tp-bairro-index
 * 2) receita match alta sem entrada CEP válida no index
 *
 * Run: npm run retry:tp-cep-failures
 */
import fs from 'fs/promises';
import path from 'path';
import {
  countTpBairroIndex,
  isValidCepResolved,
  loadTpBairroIndex,
  resolveTpBairroViaCep,
  saveTpBairroIndex,
} from './lib/tpBairroResolver.ts';
import { loadCepCache, loadLogradouroCache, saveCepCache, saveLogradouroCache } from './lib/tpCepResolver.ts';
import { loadTpReceitaCepMap } from './lib/tpReceitaCepMatch.ts';

const ROOT = process.cwd();
const INPUT_PATH = path.join(ROOT, 'data/raw/totalpass-brasil-all.json');
const INDEX_PATH = path.join(ROOT, 'data/processed/tp-bairro-index.json');
const ENRICH_DIR = path.join(ROOT, 'data/processed/totalpass-enriched/by-id');
const DELAY_MS = Number(process.env.DELAY_MS || 1100);
const LIMIT_ARG = process.argv.find((a) => a.startsWith('--limit='))?.split('=')[1];
const LIMIT = Number(process.env.LIMIT || LIMIT_ARG || 0);

type ListGym = {
  id: string;
  attributes?: {
    name?: string;
    full_address?: string;
    location?: { lat?: number; lng?: number };
  };
};

type EnrichedRecord = { detail?: { endereco?: string } };

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function loadDetailAddress(gymId: string): Promise<string | null> {
  try {
    const raw = await fs.readFile(path.join(ENRICH_DIR, `${gymId}.json`), 'utf8');
    return (JSON.parse(raw) as EnrichedRecord).detail?.endereco?.trim() || null;
  } catch {
    return null;
  }
}

async function main(): Promise<void> {
  console.log('Retry TP CEP failures\n');

  const receitaMap = await loadTpReceitaCepMap();
  const index = (await loadTpBairroIndex(INDEX_PATH))!;
  if (!index) throw new Error('Index ausente');

  const raw = JSON.parse(await fs.readFile(INPUT_PATH, 'utf8')) as { data?: ListGym[] };
  const gymById = new Map((raw.data ?? []).map((g) => [g.id, g]));

  const failureIds = new Set((index.failures ?? []).map((f) => f.gym_id));
  const receitaMiss = [...receitaMap.keys()].filter(
    (id) => !isValidCepResolved(index.by_gym_id[id] ?? ({} as never)),
  );

  const pendingIds = [...new Set([...failureIds, ...receitaMiss])];
  let pending = pendingIds;
  if (LIMIT > 0) pending = pending.slice(0, LIMIT);

  console.log(
    `index.failures=${failureIds.size} · receita sem CEP index=${receitaMiss.length} · retry=${pending.length}\n`,
  );

  const cepCache = await loadCepCache();
  const logradouroCache = await loadLogradouroCache();
  let ok = 0;
  let fail = 0;

  for (let i = 0; i < pending.length; i++) {
    const gymId = pending[i]!;
    const gym = gymById.get(gymId);
    const lat = Number(gym?.attributes?.location?.lat);
    const lng = Number(gym?.attributes?.location?.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      fail += 1;
      continue;
    }

    const receitaHit = receitaMap.get(gymId);
    const detailAddress = await loadDetailAddress(gymId);
    const listAddress = gym?.attributes?.full_address ?? null;
    const cepDigits = receitaHit?.cep.replace(/\D/g, '');
    const hadCache = Boolean(
      cepDigits && cepCache[`cep:${cepDigits}`] && 'bairro' in cepCache[`cep:${cepDigits}`]!,
    );

    console.log(`[${i + 1}/${pending.length}] ${gym?.attributes?.name ?? gymId.slice(0, 8)}`);

    try {
      const resolved = await resolveTpBairroViaCep({
        gymId,
        lat,
        lng,
        receitaHit,
        listAddress,
        detailAddress,
        cepCache,
        logradouroCache,
      });

      index.failures = (index.failures ?? []).filter((f) => f.gym_id !== gymId);

      if (resolved && isValidCepResolved(resolved)) {
        index.by_gym_id[gymId] = resolved;
        ok += 1;
        console.log(`  OK cep=${resolved.cep} ${resolved.bairro} (${resolved.source})`);
      } else {
        const err = receitaHit || detailAddress || listAddress ? 'cep_lookup_fail' : 'sem_cep';
        index.failures.push({ gym_id: gymId, lat, lng, error: err });
        fail += 1;
        console.warn(`  FAIL ${err}`);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      index.failures = (index.failures ?? []).filter((f) => f.gym_id !== gymId);
      index.failures.push({ gym_id: gymId, lat, lng, error: message });
      fail += 1;
      console.warn(`  ERRO ${message}`);
    }

    if (i < pending.length - 1 && !hadCache) await sleep(DELAY_MS);
  }

  index.version = '2';
  index.provider = 'cep';
  const counts = countTpBairroIndex(index);
  index.stats = {
    total: counts.resolved_any + counts.failed,
    resolved: counts.resolved_any,
    resolved_cep: counts.resolved_cep,
    failed: counts.failed,
  };
  index.generated_at = new Date().toISOString();

  await saveCepCache(cepCache);
  await saveLogradouroCache(logradouroCache);
  await saveTpBairroIndex(INDEX_PATH, index);

  console.log('\n=== Resumo retry ===');
  console.log(`OK: ${ok} · Fail: ${fail}`);
  console.log(`Index CEP: ${counts.resolved_cep} · total bairro: ${counts.resolved_any} · failures: ${counts.failed}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
