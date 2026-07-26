-- RAG Phase 1 TotalPass — hybrid match_chunks + document_version + meta indexes
-- Idempotent on top of 20260726_rag_phase1/phase2. Zero hardcoded tenant UUIDs.
-- Dim embedding: vector(1024). Tenant: NULL = global.

create extension if not exists vector;

alter table public.eros_knowledge_chunks
  add column if not exists tenant_id uuid,
  add column if not exists document_id uuid,
  add column if not exists section_path text,
  add column if not exists content_hash text,
  add column if not exists embedding_model text,
  add column if not exists embedding_version text,
  add column if not exists access_level text default 'public',
  add column if not exists document_version text,
  add column if not exists embedding vector(1024);

-- Default access_level → public (TP catalog); keep existing rows unless null
alter table public.eros_knowledge_chunks
  alter column access_level set default 'public';

update public.eros_knowledge_chunks
set access_level = 'public'
where access_level is null;

-- Dynamic backfill: mirror group.company_id (no fixed UUID)
update public.eros_knowledge_chunks c
set tenant_id = g.company_id
from public.eros_knowledge_groups g
where g.id = c.group_id
  and c.tenant_id is null
  and g.company_id is not null;

-- tenant_id stays nullable (global chunks)
comment on column public.eros_knowledge_chunks.tenant_id is
  'Mirrors eros_knowledge_groups.company_id; NULL = global/shared.';

comment on column public.eros_knowledge_chunks.document_version is
  'Ingest batch version (e.g. YYYY-MM-DD); not a tenant UUID.';

-- Indexes (HNSW may already exist as eros_knowledge_chunks_embedding_hnsw_idx)
create index if not exists eros_knowledge_chunks_embedding_idx
  on public.eros_knowledge_chunks using hnsw (embedding vector_cosine_ops);

create index if not exists eros_knowledge_chunks_tenant_idx
  on public.eros_knowledge_chunks (tenant_id);

create index if not exists eros_knowledge_chunks_group_tenant_idx
  on public.eros_knowledge_chunks (group_id, tenant_id);

create index if not exists eros_knowledge_chunks_content_hash_idx
  on public.eros_knowledge_chunks (group_id, content_hash);

-- text expression → btree (GIN has no default opclass for text)
create index if not exists eros_knowledge_chunks_meta_modalidade_idx
  on public.eros_knowledge_chunks ((meta->>'modalidade'));

-- jsonb array → GIN for `?` on modalidades_secundarias
create index if not exists eros_knowledge_chunks_meta_modalidades_sec_gin_idx
  on public.eros_knowledge_chunks using gin ((meta->'modalidades_secundarias'));

create table if not exists public.eros_embedding_models (
  id uuid primary key default gen_random_uuid(),
  model text not null,
  version text not null,
  dimension int not null,
  created_at timestamptz default now(),
  unique (model, version)
);

-- Replace prior match_chunks (score-only) with hybrid filters + similarity
drop function if exists public.match_chunks(vector, uuid, uuid, integer, double precision);
drop function if exists public.match_chunks(vector, uuid, uuid, text, text, integer, integer, double precision);
drop function if exists public.match_chunks(vector, uuid, uuid, text, text, integer, integer, real);

create or replace function public.match_chunks(
  query_embedding vector(1024),
  match_group_id uuid,
  match_tenant_id uuid default null,
  match_modalidade text default null,
  match_bairro text default null,
  match_plano_rank integer default null,
  match_k integer default 15,
  min_similarity double precision default 0.6
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
begin
  return query
  select
    c.chunk_id,
    c.chunk_type,
    c.text,
    c.meta,
    c.section_path,
    c.source_ref,
    (1 - (c.embedding <=> query_embedding))::double precision as similarity,
    (1 - (c.embedding <=> query_embedding))::double precision as score
  from public.eros_knowledge_chunks c
  where c.group_id = match_group_id
    and (
      match_tenant_id is null
      or c.tenant_id = match_tenant_id
      or c.tenant_id is null
    )
    and (
      match_modalidade is null
      or c.meta->>'modalidade' = match_modalidade
      or (c.meta->'modalidades_secundarias') ? match_modalidade
    )
    and (
      match_bairro is null
      or c.meta->>'bairro_normalizado' = match_bairro
    )
    and (
      match_plano_rank is null
      or coalesce((c.meta->>'plano_minimo_rank')::int, 99) <= match_plano_rank
    )
    and c.embedding is not null
    and (1 - (c.embedding <=> query_embedding)) >= min_similarity
  order by c.embedding <=> query_embedding
  limit greatest(1, least(coalesce(match_k, 15), 50));
end;
$$;

revoke all on function public.match_chunks(
  vector, uuid, uuid, text, text, integer, integer, double precision
) from public;
grant execute on function public.match_chunks(
  vector, uuid, uuid, text, text, integer, integer, double precision
) to service_role;
grant execute on function public.match_chunks(
  vector, uuid, uuid, text, text, integer, integer, double precision
) to authenticated;
