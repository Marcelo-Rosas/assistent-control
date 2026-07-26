-- Fix: upsert onConflict requires FULL UNIQUE constraint (no WHERE).
-- Prefer eros_knowledge_chunks_group_hash_key — see 20260726_rag_chunks_hash_unique_full.sql
-- This partial index alone is NOT enough for PostgREST ON CONFLICT.

create unique index if not exists eros_knowledge_chunks_group_hash_unique_idx
  on public.eros_knowledge_chunks (group_id, content_hash)
  where content_hash is not null;

comment on index public.eros_knowledge_chunks_group_hash_unique_idx is
  'Legacy partial unique; use constraint eros_knowledge_chunks_group_hash_key for upsert.';
