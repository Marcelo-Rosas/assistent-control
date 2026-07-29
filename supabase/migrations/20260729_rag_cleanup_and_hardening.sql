-- Consolidation: cleanup redundant indexes + strict index-friendly match_chunks
-- + FTS @@ so GIN is used + RLS on chunks + least-privilege on RPC.
-- Canonical function body supersedes 20260728 higienize/strict_mun/cidade.

-- ---------------------------------------------------------------------------
-- 1) Drop redundant / superseded indexes
-- ---------------------------------------------------------------------------

-- Duplicate HNSW (phase1_totalpass); keep one partial below
drop index if exists public.eros_knowledge_chunks_embedding_idx;

-- Non-partial HNSW → recreate partial (embedding IS NOT NULL only)
drop index if exists public.eros_knowledge_chunks_embedding_hnsw_idx;

-- Tenant solo covered by (group_id, tenant_id) for group-scoped queries
drop index if exists public.eros_knowledge_chunks_tenant_idx;

-- group_id alone covered by composite (group_id, tenant_id) leftmost prefix
drop index if exists public.eros_knowledge_chunks_group_idx;

-- Non-unique (group_id, content_hash) covered by unique constraint
drop index if exists public.eros_knowledge_chunks_content_hash_idx;

-- Legacy partial unique (superseded by eros_knowledge_chunks_group_hash_key)
drop index if exists public.eros_knowledge_chunks_group_hash_uniq;
drop index if exists public.eros_knowledge_chunks_group_hash_unique_idx;

-- City: keep only (group_id, lower(cidade)); drop siblings
drop index if exists public.eros_knowledge_chunks_meta_cidade_idx;
drop index if exists public.eros_chunks_group_cidade_idx;

-- Muns GIN: keep eros_knowledge_chunks_meta_municipios_gin_idx; drop duplicate
drop index if exists public.eros_chunks_group_muns_gin_idx;

-- ---------------------------------------------------------------------------
-- 2) Recreate / ensure index-friendly indexes
-- ---------------------------------------------------------------------------

create index if not exists eros_knowledge_chunks_embedding_hnsw_idx
  on public.eros_knowledge_chunks
  using hnsw (embedding vector_cosine_ops)
  where embedding is not null;

create index if not exists eros_chunks_group_cidade_lower_idx
  on public.eros_knowledge_chunks (group_id, (lower(meta->>'cidade')));

create index if not exists eros_knowledge_chunks_meta_municipios_gin_idx
  on public.eros_knowledge_chunks
  using gin ((meta->'municipios_relacionados'));

create index if not exists eros_knowledge_chunks_text_fts_idx
  on public.eros_knowledge_chunks
  using gin (to_tsvector('portuguese', coalesce(text, '')));

create index if not exists eros_knowledge_chunks_group_tenant_idx
  on public.eros_knowledge_chunks (group_id, tenant_id);

-- FK index missing on urls.group_id
create index if not exists eros_knowledge_urls_group_idx
  on public.eros_knowledge_urls (group_id);

-- ---------------------------------------------------------------------------
-- 3) match_chunks — strict municipio + FTS @@ + bai_norm
-- ---------------------------------------------------------------------------

drop function if exists public.match_chunks(
  vector, uuid, uuid, text, text, integer, text, integer, double precision, text
);

create or replace function public.match_chunks(
  query_embedding vector(1024),
  match_group_id uuid,
  match_tenant_id uuid default null,
  match_modalidade text default null,
  match_bairro text default null,
  match_plano_rank integer default null,
  match_municipio text default null,
  match_k integer default 15,
  min_similarity double precision default 0.6,
  match_query text default null
)
returns table (
  chunk_id text,
  chunk_type text,
  text text,
  meta jsonb,
  section_path text,
  source_ref text,
  similarity double precision,
  score double precision
)
language plpgsql
stable
as $$
declare
  mun_norm text := nullif(trim(match_municipio), '');
  mod_norm text := nullif(trim(match_modalidade), '');
  bai_norm text := nullif(trim(match_bairro), '');
  q_norm text := nullif(trim(match_query), '');
  tsq tsquery := null;
begin
  if q_norm is not null then
    tsq := plainto_tsquery('portuguese', q_norm);
  end if;

  return query
  with candidates as (
    select
      c.chunk_id,
      c.chunk_type,
      c.text,
      c.meta,
      c.section_path,
      c.source_ref,
      (1 - (c.embedding <=> query_embedding))::double precision as sim,
      case
        when tsq is null then 0::double precision
        else ts_rank(
          to_tsvector('portuguese', coalesce(c.text, '')),
          tsq
        )::double precision
      end as fts_rank
    from public.eros_knowledge_chunks c
    where c.group_id = match_group_id
      and c.embedding is not null
      and (1 - (c.embedding <=> query_embedding)) >= min_similarity

      -- FTS is score boost only (not a hard gate) — preserves vector-only recall.
      -- GIN eros_knowledge_chunks_text_fts_idx ready for future lexical-only paths.

      and (
        match_tenant_id is null
        or c.tenant_id = match_tenant_id
        or c.tenant_id is null
      )

      and (
        mod_norm is null
        or c.meta->>'modalidade' ilike '%' || mod_norm || '%'
        or lower(coalesce(c.meta->>'modalidade_key', '')) like '%' || lower(mod_norm) || '%'
        or (c.meta->'modalidades_secundarias') ? mod_norm
      )

      and (
        bai_norm is null
        or c.meta->>'bairro_normalizado' = bai_norm
      )

      and (
        match_plano_rank is null
        or coalesce((c.meta->>'plano_minimo_rank')::int, 99) <= match_plano_rank
      )

      -- Strict + index-friendly municipio (no LIKE wildcards)
      and (
        mun_norm is null
        or lower(c.meta->>'cidade') = lower(mun_norm)
        or (c.meta->'municipios_relacionados') ? mun_norm
        or exists (
          select 1
          from jsonb_array_elements_text(
            coalesce(c.meta->'municipios_relacionados', '[]'::jsonb)
          ) x(m)
          where lower(x.m) = lower(mun_norm)
        )
      )
  )
  select
    cand.chunk_id,
    cand.chunk_type,
    cand.text,
    cand.meta,
    cand.section_path,
    cand.source_ref,
    cand.sim as similarity,
    case
      when tsq is null then cand.sim
      else (0.7 * cand.sim + 0.3 * (cand.fts_rank / (cand.fts_rank + 1.0)))::double precision
    end as score
  from candidates cand
  order by
    case
      when tsq is null then cand.sim
      else (0.7 * cand.sim + 0.3 * (cand.fts_rank / (cand.fts_rank + 1.0)))
    end desc,
    cand.sim desc
  limit greatest(1, least(coalesce(match_k, 15), 50));
end;
$$;

-- Least privilege: edge + scripts use service_role only
revoke all on function public.match_chunks(
  vector, uuid, uuid, text, text, integer, text, integer, double precision, text
) from public;

revoke all on function public.match_chunks(
  vector, uuid, uuid, text, text, integer, text, integer, double precision, text
) from authenticated;

revoke all on function public.match_chunks(
  vector, uuid, uuid, text, text, integer, text, integer, double precision, text
) from anon;

grant execute on function public.match_chunks(
  vector, uuid, uuid, text, text, integer, text, integer, double precision, text
) to service_role;

comment on function public.match_chunks(
  vector, uuid, uuid, text, text, integer, text, integer, double precision, text
) is
  'Hybrid retrieval (service_role only). Municipio: lower(cidade)= OR muns ?/CI. FTS boosts score when match_query set (not a hard gate). Score=0.7*sim+0.3*fts_norm.';

-- ---------------------------------------------------------------------------
-- 4) RLS on chunks (service_role bypasses; UI groups/urls/files untouched)
-- ---------------------------------------------------------------------------

alter table public.eros_knowledge_chunks enable row level security;

-- Drop prior policies if re-applied
drop policy if exists eros_knowledge_chunks_authenticated_all
  on public.eros_knowledge_chunks;

-- Authenticated: global (tenant null) OR own company via JWT app_metadata.company_id
-- Wrap auth.jwt() in SELECT for once-per-query eval (RLS performance)
create policy eros_knowledge_chunks_authenticated_all
  on public.eros_knowledge_chunks
  for all
  to authenticated
  using (
    tenant_id is null
    or tenant_id = (
      select nullif(
        (auth.jwt() -> 'app_metadata' ->> 'company_id'),
        ''
      )::uuid
    )
  )
  with check (
    tenant_id is null
    or tenant_id = (
      select nullif(
        (auth.jwt() -> 'app_metadata' ->> 'company_id'),
        ''
      )::uuid
    )
  );

-- anon: no policy → deny direct table access
-- service_role: bypasses RLS

comment on table public.eros_knowledge_chunks is
  'RAG chunks. RLS on. service_role bypass. authenticated: tenant_id null OR jwt app_metadata.company_id. match_chunks = service_role only.';
