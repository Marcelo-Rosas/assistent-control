-- EROS schema for Supabase (Postgres)
-- Project: gxmaxbjgdrqdcizvdojp
--
-- Notes:
-- - This file creates the `eros_*` tables described in Plan/EROS_INTEGRATION_GUIDE.md.
-- - RLS is NOT enabled by default here, because the frontend currently has no Auth flow.
--   When Supabase Auth is introduced, enable RLS and add company/user-scoped policies.

create extension if not exists pgcrypto;

-- updated_at helper
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- 1) Leads
create table if not exists public.eros_leads (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  company_id uuid null,

  channel text not null check (channel in ('instagram', 'whatsapp')),
  external_id text null, -- IG/WA user id / thread id

  name text not null,
  username text null,
  phone text null,
  email text null,
  avatar_url text null,

  classification text not null default 'morno' check (classification in ('hot', 'morno', 'frio')),
  score int not null default 0 check (score >= 0 and score <= 100),

  status text not null default 'new' check (status in ('new', 'qualifying', 'qualified', 'call', 'proposal', 'converted', 'discarded')),

  tags text[] not null default '{}',
  notes text null,

  last_contact_at timestamptz null
);

create index if not exists eros_leads_company_id_idx on public.eros_leads(company_id);
create index if not exists eros_leads_channel_idx on public.eros_leads(channel);
create index if not exists eros_leads_status_idx on public.eros_leads(status);
create index if not exists eros_leads_classification_idx on public.eros_leads(classification);
create index if not exists eros_leads_score_idx on public.eros_leads(score desc);
create index if not exists eros_leads_last_contact_idx on public.eros_leads(last_contact_at desc nulls last);
create unique index if not exists eros_leads_channel_phone_uniq
  on public.eros_leads (channel, phone)
  where phone is not null;
create unique index if not exists eros_leads_channel_external_id_uniq
  on public.eros_leads (channel, external_id)
  where external_id is not null;

drop trigger if exists set_updated_at_eros_leads on public.eros_leads;
create trigger set_updated_at_eros_leads
before update on public.eros_leads
for each row execute function public.set_updated_at();

-- 2) Conversations (threads)
create table if not exists public.eros_conversations (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  company_id uuid null,

  lead_id uuid not null references public.eros_leads(id) on delete cascade,
  channel text not null check (channel in ('instagram', 'whatsapp')),
  external_thread_id text null,

  last_message_at timestamptz null,
  last_message_preview text null,
  unread_count int not null default 0 check (unread_count >= 0)
);

create index if not exists eros_conversations_company_id_idx on public.eros_conversations(company_id);
create index if not exists eros_conversations_lead_id_idx on public.eros_conversations(lead_id);
create index if not exists eros_conversations_last_message_at_idx on public.eros_conversations(last_message_at desc nulls last);

drop trigger if exists set_updated_at_eros_conversations on public.eros_conversations;
create trigger set_updated_at_eros_conversations
before update on public.eros_conversations
for each row execute function public.set_updated_at();

-- 3) Messages
create table if not exists public.eros_messages (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  company_id uuid null,

  conversation_id uuid not null references public.eros_conversations(id) on delete cascade,
  lead_id uuid not null references public.eros_leads(id) on delete cascade,

  direction text not null check (direction in ('incoming', 'outgoing')),
  message_type text not null default 'text' check (message_type in ('text', 'image', 'audio')),
  status text not null default 'sent' check (status in ('sent', 'delivered', 'read', 'failed')),

  content text null,
  media_url text null,

  spin_phase text null check (spin_phase in ('situation', 'problem', 'implication', 'need_payoff')),

  provider_message_id text null
);

create index if not exists eros_messages_company_id_idx on public.eros_messages(company_id);
create index if not exists eros_messages_conversation_id_created_at_idx on public.eros_messages(conversation_id, created_at asc);
create index if not exists eros_messages_lead_id_created_at_idx on public.eros_messages(lead_id, created_at asc);
create unique index if not exists eros_messages_provider_message_id_uniq
  on public.eros_messages (provider_message_id)
  where provider_message_id is not null;

drop trigger if exists set_updated_at_eros_messages on public.eros_messages;
create trigger set_updated_at_eros_messages
before update on public.eros_messages
for each row execute function public.set_updated_at();

-- 4) Content queue
create table if not exists public.eros_content (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  company_id uuid null,

  status text not null default 'generated' check (status in ('generated', 'approved', 'rejected', 'published')),
  format text not null default 'caption' check (format in ('caption', 'reel', 'story', 'carousel')),

  title text null,
  caption text null,
  media_urls text[] not null default '{}',

  scheduled_for timestamptz null,
  published_at timestamptz null,
  meta_post_id text null,

  rejection_reason text null
);

create index if not exists eros_content_company_id_idx on public.eros_content(company_id);
create index if not exists eros_content_status_idx on public.eros_content(status);
create index if not exists eros_content_scheduled_for_idx on public.eros_content(scheduled_for asc nulls last);

drop trigger if exists set_updated_at_eros_content on public.eros_content;
create trigger set_updated_at_eros_content
before update on public.eros_content
for each row execute function public.set_updated_at();

-- 5) Prospects (pre-leads)
create table if not exists public.eros_prospects (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  company_id uuid null,

  channel text not null check (channel in ('instagram')),
  username text not null,
  display_name text null,
  avatar_url text null,

  analysis_json jsonb not null default '{}'::jsonb,
  score int not null default 0 check (score >= 0 and score <= 100),
  status text not null default 'new' check (status in ('new', 'skipped', 'converted'))
);

create unique index if not exists eros_prospects_company_username_uniq on public.eros_prospects(company_id, username);
create index if not exists eros_prospects_company_id_idx on public.eros_prospects(company_id);
create index if not exists eros_prospects_score_idx on public.eros_prospects(score desc);

drop trigger if exists set_updated_at_eros_prospects on public.eros_prospects;
create trigger set_updated_at_eros_prospects
before update on public.eros_prospects
for each row execute function public.set_updated_at();

-- 6) Engagement touches
create table if not exists public.eros_engagement (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  company_id uuid null,

  lead_id uuid null references public.eros_leads(id) on delete set null,
  prospect_id uuid null references public.eros_prospects(id) on delete set null,

  touch_type text not null check (touch_type in ('like', 'comment', 'dm')),
  touch_index int not null default 1 check (touch_index >= 1 and touch_index <= 10),

  status text not null default 'pending' check (status in ('pending', 'sent', 'failed')),
  external_ref text null,
  payload_json jsonb not null default '{}'::jsonb
);

create index if not exists eros_engagement_company_id_idx on public.eros_engagement(company_id);
create index if not exists eros_engagement_lead_id_idx on public.eros_engagement(lead_id);
create index if not exists eros_engagement_prospect_id_idx on public.eros_engagement(prospect_id);
create index if not exists eros_engagement_created_at_idx on public.eros_engagement(created_at desc);

drop trigger if exists set_updated_at_eros_engagement on public.eros_engagement;
create trigger set_updated_at_eros_engagement
before update on public.eros_engagement
for each row execute function public.set_updated_at();

-- 7) Cadência (follow-up schedule)
create table if not exists public.eros_cadencia (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  company_id uuid null,

  lead_id uuid not null references public.eros_leads(id) on delete cascade,
  is_active boolean not null default true,

  next_touch_at timestamptz null,
  step_index int not null default 1 check (step_index >= 1 and step_index <= 20),
  cadence_json jsonb not null default '{}'::jsonb
);

create unique index if not exists eros_cadencia_company_lead_uniq on public.eros_cadencia(company_id, lead_id);
create index if not exists eros_cadencia_next_touch_at_idx on public.eros_cadencia(next_touch_at asc nulls last);

drop trigger if exists set_updated_at_eros_cadencia on public.eros_cadencia;
create trigger set_updated_at_eros_cadencia
before update on public.eros_cadencia
for each row execute function public.set_updated_at();

-- 8) Pipeline (kanban items)
create table if not exists public.eros_pipeline (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  company_id uuid null,

  lead_id uuid not null references public.eros_leads(id) on delete cascade,
  stage text not null check (stage in ('new', 'qualifying', 'qualified', 'call', 'proposal', 'converted')),
  position int not null default 0
);

create unique index if not exists eros_pipeline_company_lead_uniq on public.eros_pipeline(company_id, lead_id);
create unique index if not exists eros_pipeline_lead_global_uniq
  on public.eros_pipeline (lead_id)
  where company_id is null;
create index if not exists eros_pipeline_stage_pos_idx on public.eros_pipeline(stage, position);

drop trigger if exists set_updated_at_eros_pipeline on public.eros_pipeline;
create trigger set_updated_at_eros_pipeline
before update on public.eros_pipeline
for each row execute function public.set_updated_at();

-- 9) Config
create table if not exists public.eros_config (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  company_id uuid null,

  key text not null,
  value_json jsonb not null default '{}'::jsonb
);

create unique index if not exists eros_config_company_key_uniq on public.eros_config(company_id, key);
create unique index if not exists eros_config_global_key_uniq
  on public.eros_config (key)
  where company_id is null;

drop trigger if exists set_updated_at_eros_config on public.eros_config;
create trigger set_updated_at_eros_config
before update on public.eros_config
for each row execute function public.set_updated_at();

-- 10) Metrics cache
create table if not exists public.eros_metrics_cache (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  company_id uuid null,

  key text not null,
  computed_at timestamptz not null default now(),
  ttl_seconds int not null default 300 check (ttl_seconds >= 0),
  metrics_json jsonb not null default '{}'::jsonb
);

create unique index if not exists eros_metrics_cache_company_key_uniq on public.eros_metrics_cache(company_id, key);
create index if not exists eros_metrics_cache_computed_at_idx on public.eros_metrics_cache(computed_at desc);

drop trigger if exists set_updated_at_eros_metrics_cache on public.eros_metrics_cache;
create trigger set_updated_at_eros_metrics_cache
before update on public.eros_metrics_cache
for each row execute function public.set_updated_at();

-- 11) Activity log
create table if not exists public.eros_activity_log (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  company_id uuid null,

  actor text null, -- user id / system / function name
  action text not null,
  entity_type text null,
  entity_id uuid null,
  meta_json jsonb not null default '{}'::jsonb
);

create index if not exists eros_activity_log_company_id_idx on public.eros_activity_log(company_id);
create index if not exists eros_activity_log_created_at_idx on public.eros_activity_log(created_at desc);
create index if not exists eros_activity_log_entity_idx on public.eros_activity_log(entity_type, entity_id);

-- Realtime: replica identity full on key tables
alter table public.eros_leads replica identity full;
alter table public.eros_messages replica identity full;
alter table public.eros_conversations replica identity full;
alter table public.eros_content replica identity full;
alter table public.eros_pipeline replica identity full;

-- ---------------------------------------------------------------------------
-- Dev API access (run after tables exist; replace when Supabase Auth lands)
-- See migration eros_dev_api_access or supabase/migrations/
-- ---------------------------------------------------------------------------
-- grant usage on schema public to anon, authenticated;
-- grant select, insert, update, delete on all eros_* tables to anon, authenticated;
-- create policy eros_dev_anon_all ... for all to anon, authenticated using (true);

