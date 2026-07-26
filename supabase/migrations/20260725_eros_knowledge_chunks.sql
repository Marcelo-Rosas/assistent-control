-- Knowledge chunks + published agent (Treinar & Publicar)

create table if not exists public.eros_knowledge_chunks (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  group_id uuid not null references public.eros_knowledge_groups(id) on delete cascade,
  source_kind text not null default 'manual',
  source_ref text null,
  chunk_id text not null,
  chunk_type text not null default 'text',
  text text not null,
  meta jsonb not null default '{}'::jsonb
);

create index if not exists eros_knowledge_chunks_group_idx
  on public.eros_knowledge_chunks (group_id);

create table if not exists public.eros_knowledge_agents (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  group_id uuid not null unique references public.eros_knowledge_groups(id) on delete cascade,
  name text not null default 'GymSite Agregadores',
  status text not null default 'draft'
    check (status in ('draft', 'training', 'published', 'error')),
  system_prompt text null,
  chunk_count int not null default 0,
  last_trained_at timestamptz null,
  last_error text null
);
