/**
 * Eval A/B — City Boost (sem boost vs boostByCityPrimary).
 *
 * NÃO altera RPC match_chunks / ingest / embeddings.
 * Mesma chamada RPC; só pós-processamento muda.
 *
 * Dataset: data/samples/evaluation.json
 * Output:  data/evaluation/city_boost_eval_results.json
 *
 * Run: npm run eval:city-boost
 * Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, GURUPASS_GROUP_ID
 *      OLLAMA_BASE_URL, EMBEDDING_MODEL, EMBEDDING_DIMENSION
 *      EVAL_TOP_K (default 15), EVAL_MIN_SIM (default 0.35)
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import {
  boostByCityPrimary,
  CITY_PRIMARY_BOOST,
  callMatchChunks,
  type MatchChunkResult,
} from '../supabase/functions/_shared/matchChunks.ts';
import { extractQueryFilters } from '../supabase/functions/_shared/queryFilters.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATASET_PATH =
  process.env.EVAL_DATASET || path.join(ROOT, 'data/samples/evaluation.json');
const OUT_PATH =
  process.env.EVAL_OUT ||
  path.join(ROOT, 'data/evaluation/city_boost_eval_results.json');

type EvalItem = {
  id: string;
  query: string;
  expected_municipio: string;
  expected_modalidade?: string | null;
  expected_academia_keywords?: string[];
  description?: string;
};

type RankRow = {
  rank: number;
  chunk_id: string;
  cidade: string | null;
  nome: string | null;
  score: number;
  similarity: number;
  is_primary: boolean;
  _cityBoost?: boolean;
};

function loadDotEnv(filePath: string): void {
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) return;
  for (const line of fs.readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) continue;
    const eq = trimmed.indexOf('=');
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    const hashIdx = val.search(/\s+#/);
    if (hashIdx >= 0) val = val.slice(0, hashIdx).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = val;
  }
}

function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
}

function isPrimaryCity(
  chunk: MatchChunkResult,
  municipio: string,
): boolean {
  const cidade =
    typeof chunk.meta?.cidade === 'string' ? chunk.meta.cidade : '';
  return cidade.length > 0 && normalize(cidade) === normalize(municipio);
}

function firstPrimaryRank(
  ranked: MatchChunkResult[],
  municipio: string,
): number | null {
  for (let i = 0; i < ranked.length; i++) {
    if (isPrimaryCity(ranked[i], municipio)) return i + 1;
  }
  return null;
}

function primaryAtK(
  ranked: MatchChunkResult[],
  municipio: string,
  k: number,
): boolean {
  return ranked.slice(0, k).some((c) => isPrimaryCity(c, municipio));
}

function keywordHit(
  ranked: MatchChunkResult[],
  keywords: string[],
  k = 5,
): boolean {
  if (!keywords.length) return true;
  const blob = ranked
    .slice(0, k)
    .map((c) =>
      normalize(
        [
          c.text,
          c.meta?.nome_academia,
          c.meta?.cidade,
          JSON.stringify(c.meta ?? {}),
        ]
          .filter(Boolean)
          .join(' '),
      ),
    )
    .join(' ');
  return keywords.some((kw) => blob.includes(normalize(kw)));
}

function toRows(
  ranked: MatchChunkResult[],
  municipio: string,
  top = 5,
): RankRow[] {
  return ranked.slice(0, top).map((c, i) => ({
    rank: i + 1,
    chunk_id: c.chunk_id,
    cidade: typeof c.meta?.cidade === 'string' ? c.meta.cidade : null,
    nome:
      typeof c.meta?.nome_academia === 'string' ? c.meta.nome_academia : null,
    score: Number(c.score ?? c.similarity ?? 0),
    similarity: Number(c.similarity ?? 0),
    is_primary: isPrimaryCity(c, municipio),
    _cityBoost: Boolean((c as { _cityBoost?: boolean })._cityBoost),
  }));
}

async function embedQuery(text: string): Promise<number[]> {
  const provider = (process.env.EMBEDDING_PROVIDER || 'ollama').toLowerCase();
  const model = process.env.EMBEDDING_MODEL || 'mxbai-embed-large';
  const dim = Number(process.env.EMBEDDING_DIMENSION || 1024);
  const ollamaBase = (
    process.env.OLLAMA_BASE_URL || 'https://ollama2.vectracargo.com.br'
  )
    .replace(/\/$/, '')
    .replace(/\/v1$/, '');

  if (provider !== 'ollama') {
    throw new Error(`eval-city-boost: só ollama local/túnel (got ${provider})`);
  }

  const input = text.slice(0, Number(process.env.OLLAMA_EMBED_MAX_CHARS || 800));

  // Prefer OpenAI-compat (mesmo path dos notebooks / edge)
  const resV1 = await fetch(`${ollamaBase}/v1/embeddings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, input }),
  });
  if (resV1.ok) {
    const data = (await resV1.json()) as {
      data?: Array<{ embedding: number[] }>;
    };
    const vec = data.data?.[0]?.embedding;
    if (!vec?.length) throw new Error('ollama_v1_embed_empty');
    if (dim > 0 && vec.length !== dim) {
      throw new Error(`dim_mismatch got=${vec.length} expected=${dim}`);
    }
    return vec;
  }
  const v1Err = await resV1.text();

  const res = await fetch(`${ollamaBase}/api/embeddings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, prompt: input }),
  });
  if (!res.ok) {
    throw new Error(
      `ollama_embed_http_${res.status}: v1=${v1Err} native=${await res.text()}`,
    );
  }
  const data = (await res.json()) as { embedding?: number[] };
  const vec = data.embedding;
  if (!vec?.length) throw new Error('ollama_embed_empty');
  if (dim > 0 && vec.length !== dim) {
    throw new Error(`dim_mismatch got=${vec.length} expected=${dim}`);
  }
  return vec;
}

async function main(): Promise<void> {
  loadDotEnv(path.join(ROOT, '.env'));
  loadDotEnv(path.join(ROOT, '.env.local'));

  const supabaseUrl =
    process.env.SUPABASE_URL?.trim() ||
    process.env.VITE_SUPABASE_URL?.trim() ||
    '';
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() || '';
  const groupId =
    process.env.GURUPASS_GROUP_ID?.trim() ||
    '4d1e2c40-217b-4a39-bc08-f9c3e90fd803';

  if (!supabaseUrl || !supabaseKey) {
    console.error('Defina SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY');
    process.exit(1);
  }
  if (!fs.existsSync(DATASET_PATH)) {
    console.error(`Dataset ausente: ${DATASET_PATH}`);
    process.exit(1);
  }

  const dataset = JSON.parse(
    fs.readFileSync(DATASET_PATH, 'utf8'),
  ) as EvalItem[];
  if (!Array.isArray(dataset) || dataset.length === 0) {
    console.error('evaluation.json vazio');
    process.exit(1);
  }

  const topK = Number(process.env.EVAL_TOP_K || 15);
  const minSim = Number(process.env.EVAL_MIN_SIM || 0.35);
  const supabase = createClient(supabaseUrl, supabaseKey);

  console.log('Eval City Boost A/B\n');
  console.log(`dataset=${path.relative(ROOT, DATASET_PATH)} n=${dataset.length}`);
  console.log(`group=${groupId} top_k=${topK} min_sim=${minSim}`);
  console.log(`CITY_PRIMARY_BOOST=${CITY_PRIMARY_BOOST}\n`);

  const results: Array<Record<string, unknown>> = [];

  let primaryAt1Base = 0;
  let primaryAt1Boost = 0;
  let primaryAt3Base = 0;
  let primaryAt3Boost = 0;
  let primaryAt5Base = 0;
  let primaryAt5Boost = 0;
  let mrrBase = 0;
  let mrrBoost = 0;
  let improved = 0;
  let worsened = 0;
  let unchanged = 0;
  let kwBase = 0;
  let kwBoost = 0;

  for (const item of dataset) {
    const filters = extractQueryFilters(item.query, {
      municipio: item.expected_municipio,
      modalidade: item.expected_modalidade ?? null,
    });
    const municipio = filters.municipio || item.expected_municipio;

    process.stdout.write(`[${item.id}] embed+rpc… `);
    const embedding = await embedQuery(item.query);
    const { data: matched, error } = await callMatchChunks(supabase, {
      query_embedding: embedding,
      match_group_id: groupId,
      match_tenant_id: null,
      match_modalidade: filters.modalidade,
      match_bairro: null,
      match_plano_rank: null,
      match_municipio: municipio,
      match_k: topK,
      min_similarity: minSim,
      match_query: item.query,
    });

    if (error) {
      console.log(`RPC ERR ${error}`);
      results.push({
        id: item.id,
        query: item.query,
        error,
      });
      continue;
    }

    // Sem boost: ordem RPC (score/similarity já vêm ranqueados)
    const baseline = [...matched].sort((a, b) => {
      const ds = Number(b.score ?? b.similarity ?? 0) - Number(a.score ?? a.similarity ?? 0);
      if (ds !== 0) return ds;
      return Number(b.similarity ?? 0) - Number(a.similarity ?? 0);
    });
    const boosted = boostByCityPrimary(matched, municipio);

    const rBase = firstPrimaryRank(baseline, municipio);
    const rBoost = firstPrimaryRank(boosted, municipio);
    const p1b = primaryAtK(baseline, municipio, 1);
    const p1x = primaryAtK(boosted, municipio, 1);
    const p3b = primaryAtK(baseline, municipio, 3);
    const p3x = primaryAtK(boosted, municipio, 3);
    const p5b = primaryAtK(baseline, municipio, 5);
    const p5x = primaryAtK(boosted, municipio, 5);
    const mrrB = rBase ? 1 / rBase : 0;
    const mrrX = rBoost ? 1 / rBoost : 0;
    const kwB = keywordHit(baseline, item.expected_academia_keywords ?? []);
    const kwX = keywordHit(boosted, item.expected_academia_keywords ?? []);

    if (p1b) primaryAt1Base += 1;
    if (p1x) primaryAt1Boost += 1;
    if (p3b) primaryAt3Base += 1;
    if (p3x) primaryAt3Boost += 1;
    if (p5b) primaryAt5Base += 1;
    if (p5x) primaryAt5Boost += 1;
    mrrBase += mrrB;
    mrrBoost += mrrX;
    if (kwB) kwBase += 1;
    if (kwX) kwBoost += 1;

    const deltaRank =
      rBase != null && rBoost != null
        ? rBase - rBoost
        : rBase == null && rBoost != null
          ? 99
          : rBase != null && rBoost == null
            ? -99
            : 0;
    if (deltaRank > 0) improved += 1;
    else if (deltaRank < 0) worsened += 1;
    else unchanged += 1;

    const row = {
      id: item.id,
      query: item.query,
      expected_municipio: item.expected_municipio,
      filters,
      hits: matched.length,
      baseline: {
        primary_at_1: p1b,
        primary_at_3: p3b,
        primary_at_5: p5b,
        first_primary_rank: rBase,
        mrr_primary: mrrB,
        keyword_hit_at_5: kwB,
        top5: toRows(baseline, municipio, 5),
      },
      boosted: {
        primary_at_1: p1x,
        primary_at_3: p3x,
        primary_at_5: p5x,
        first_primary_rank: rBoost,
        mrr_primary: mrrX,
        keyword_hit_at_5: kwX,
        top5: toRows(boosted, municipio, 5),
      },
      delta_primary_rank: deltaRank,
      improved: deltaRank > 0,
    };
    results.push(row);

    console.log(
      `hits=${matched.length} primary@1 ${p1b ? 'Y' : 'N'}→${p1x ? 'Y' : 'N'} ` +
        `rank ${rBase ?? '—'}→${rBoost ?? '—'} Δ=${deltaRank}`,
    );
  }

  const n = results.filter((r) => !('error' in r && r.error)).length || 1;
  const summary = {
    n_queries: dataset.length,
    n_ok: n,
    CITY_PRIMARY_BOOST,
    baseline: {
      primary_at_1: primaryAt1Base / n,
      primary_at_3: primaryAt3Base / n,
      primary_at_5: primaryAt5Base / n,
      mrr_primary: mrrBase / n,
      keyword_hit_at_5: kwBase / n,
    },
    boosted: {
      primary_at_1: primaryAt1Boost / n,
      primary_at_3: primaryAt3Boost / n,
      primary_at_5: primaryAt5Boost / n,
      mrr_primary: mrrBoost / n,
      keyword_hit_at_5: kwBoost / n,
    },
    deltas: {
      primary_at_1:
        primaryAt1Boost / n - primaryAt1Base / n,
      primary_at_3:
        primaryAt3Boost / n - primaryAt3Base / n,
      primary_at_5:
        primaryAt5Boost / n - primaryAt5Base / n,
      mrr_primary: mrrBoost / n - mrrBase / n,
      queries_improved: improved,
      queries_worsened: worsened,
      queries_unchanged: unchanged,
    },
    recommendation:
      primaryAt1Boost / n - primaryAt1Base / n >= 0.05 ||
      mrrBoost / n - mrrBase / n >= 0.05
        ? `Manter CITY_PRIMARY_BOOST=${CITY_PRIMARY_BOOST} (ganho claro)`
        : primaryAt1Boost === primaryAt1Base && mrrBoost === mrrBase
          ? `Boost neutro neste dataset — testar valor > ${CITY_PRIMARY_BOOST} ou hard filter`
          : `Revisar boost (piora ou ganho marginal)`,
  };

  const report = {
    timestamp: new Date().toISOString(),
    group_id: groupId,
    dataset: path.relative(ROOT, DATASET_PATH).replace(/\\/g, '/'),
    top_k: topK,
    min_similarity: minSim,
    summary,
    results,
  };

  fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
  fs.writeFileSync(OUT_PATH, JSON.stringify(report, null, 2), 'utf8');

  console.log('\n=== Summary ===');
  console.log(
    `primary@1  baseline=${(summary.baseline.primary_at_1 * 100).toFixed(0)}%  boosted=${(summary.boosted.primary_at_1 * 100).toFixed(0)}%  Δ=${(summary.deltas.primary_at_1 * 100).toFixed(0)}pp`,
  );
  console.log(
    `primary@3  baseline=${(summary.baseline.primary_at_3 * 100).toFixed(0)}%  boosted=${(summary.boosted.primary_at_3 * 100).toFixed(0)}%  Δ=${(summary.deltas.primary_at_3 * 100).toFixed(0)}pp`,
  );
  console.log(
    `MRR(prim)  baseline=${summary.baseline.mrr_primary.toFixed(3)}  boosted=${summary.boosted.mrr_primary.toFixed(3)}  Δ=${summary.deltas.mrr_primary.toFixed(3)}`,
  );
  console.log(
    `rank Δ: improved=${improved} worsened=${worsened} unchanged=${unchanged}`,
  );
  console.log(`\n${summary.recommendation}`);
  console.log(`\nSaved ${path.relative(ROOT, OUT_PATH)}`);
}

main().catch((err) => {
  console.error('Erro fatal:', err);
  process.exit(1);
});
