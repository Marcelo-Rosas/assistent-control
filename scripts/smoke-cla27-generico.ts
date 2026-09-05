/**
 * Smoke CLA-27: só failures com Receita alta + CEP genérico.
 * npx tsx scripts/smoke-cla27-generico.ts --limit=15
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
import {
  isCepGenerico,
  loadCepCache,
  loadLogradouroCache,
  saveCepCache,
  saveLogradouroCache,
} from './lib/tpCepResolver.ts';
import { loadTpReceitaCepMap } from './lib/tpReceitaCepMatch.ts';

const ROOT = process.cwd();
const INDEX_PATH = path.join(ROOT, 'data/processed/tp-bairro-index.json');
const INPUT_PATH = path.join(ROOT, 'data/raw/totalpass-brasil-all.json');
const ENRICH_DIR = path.join(ROOT, 'data/processed/totalpass-enriched/by-id');
const LIMIT = Number(process.argv.find((a) => a.startsWith('--limit='))?.split('=')[1] || 15);
const DELAY_MS = Number(process.env.DELAY_MS || 1100);
const WRITE = process.argv.includes('--write');

type ListGym = {
  id: string;
  attributes?: {
    name?: string;
    full_address?: string;
    location?: { lat?: number; lng?: number };
  };
};

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  const index = (await loadTpBairroIndex(INDEX_PATH))!;
  const map = await loadTpReceitaCepMap();
  const raw = JSON.parse(await fs.readFile(INPUT_PATH, 'utf8')) as { data?: ListGym[] };
  const gymById = new Map((raw.data ?? []).map((g) => [g.id, g]));
  const cepCache = await loadCepCache();
  const logCache = await loadLogradouroCache();

  const candidates = (index.failures ?? [])
    .map((f) => f.gym_id)
    .filter((id) => {
      const hit = map.get(id);
      return Boolean(hit && isCepGenerico(hit.cep) && hit.logradouro);
    })
    .slice(0, LIMIT);

  console.log(`candidates generico+log=${candidates.length} write=${WRITE}\n`);

  let ok = 0;
  let fail = 0;

  for (let i = 0; i < candidates.length; i++) {
    const gymId = candidates[i]!;
    const gym = gymById.get(gymId);
    const hit = map.get(gymId)!;
    const lat = Number(gym?.attributes?.location?.lat);
    const lng = Number(gym?.attributes?.location?.lng);
    let detailAddress: string | null = null;
    try {
      const en = JSON.parse(await fs.readFile(path.join(ENRICH_DIR, `${gymId}.json`), 'utf8')) as {
        detail?: { endereco?: string };
      };
      detailAddress = en.detail?.endereco?.trim() || null;
    } catch {
      /* none */
    }

    console.log(
      `[${i + 1}/${candidates.length}] ${gym?.attributes?.name ?? gymId.slice(0, 8)} cep_rf=${hit.cep} ${hit.municipio}/${hit.uf} log=${hit.logradouro.slice(0, 40)}`,
    );

    const resolved = await resolveTpBairroViaCep({
      gymId,
      lat,
      lng,
      receitaHit: hit,
      listAddress: gym?.attributes?.full_address ?? null,
      detailAddress,
      cepCache,
      logradouroCache: logCache,
    });

    if (resolved && isValidCepResolved(resolved)) {
      ok += 1;
      const flag = resolved.cep_geral ? ' CEP_GERAL' : '';
      console.log(
        `  OK cep=${resolved.cep} ${resolved.bairro} (${resolved.source})${flag}`,
      );
      if (resolved.nota) console.log(`     ${resolved.nota}`);
      if (WRITE) {
        index.failures = (index.failures ?? []).filter((f) => f.gym_id !== gymId);
        index.by_gym_id[gymId] = resolved;
      }
    } else {
      fail += 1;
      console.warn('  FAIL');
    }

    if (i < candidates.length - 1) await sleep(DELAY_MS);
  }

  if (WRITE) {
    const counts = countTpBairroIndex(index);
    index.stats = {
      total: counts.resolved_any + counts.failed,
      resolved: counts.resolved_any,
      resolved_cep: counts.resolved_cep,
      failed: counts.failed,
    };
    index.generated_at = new Date().toISOString();
    await saveCepCache(cepCache);
    await saveLogradouroCache(logCache);
    await saveTpBairroIndex(INDEX_PATH, index);
  } else {
    // ainda persiste caches de rede pra não re-bater ViaCEP
    await saveCepCache(cepCache);
    await saveLogradouroCache(logCache);
  }

  console.log(`\n=== Smoke generico === OK:${ok} Fail:${fail}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
