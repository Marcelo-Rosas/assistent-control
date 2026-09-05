/**
 * Dry-run / apply recoverable CLA-27 slice: receita alta + CEP fino com lookup fail.
 * npx tsx scripts/retry-cla27-recoverable.ts
 * npx tsx scripts/retry-cla27-recoverable.ts --apply
 * npx tsx scripts/retry-cla27-recoverable.ts --try-logradouro --apply
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
  lookupBairroFromCep,
  normalizeCep,
  refineCepViaLogradouro,
  saveCepCache,
  saveLogradouroCache,
} from './lib/tpCepResolver.ts';
import { loadTpReceitaCepMap } from './lib/tpReceitaCepMatch.ts';

const ROOT = process.cwd();
const INDEX_PATH = path.join(ROOT, 'data/processed/tp-bairro-index.json');
const INPUT_PATH = path.join(ROOT, 'data/raw/totalpass-brasil-all.json');
const ENRICH_DIR = path.join(ROOT, 'data/processed/totalpass-enriched/by-id');
const APPLY = process.argv.includes('--apply');
const TRY_LOG = process.argv.includes('--try-logradouro');
const DELAY_MS = Number(process.env.DELAY_MS || 1100);

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
  const beforeFailed = index.failures?.length ?? 0;
  const map = await loadTpReceitaCepMap();
  const raw = JSON.parse(await fs.readFile(INPUT_PATH, 'utf8')) as { data?: ListGym[] };
  const gymById = new Map((raw.data ?? []).map((g) => [g.id, g]));
  const cepCache = await loadCepCache();
  const logCache = await loadLogradouroCache();

  const candidates = (index.failures ?? [])
    .map((f) => f.gym_id)
    .filter((id) => {
      const hit = map.get(id);
      if (!hit?.cep) return false;
      const n = normalizeCep(hit.cep);
      return Boolean(n && !isCepGenerico(n));
    });

  console.log(
    `recoverable receita_fino=${candidates.length} apply=${APPLY} try_logradouro=${TRY_LOG} before_failures=${beforeFailed}\n`,
  );

  let ok = 0;
  let fail = 0;
  const results: Array<Record<string, unknown>> = [];

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
      `[${i + 1}/${candidates.length}] ${gym?.attributes?.name ?? gymId.slice(0, 8)} cep=${hit.cep} ${hit.municipio}/${hit.uf} log=${(hit.logradouro ?? '').slice(0, 40)}`,
    );

    // Probe raw CEP first (bypass poisoned cache by deleting key temporarily for diagnosis)
    const digits = normalizeCep(hit.cep)!;
    const cacheKey = `cep:${digits}`;
    const cached = cepCache[cacheKey];
    console.log(`  cache: ${cached ? JSON.stringify(cached).slice(0, 120) : 'miss'}`);

    const live = await lookupBairroFromCep(digits, { cache: {} });
    console.log(`  live_lookup: ${live ? `${live.bairro} (${live.provider})` : 'null'}`);

    let resolved = await resolveTpBairroViaCep({
      gymId,
      lat,
      lng,
      receitaHit: hit,
      listAddress: gym?.attributes?.full_address ?? null,
      detailAddress,
      cepCache,
      logradouroCache: logCache,
    });

    // Optional: if fine CEP dead, try F2.2-style logradouro refine (beyond generico)
    if ((!resolved || !isValidCepResolved(resolved)) && TRY_LOG && hit.logradouro && hit.uf && hit.municipio) {
      console.log('  trying logradouro refine despite non-generico CEP...');
      const refined = await refineCepViaLogradouro(
        {
          cep_rf: hit.cep,
          uf: hit.uf,
          municipio: hit.municipio,
          logradouro: hit.logradouro,
          tipo_logradouro: hit.tipo_logradouro,
          numero: hit.numero,
        },
        { cache: logCache },
      );
      console.log(`  refine: ${JSON.stringify(refined)}`);
      if (refined.ok) {
        const lookup = await lookupBairroFromCep(refined.cep, { cache: cepCache });
        if (lookup) {
          resolved = {
            bairro: lookup.bairro,
            bairro_slug: lookup.bairro_slug,
            cep: lookup.cep,
            cep_rf: hit.cep,
            source: 'receita_logradouro_cep',
            cnpj: hit.cnpj,
            lat,
            lng,
            provider: 'cep',
            resolved_at: lookup.resolved_at,
          };
        }
      }
    }

    if (resolved && isValidCepResolved(resolved)) {
      ok += 1;
      console.log(`  OK cep=${resolved.cep} ${resolved.bairro} (${resolved.source})`);
      results.push({ gymId, ok: true, cep: resolved.cep, bairro: resolved.bairro, source: resolved.source });
      if (APPLY) {
        index.failures = (index.failures ?? []).filter((f) => f.gym_id !== gymId);
        index.by_gym_id[gymId] = resolved;
      }
    } else {
      fail += 1;
      console.warn('  FAIL');
      results.push({ gymId, ok: false, cep: hit.cep });
    }

    if (i < candidates.length - 1) await sleep(DELAY_MS);
  }

  await saveCepCache(cepCache);
  await saveLogradouroCache(logCache);

  if (APPLY) {
    const counts = countTpBairroIndex(index);
    index.stats = {
      total: counts.resolved_any + counts.failed,
      resolved: counts.resolved_any,
      resolved_cep: counts.resolved_cep,
      failed: counts.failed,
    };
    index.generated_at = new Date().toISOString();
    await saveTpBairroIndex(INDEX_PATH, index);
    console.log(`\n=== Applied === OK:${ok} Fail:${fail} failures ${beforeFailed} → ${counts.failed}`);
  } else {
    console.log(`\n=== Dry-run === OK:${ok} Fail:${fail} (index untouched; failures still ${beforeFailed})`);
  }

  await fs.writeFile(
    path.join(ROOT, 'data/processed/tp-cep-cla27-recoverable-dryrun.json'),
    JSON.stringify({ apply: APPLY, try_logradouro: TRY_LOG, beforeFailed, ok, fail, results }, null, 2),
    'utf8',
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
