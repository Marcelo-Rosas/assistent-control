/**
 * Tipos canônicos do RPC public.match_chunks (pgvector hybrid).
 * Espelha supabase/functions/_shared/matchChunks.ts
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

/** Resultado após `boostByCityPrimary`. */
export type BoostedMatchChunk = MatchChunkResult & { _cityBoost?: boolean };

export type MatchChunksRpcArgs = {
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
