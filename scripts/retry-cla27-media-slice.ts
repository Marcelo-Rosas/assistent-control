/**
 * CLA-27: retry residual failures with Receita match media/alta (incl. CEP).
 * Default dry-run. Use --apply to write index.
 *
 * npx tsx scripts/retry-cla27-media-slice.ts
 * npx tsx scripts/retry-cla27-media-slice.ts --apply
 * npx tsx scripts/retry-cla27-media-slice.ts --tiers=media --apply
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
  normalizeCep,
  saveCepCache,
  saveLogradouroCache,
} from './lib/tpCepResolver.ts';
import type { TpReceitaCepHit } from './lib/tpReceitaCepMatch.ts';

const ROOT = process.cwd();
const INDEX_PATH = path.join(ROOT, 'data/processed/tp-bairro-index.json');
const INPUT_PATH = path.join(ROOT, 'data/raw/totalpass-brasil-all.json');
const ENRICH_DIR = path.join(ROOT, 'data/processed/totalpass-enriched/by-id');
const MATCH_CSV = path.join(ROOT, 'data/processed/receita-x-totalpass-match.csv');
const RECEITA_CANDIDATES = [
  'data/processed/receita-cnae-wellness-principal-ativos.json',
  'data/processed/receita-cnae-9313100-principal-ativos.json',
];
const APPLY = process.argv.includes('--apply');
const DELAY_MS = Number(process.env.DELAY_MS || 1100);
const TIERS_ARG = process.argv.find((a) => a.startsWith('--tiers='))?.split('=')[1] ?? 'media,alta';
const ALLOWED_TIERS = new Set(TIERS_ARG.split(',').map((t) => t.trim()).filter(Boolean));

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

function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i]!;
    if (c === '"') {
      inQ = !inQ;
      continue;
    }
    if (c === ',' && !inQ) {
      out.push(cur);
      cur = '';
      continue;
    }
    cur += c;
  }
  out.push(cur);
  return out;
}

async function loadReceitaByCnpj(): Promise<
  Map<string, { cep?: string; logradouro?: string; uf?: string; municipio?: string; tipo_logradouro?: string; numero?: string }>
> {
  for (const rel of RECEITA_CANDIDATES) {
    try {
      const raw = JSON.parse(await fs.readFile(path.join(ROOT, rel), 'utf8')) as Array<Record<string, unknown>>;
      const map = new Map<
        string,
        { cep?: string; logradouro?: string; uf?: string; municipio?: string; tipo_logradouro?: string; numero?: string }
      >();
      for (const r of raw) {
        const cnpj = String(r.cnpj ?? '').replace(/\D/g, '');
        if (cnpj.length === 14) {
          map.set(cnpj, {
            cep: String(r.cep ?? ''),
            logradouro: String(r.logradouro ?? ''),
            uf: String(r.uf ?? ''),
            municipio: String(r.municipio ?? r.city ?? ''),
            tipo_logradouro: String(r.tipo_logradouro ?? ''),
            numero: String(r.numero ?? ''),
          });
        }
      }
      if (map.size) return map;
    } catch {
      /* next */
    }
  }
  return new Map();
}

async function loadHitsForFailures(
  failIds: Set<string>,
): Promise<Map<string, TpReceitaCepHit & { tier: string; method: string }>> {
  const receita = await loadReceitaByCnpj();
  const csv = await fs.readFile(MATCH_CSV, 'utf8');
  const lines = csv.split(/\r?\n/).filter(Boolean);
  const header = parseCsvLine(lines[0]!);
  const idx = (n: string) => header.indexOf(n);
  const tierRank: Record<string, number> = { alta: 3, media: 2, baixa: 1 };
  const out = new Map<string, TpReceitaCepHit & { tier: string; method: string }>();

  for (const line of lines.slice(1)) {
    const cols = parseCsvLine(line);
    if (cols[idx('match')] !== '1') continue;
    const tier = cols[idx('tier')]?.trim() || '';
    if (!ALLOWED_TIERS.has(tier)) continue;
    const tpId = cols[idx('tp_id')]?.trim();
    if (!tpId || !failIds.has(tpId)) continue;
    const cnpj = cols[idx('cnpj')]?.replace(/\D/g, '') ?? '';
    if (cnpj.length !== 14) continue;
    const rf = receita.get(cnpj);
    const cep = normalizeCep(String(rf?.cep ?? ''));
    if (!cep) continue;

    const hit = {
      tp_id: tpId,
      cnpj,
      cep,
      uf: String(cols[idx('uf')] ?? rf?.uf ?? '').trim().toUpperCase(),
      municipio: String(cols[idx('city')] ?? rf?.municipio ?? '').trim(),
      tipo_logradouro: rf?.tipo_logradouro,
      logradouro: String(rf?.logradouro ?? '').trim(),
      numero: rf?.numero,
      tp_name: cols[idx('tp_name')] ?? null,
      method: cols[idx('method')]?.trim() || null,
      tier,
    };

    const prev = out.get(tpId);
    if (!prev || (tierRank[tier] ?? 0) > (tierRank[prev.tier] ?? 0)) {
      out.set(tpId, { ...hit, method: hit.method ?? '' });
    }
  }
  return out;
}

async function main() {
  const index = (await loadTpBairroIndex(INDEX_PATH))!;
  const beforeFailed = index.failures?.length ?? 0;
  const beforeResolvedCep = countTpBairroIndex(index).resolved_cep;
  const failIds = new Set((index.failures ?? []).map((f) => f.gym_id));
  const hits = await loadHitsForFailures(failIds);

  const raw = JSON.parse(await fs.readFile(INPUT_PATH, 'utf8')) as { data?: ListGym[] };
  const gymById = new Map((raw.data ?? []).map((g) => [g.id, g]));
  const cepCache = await loadCepCache();
  const logCache = await loadLogradouroCache();

  const candidates = [...hits.entries()];
  const gen = candidates.filter(([, h]) => isCepGenerico(h.cep)).length;
  const fino = candidates.length - gen;

  console.log(
    `CLA-27 media/alta residual slice · tiers=${[...ALLOWED_TIERS].join(',')} · n=${candidates.length} (generico=${gen} fino=${fino}) · apply=${APPLY} · before_failures=${beforeFailed}\n`,
  );

  let ok = 0;
  let fail = 0;
  const bySource: Record<string, number> = {};
  const results: Array<Record<string, unknown>> = [];

  for (let i = 0; i < candidates.length; i++) {
    const [gymId, hit] = candidates[i]!;
    const gym = gymById.get(gymId);
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
      `[${i + 1}/${candidates.length}] ${gym?.attributes?.name ?? gymId.slice(0, 8)} tier=${hit.tier} cep=${hit.cep} ${hit.municipio}/${hit.uf} gen=${isCepGenerico(hit.cep)}`,
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
      bySource[resolved.source] = (bySource[resolved.source] ?? 0) + 1;
      const flag = resolved.cep_geral ? ' CEP_GERAL' : '';
      console.log(`  OK cep=${resolved.cep} ${resolved.bairro} (${resolved.source})${flag}`);
      results.push({
        gymId,
        ok: true,
        tier: hit.tier,
        source: resolved.source,
        cep: resolved.cep,
        bairro: resolved.bairro,
        cep_geral: Boolean(resolved.cep_geral),
      });
      if (APPLY) {
        index.failures = (index.failures ?? []).filter((f) => f.gym_id !== gymId);
        index.by_gym_id[gymId] = resolved;
      }
    } else {
      fail += 1;
      console.warn('  FAIL');
      results.push({ gymId, ok: false, tier: hit.tier, cep: hit.cep });
    }

    if (i < candidates.length - 1) await sleep(DELAY_MS);
  }

  await saveCepCache(cepCache);
  await saveLogradouroCache(logCache);

  let afterFailed = beforeFailed;
  let afterResolvedCep = beforeResolvedCep;
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
    afterFailed = counts.failed;
    afterResolvedCep = counts.resolved_cep;
  }

  const summary = {
    apply: APPLY,
    tiers: [...ALLOWED_TIERS],
    before: { failures: beforeFailed, resolved_cep: beforeResolvedCep },
    after: { failures: afterFailed, resolved_cep: afterResolvedCep },
    ok,
    fail,
    bySource,
    results,
  };
  await fs.writeFile(
    path.join(ROOT, 'data/processed/tp-cep-cla27-media-slice.json'),
    JSON.stringify(summary, null, 2),
    'utf8',
  );

  console.log(`\n=== ${APPLY ? 'Applied' : 'Dry-run'} === OK:${ok} Fail:${fail}`);
  console.log(`failures ${beforeFailed} → ${afterFailed}`);
  console.log(`resolved_cep ${beforeResolvedCep} → ${afterResolvedCep}`);
  console.log('bySource', bySource);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
