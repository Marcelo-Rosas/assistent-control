/**
 * Tipos + helper RPC para public.match_chunks (hybrid vector + FTS).
 * service_role only (migration 20260729).
 *
 * tenant_id: coluna em 20260726_rag_phase1.sql — isolamento JWT company_id + group_id.
 */

export type MatchChunkMeta = {
  cidade?: string;
  municipios_relacionados?: string[];
  modalidade?: string;
  modalidade_key?: string;
  bairro?: string;
  bairro_normalizado?: string;
  plano_minimo_rank?: number;
  nome_academia?: string;
  [key: string]: unknown;
};

export type MatchChunkResult = {
  chunk_id: string;
  chunk_type: string;
  text: string;
  meta: MatchChunkMeta | null;
  section_path: string | null;
  source_ref: string | null;
  similarity: number;
  score: number;
  /** Soft city boost flag (ask path pós-RPC). Ausente no retorno cru da RPC. */
  _cityBoost?: boolean;
};

/** Resultado após `boostByCityPrimary` (score possivelmente ajustado). */
export type BoostedMatchChunk = MatchChunkResult & { _cityBoost?: boolean };

export type MatchChunksParams = {
  query_embedding: number[];
  match_group_id: string;
  match_tenant_id?: string | null;
  match_modalidade?: string | null;
  match_bairro?: string | null;
  match_plano_rank?: number | null;
  match_municipio?: string | null;
  match_k?: number;
  min_similarity?: number;
  match_query?: string | null;
};

type RpcClient = {
  rpc: (
    fn: string,
    args: Record<string, unknown>,
  ) => PromiseLike<{ data: unknown; error: { message: string } | null }>;
};

function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
}

/**
 * Pós-RPC: prioriza meta.cidade (exact CI); fallback municipios_relacionados exact.
 * Hard cut — use em eval. Ask path prefer soft boostByCityPrimary.
 */
export function filterByCityPriority(
  chunks: MatchChunkResult[],
  expectedCity?: string | null,
): MatchChunkResult[] {
  const q = expectedCity?.trim();
  if (!q) return chunks;
  const qn = normalize(q);

  const primaryHits = chunks.filter((c) => {
    const cidade = typeof c.meta?.cidade === 'string' ? c.meta.cidade : '';
    return cidade.length > 0 && normalize(cidade) === qn;
  });
  if (primaryHits.length > 0) return primaryHits;

  return chunks.filter((c) => {
    const raw = c.meta?.municipios_relacionados;
    if (!Array.isArray(raw)) return false;
    return raw.some((m) => typeof m === 'string' && normalize(m) === qn);
  });
}

/** @deprecated use filterByCityPriority */
export const filterChunksByMunicipio = filterByCityPriority;

/** Boost aditivo no score quando meta.cidade === município (exact CI + NFD). Tunável. */
export const CITY_PRIMARY_BOOST = 0.08;

/**
 * Soft-rank pós-RPC: primary city sobe; related-only fica no set mas abaixo.
 * Não hard-cut. Score capped em 1.0. Sem municipio → identidade.
 */
export function boostByCityPrimary(
  chunks: MatchChunkResult[],
  targetMunicipio: string | null | undefined,
): BoostedMatchChunk[] {
  if (!targetMunicipio?.trim()) {
    return chunks.map((c) => ({ ...c, _cityBoost: false }));
  }
  const qn = normalize(targetMunicipio);

  return chunks
    .map((c) => {
      const chunkCity = typeof c.meta?.cidade === 'string' ? c.meta.cidade : '';
      const isPrimary = chunkCity.length > 0 && normalize(chunkCity) === qn;
      const base = Number(c.score ?? c.similarity ?? 0);
      return {
        ...c,
        score: isPrimary ? Math.min(base + CITY_PRIMARY_BOOST, 1.0) : base,
        _cityBoost: isPrimary,
      };
    })
    .sort((a, b) => {
      const ds = b.score - a.score;
      if (ds !== 0) return ds;
      return Number(b.similarity ?? 0) - Number(a.similarity ?? 0);
    });
}

export async function callMatchChunks(
  supabase: RpcClient,
  params: MatchChunksParams,
): Promise<{ data: MatchChunkResult[]; error: string | null }> {
  const args = {
    query_embedding: params.query_embedding,
    match_group_id: params.match_group_id,
    match_tenant_id: params.match_tenant_id ?? null,
    match_modalidade: params.match_modalidade ?? null,
    match_bairro: params.match_bairro ?? null,
    match_plano_rank: params.match_plano_rank ?? null,
    match_municipio: params.match_municipio ?? null,
    match_k: params.match_k ?? 15,
    min_similarity: params.min_similarity ?? 0.6,
    match_query: params.match_query ?? null,
  };

  console.log('[match_chunks]', {
    group: args.match_group_id,
    tenant: args.match_tenant_id,
    municipio: args.match_municipio,
    modalidade: args.match_modalidade,
    k: args.match_k,
    min_sim: args.min_similarity,
  });

  try {
    const { data, error } = await supabase.rpc('match_chunks', args);
    if (error) {
      console.error('[match_chunks] rpc_error', error.message);
      return { data: [], error: error.message };
    }
    const rows = Array.isArray(data) ? (data as MatchChunkResult[]) : [];
    console.log('[match_chunks] hits', rows.length);
    return { data: rows, error: null };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[match_chunks] exception', msg);
    return { data: [], error: msg };
  }
}
