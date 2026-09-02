-- Renda por bairro/distrito (IBGE Censo 2022) — GymSite / recomendador

create table if not exists public.renda_bairro (
  id bigint generated always as identity primary key,
  municipio_cod text not null,
  uf text,
  cidade text,
  bairro text not null,
  bairro_norm text not null,
  renda_pc numeric,
  renda_media numeric,
  renda_mediana numeric,
  domicilios integer,
  moradores_domicilio integer,
  pessoas integer,
  ranking_municipio integer,
  percentil_municipio numeric,
  ano smallint not null default 2022,
  fonte text not null default 'IBGE Censo 2022',
  updated_at timestamptz not null default now(),
  unique (municipio_cod, bairro_norm)
);

create index if not exists renda_bairro_municipio_cod_idx
  on public.renda_bairro (municipio_cod);

create index if not exists renda_bairro_renda_pc_idx
  on public.renda_bairro (municipio_cod, renda_pc desc nulls last);

alter table public.renda_bairro enable row level security;

drop policy if exists renda_bairro_read_authenticated on public.renda_bairro;
create policy renda_bairro_read_authenticated
  on public.renda_bairro
  for select
  to authenticated, anon
  using (true);

drop policy if exists renda_bairro_service_role_all on public.renda_bairro;
create policy renda_bairro_service_role_all
  on public.renda_bairro
  for all
  to service_role
  using (true)
  with check (true);
