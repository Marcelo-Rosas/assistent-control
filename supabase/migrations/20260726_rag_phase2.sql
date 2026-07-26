-- RAG Phase 2: idempotent content_hash + fresh ingest (chunks already wiped)
-- content_hash = sha256(group_id || chunk_type || text) — app-side; unique per group

alter table public.eros_knowledge_chunks
  alter column content_hash type text;

create unique index if not exists eros_knowledge_chunks_group_hash_uniq
  on public.eros_knowledge_chunks (group_id, content_hash)
  where content_hash is not null;

comment on column public.eros_knowledge_chunks.content_hash is
  'sha256(group_id + chunk_type + text); UPSERT key for idempotent ingest (chunking-v1).';

-- Prefer voyage-4-large @ 1024 as registry row (no UUID tenant hardcode)
insert into public.eros_embedding_models (model, version, dimension)
values ('voyage-4-large', '1', 1024)
on conflict (model, version) do nothing;

-- Default embedding config (provider switchable without schema change)
insert into public.eros_config (key, value_json, company_id)
select 'embedding', '{"provider":"voyage","model":"voyage-4-large","version":"1","dimension":1024}'::jsonb, null
where not exists (
  select 1 from public.eros_config where key = 'embedding' and company_id is null
);
