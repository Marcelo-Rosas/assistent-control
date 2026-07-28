-- Extend match_municipio to also filter meta.cidade (taxas municipais).
-- Before: only meta.municipios_relacionados (agregadores).
-- After: municipios_relacionados OR meta.cidade (ilike / equality).
-- Strict: does NOT keep cidade-null chunks (avoids L9696 leak on city queries).

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
          to_tsvector(
            'portuguese',
            coalesce(c.text, '') || ' ' || coalesce(c.meta::text, '')
          ),
          tsq
        )::double precision
      end as fts_rank
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
        -- Taxas / regulatório municipal (meta.cidade)
        or (
          coalesce(c.meta->>'cidade', '') <> ''
          and (
            lower(c.meta->>'cidade') = lower(mun_norm)
            or c.meta->>'cidade' ilike '%' || mun_norm || '%'
            or mun_norm ilike '%' || (c.meta->>'cidade') || '%'
          )
        )
        -- Agregadores (meta.municipios_relacionados)
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
      else (
        0.7 * cand.sim
        + 0.3 * (cand.fts_rank / (cand.fts_rank + 1.0))
      )::double precision
    end as score
  from candidates cand
  order by
    case
      when tsq is null then cand.sim
      else (
        0.7 * cand.sim
        + 0.3 * (cand.fts_rank / (cand.fts_rank + 1.0))
      )
    end desc,
    cand.sim desc
  limit greatest(1, least(coalesce(match_k, 15), 50));
end;
$$;

create index if not exists eros_knowledge_chunks_meta_cidade_idx
  on public.eros_knowledge_chunks ((lower(meta->>'cidade')))
  where meta ? 'cidade';

revoke all on function public.match_chunks(
  vector, uuid, uuid, text, text, integer, text, integer, double precision, text
) from public;

grant execute on function public.match_chunks(
  vector, uuid, uuid, text, text, integer, text, integer, double precision, text
) to service_role;

grant execute on function public.match_chunks(
  vector, uuid, uuid, text, text, integer, text, integer, double precision, text
) to authenticated;

comment on function public.match_chunks(
  vector, uuid, uuid, text, text, integer, text, integer, double precision, text
) is
  'Hybrid retrieval. match_municipio filters meta.cidade OR meta.municipios_relacionados (strict; no null-cidade passthrough).';
