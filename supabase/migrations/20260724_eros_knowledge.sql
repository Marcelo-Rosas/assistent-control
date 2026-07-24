-- Knowledge base tables for /knowledge

create table if not exists public.eros_knowledge_groups (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  company_id uuid null,
  name text not null
);

create table if not exists public.eros_knowledge_urls (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  group_id uuid not null references public.eros_knowledge_groups(id) on delete cascade,
  url text not null,
  status text not null default 'pending'
    check (status in ('pending', 'synced', 'error')),
  unique (group_id, url)
);

create table if not exists public.eros_knowledge_files (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  company_id uuid null,
  name text not null,
  size_bytes bigint not null default 0,
  mime text null,
  storage_path text null,
  status text not null default 'pending'
    check (status in ('pending', 'syncing', 'synced', 'error'))
);
