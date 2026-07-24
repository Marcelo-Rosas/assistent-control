-- GymSite pipeline cycle: upsert safety + config + message idempotency

alter table public.eros_messages
  add column if not exists provider_message_id text null;

create unique index if not exists eros_messages_provider_message_id_uniq
  on public.eros_messages (provider_message_id)
  where provider_message_id is not null;

create unique index if not exists eros_leads_channel_phone_uniq
  on public.eros_leads (channel, phone)
  where phone is not null;

create unique index if not exists eros_leads_channel_external_id_uniq
  on public.eros_leads (channel, external_id)
  where external_id is not null;

create unique index if not exists eros_config_global_key_uniq
  on public.eros_config (key)
  where company_id is null;

create unique index if not exists eros_pipeline_lead_global_uniq
  on public.eros_pipeline (lead_id)
  where company_id is null;
