/**
 * Batch — resolve bairro TP via Receita match → CEP lookup (sem re-processar todos).
 *
 * Run: npm run build:tp-bairro-receita-cep
 *      npm run build:tp-bairro-receita-cep -- --limit=20
 */
import fs from 'fs/promises';
import path from 'path';
import {
  countTpBairroIndex,
  loadTpBairroIndex,
  resolveTpBairroViaCep,
  saveTpBairroIndex,
  type TpBairroIndex,
} from './lib/tpBairroResolver.ts';
import {
  loadCepCache,
  loadLogradouroCache,
  saveCepCache,
  saveLogradouroCache,
} from './lib/tpCepResolver.ts';
import { loadTpReceitaCepMap } from './lib/tpReceitaCepMatch.ts';

const ROOT = process.cwd();
const INPUT_PATH = path.join(ROOT, 'data/raw/totalpass-brasil-all.json');
const INDEX_PATH = path.join(ROOT, 'data/processed/tp-bairro-index.json');
const DELAY_MS = Number(process.env.DELAY_MS || 1100);
const LIMIT_ARG = process.argv.find((a) => a.startsWith('--limit='))?.split('=')[1];
const LIMIT = Number(process.env.LIMIT || LIMIT_ARG || 0);

type ListGym = {
  id: string;
  attributes?: { location?: { lat?: number; lng?: number }; name?: string };
};

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function main(): Promise<void> {
  console.log('Build TP bairro from Receita CEP\n');

  const receitaMap = await loadTpReceitaCepMap();
  console.log(`Match alta com CEP: ${receitaMap.size}`);

  const raw = JSON.parse(await fs.readFile(INPUT_PATH, 'utf8')) as { data?: ListGym[] };
  const gymById = new Map((raw.data ?? []).map((g) => [g.id, g]));

  const index =
    (await loadTpBairroIndex(INDEX_PATH)) ??
    ({
      version: '2',
      generated_at: new Date().toISOString(),
      provider: 'cep',
      stats: { total: 0, resolved: 0, resolved_cep: 0, failed: 0 },
      by_gym_id: {},
      failures: [],
    } satisfies TpBairroIndex);

  index.version = '2';
  index.provider = 'cep';

  const cepCache = await loadCepCache();
  const logradouroCache = await loadLogradouroCache();
  let entries = [...receitaMap.entries()];
  if (LIMIT > 0) entries = entries.slice(0, LIMIT);

  let ok = 0;
  let fail = 0;

  const recordFail = (gymId: string, lat: number, lng: number, error: string) => {
    index.failures = (index.failures ?? []).filter((f) => f.gym_id !== gymId);
    index.failures.push({
      gym_id: gymId,
      lat: Number.isFinite(lat) ? lat : 0,
      lng: Number.isFinite(lng) ? lng : 0,
      error,
    });
    fail += 1;
  };

  for (let i = 0; i < entries.length; i++) {
    const [tpId, hit] = entries[i]!;
    const gym = gymById.get(tpId);
    const lat = Number(gym?.attributes?.location?.lat);
    const lng = Number(gym?.attributes?.location?.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      recordFail(tpId, lat, lng, 'geo_missing');
      continue;
    }

    const name = gym?.attributes?.name ?? tpId.slice(0, 8);
    console.log(`[${i + 1}/${entries.length}] ${name} cep=${hit.cep}`);

    // Pula o rate-limit sleep quando o CEP da Receita já está resolvido em cache
    // (nenhuma chamada de rede acontece). CEP genérico -000 não cacheia como
    // bairro, então cai pro refinamento por logradouro e mantém o delay.
    const cepDigits = hit.cep?.replace(/\D/g, '') ?? null;
    const hadCache = Boolean(
      cepDigits && cepCache[`cep:${cepDigits}`] && 'bairro' in cepCache[`cep:${cepDigits}`]!,
    );

    try {
      const resolved = await resolveTpBairroViaCep({
        gymId: tpId,
        lat,
        lng,
        receitaHit: hit,
        cepCache,
        logradouroCache,
      });
      if (!resolved) {
        recordFail(tpId, lat, lng, 'cep_lookup_fail');
        console.warn('  FAIL cep_lookup_fail');
        continue;
      }

      index.by_gym_id[tpId] = resolved;
      index.failures = (index.failures ?? []).filter((f) => f.gym_id !== tpId);
      ok += 1;
      console.log(`  OK ${resolved.bairro} (${resolved.bairro_slug}) [${resolved.source}]`);
    } catch (err) {
      recordFail(tpId, lat, lng, err instanceof Error ? err.message : String(err));
      console.warn(`  ERRO: ${err instanceof Error ? err.message : err}`);
    }

    if (i < entries.length - 1 && !hadCache) await sleep(DELAY_MS);
  }

  const counts = countTpBairroIndex(index);
  index.stats = {
    total: counts.resolved_any + index.failures.length,
    resolved: counts.resolved_any,
    resolved_cep: counts.resolved_cep,
    failed: index.failures.length,
  };
  index.generated_at = new Date().toISOString();

  await saveCepCache(cepCache);
  await saveLogradouroCache(logradouroCache);
  await saveTpBairroIndex(INDEX_PATH, index);

  console.log('\n=== Resumo ===');
  console.log(`OK nesta rodada: ${ok} · Fail: ${fail}`);
  console.log(`Index resolved CEP: ${counts.resolved_cep} · legacy+CEP total: ${counts.resolved_any}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
