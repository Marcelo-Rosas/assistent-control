-- Hybrid match_chunks: add match_municipio on JSONB array municipios_relacionados
-- Also: modalidade via ILIKE (labels like "Pilates Clássico" / "Pilates/Fisioterapia")
-- Preserve return columns (section_path, source_ref, similarity, score).

drop function if exists public.match_chunks(vector, uuid, uuid, text, text, integer, integer, double precision);
drop function if exists public.match_chunks(vector, uuid, uuid, text, text, integer, integer, real);
drop function if exists public.match_chunks(vector, uuid, uuid, text, text, integer, text, integer, double precision);

create index if not exists eros_knowledge_chunks_meta_municipios_gin_idx
  on public.eros_knowledge_chunks using gin ((meta->'municipios_relacionados'));

create or replace function public.match_chunks(
  query_embedding vector(1024),
  match_group_id uuid,
  match_tenant_id uuid default null,
  match_modalidade text default null,
  match_bairro text default null,
  match_plano_rank integer default null,
  match_municipio text default null,
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
declare
  mun_norm text := nullif(trim(match_municipio), '');
  mod_norm text := nullif(trim(match_modalidade), '');
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
      mod_norm is null
      or c.meta->>'modalidade' ilike '%' || mod_norm || '%'
      or c.meta->>'modalidade_key' ilike '%' || lower(mod_norm) || '%'
      or (c.meta->'modalidades_secundarias') ? mod_norm
    )
    and (
      match_bairro is null
      or c.meta->>'bairro_normalizado' = match_bairro
    )
    and (
      match_plano_rank is null
      or coalesce((c.meta->>'plano_minimo_rank')::int, 99) <= match_plano_rank
    )
    and (
      mun_norm is null
      or c.meta->'municipios_relacionados' ? mun_norm
      or exists (
        select 1
        from jsonb_array_elements_text(coalesce(c.meta->'municipios_relacionados', '[]'::jsonb)) x(m)
        where lower(x.m) = lower(mun_norm)
           or lower(x.m) like '%' || lower(mun_norm) || '%'
      )
    )
    and c.embedding is not null
    and (1 - (c.embedding <=> query_embedding)) >= min_similarity
  order by c.embedding <=> query_embedding
  limit greatest(1, least(coalesce(match_k, 15), 50));
end;
$$;

revoke all on function public.match_chunks(
  vector, uuid, uuid, text, text, integer, text, integer, double precision
) from public;

grant execute on function public.match_chunks(
  vector, uuid, uuid, text, text, integer, text, integer, double precision
) to service_role;

grant execute on function public.match_chunks(
  vector, uuid, uuid, text, text, integer, text, integer, double precision
) to authenticated;

comment on function public.match_chunks(
  vector, uuid, uuid, text, text, integer, text, integer, double precision
) is
  'Hybrid vector retrieval; match_municipio filters meta.municipios_relacionados (jsonb array).';
