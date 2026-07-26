-- PostgREST upsert onConflict needs a FULL unique constraint (no WHERE predicate).
-- Partial unique indexes are invisible to ON CONFLICT inference via PostgREST.

drop index if exists public.eros_knowledge_chunks_group_hash_uniq;
drop index if exists public.eros_knowledge_chunks_group_hash_unique_idx;

-- Non-partial unique: multiple NULLs still allowed in Postgres UNIQUE
alter table public.eros_knowledge_chunks
  drop constraint if exists eros_knowledge_chunks_group_hash_key;

alter table public.eros_knowledge_chunks
  add constraint eros_knowledge_chunks_group_hash_key
  unique (group_id, content_hash);

comment on constraint eros_knowledge_chunks_group_hash_key on public.eros_knowledge_chunks is
  'Full unique for PostgREST upsert onConflict=group_id,content_hash';
