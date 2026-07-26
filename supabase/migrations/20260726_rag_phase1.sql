-- RAG convergence Phase 1: pgvector(1024) + tenant mirror + match_chunks
-- Dimension 1024: voyage-4-large, Qwen3-Embedding-4B, text-embedding-3-large (dimensions=1024)
-- No hardcoded tenant/company UUIDs — tenant_id nullable, backfill from groups.company_id

create extension if not exists vector;

alter table public.eros_knowledge_chunks
  add column if not exists document_id uuid,
  add column if not exists tenant_id uuid,
  add column if not exists section_path text,
  add column if not exists content_hash text,
  add column if not exists embedding_model text,
  add column if not exists embedding_version text,
  add column if not exists access_level text default 'internal',
  add column if not exists embedding vector(1024);

comment on column public.eros_knowledge_chunks.embedding is
  'Fixed dim 1024. Provider/model/version from eros_embedding_models + env; do not hardcode in app code.';

comment on column public.eros_knowledge_chunks.tenant_id is
  'Mirrors eros_knowledge_groups.company_id when set; NULL = global/shared content.';

-- Dynamic backfill: copy company_id from parent group (no fixed UUIDs)
update public.eros_knowledge_chunks c
set tenant_id = g.company_id
from public.eros_knowledge_groups g
where c.group_id = g.id
  and c.tenant_id is null
  and g.company_id is not null;

create index if not exists eros_knowledge_chunks_embedding_hnsw_idx
  on public.eros_knowledge_chunks
  using hnsw (embedding vector_cosine_ops);

create index if not exists eros_knowledge_chunks_group_tenant_idx
  on public.eros_knowledge_chunks (group_id, tenant_id);

create index if not exists eros_knowledge_chunks_tenant_idx
  on public.eros_knowledge_chunks (tenant_id);

create table if not exists public.eros_embedding_models (
  id uuid primary key default gen_random_uuid(),
  model text not null,
  version text not null,
  dimension int not null check (dimension > 0),
  created_at timestamptz not null default now(),
  unique (model, version)
);

comment on table public.eros_embedding_models is
  'Registry of embedding model/version/dimension. Active choice via eros_config or env — not hardcoded UUIDs.';

-- Vector retrieval RPC (tenant: null user = all; else tenant match OR global null)
create or replace function public.match_chunks(
  query_embedding vector(1024),
  match_group_id uuid,
  match_tenant_id uuid default null,
  match_k int default 15,
  min_similarity double precision default 0.6
)
returns table (
  chunk_id text,
  chunk_type text,
  text text,
  meta jsonb,
  section_path text,
  source_ref text,
  score double precision
)
language sql
stable
as $$
  select
    c.chunk_id,
    c.chunk_type,
    c.text,
    c.meta,
    c.section_path,
    c.source_ref,
    (1 - (c.embedding <=> query_embedding))::double precision as score
  from public.eros_knowledge_chunks c
  where c.group_id = match_group_id
    and c.embedding is not null
    and (
      match_tenant_id is null
      or c.tenant_id is null
      or c.tenant_id = match_tenant_id
    )
    and (1 - (c.embedding <=> query_embedding)) >= min_similarity
  order by c.embedding <=> query_embedding
  limit greatest(1, least(coalesce(match_k, 15), 50));
$$;

revoke all on function public.match_chunks(vector, uuid, uuid, int, double precision) from public;
grant execute on function public.match_chunks(vector, uuid, uuid, int, double precision) to service_role;
grant execute on function public.match_chunks(vector, uuid, uuid, int, double precision) to authenticated;
