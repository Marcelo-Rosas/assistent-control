# Safe prompt — GymSite Knowledge Base (`/knowledge`)

**Status:** Approved rewrite (replaces mock-only KnowledgeBase paste)  
**Date:** 2026-07-24  
**Implements via:** `docs/superpowers/plans/2026-07-24-gymsite-pipeline.md` → Task 14  
**UI inspiration:** pasted `KnowledgeBase` layout (URL groups | files | train panel | test chat) — **behavior must be real or honest-empty**, never fake “synced/trained”.

---

## Role

Senior React/TypeScript + Supabase engineer for GymSite - Pipeline.

## Objective

Ship route `/knowledge` with Sidebar entry **Base de Conhecimento**, using the pasted UX layout, but wired for GymSite:

- Brand: GymSite / `@gymsite.com.br` — **no** `viverdeia.com` / “Viver de IA”
- Persist URL groups + file metadata in Supabase (`eros_*` or dedicated `eros_knowledge_*`)
- Chat/test panel calls **Edge** (reuse `eros-fugu-playground` or thin `eros-knowledge-query`) — **no** keyword fake replies as production
- Training button either (A) real ingest job or (B) disabled with “v1: indexação manual / coming soon” — **never** fake progress console that claims embeddings succeeded

## Hard rules

1. No `VITE_*` LLM/API keys; no browser Gemini/Sakana SDK for RAG.
2. Do not claim “Sincronizado” / “Treinamento finalizado” unless a real backend status says so.
3. Do not collide with `/playground` (Fugu model lab). Knowledge chat = RAG-over-sources; Playground = raw Fugu controls.
4. Edit `src/App.tsx` + `src/components/Sidebar.tsx` only (not orphan root copies).
5. Permission: manage = `manage_settings`; view/test chat = `interact_chat` or `access_eros`. Lock UI when lacking manage.
6. Empty state when DB empty — no `MOCK_FILES` / fake price-table answers.

## v1 scope (YAGNI)

**In cycle:**

- Route + Sidebar + page shell from paste (layout OK)
- CRUD URL groups in DB (or `eros_config` JSON if tables deferred — prefer tables)
- File list metadata only (upload to Supabase Storage optional stretch)
- Test chat: Edge RAG **or** if RAG not ready, call Edge with system prompt “use only provided URL list as context hints” + honest disclaimer — still no hardcoded commercial scripts
- Rebrand all copy to GymSite

**Defer:**

- Real vector embeddings / “gemini-3.5-flash” training theater
- Simulated `setInterval` ingest progress as success
- Keyword if/else commercial bot in `handleSendPlaygroundMessage`
- Unlimited file ingest without size/type validation

## Data model (preferred)

```sql
create table if not exists public.eros_knowledge_groups (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  name text not null,
  company_id uuid null
);

create table if not exists public.eros_knowledge_urls (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.eros_knowledge_groups(id) on delete cascade,
  url text not null,
  status text not null default 'pending' check (status in ('pending', 'synced', 'error')),
  unique (group_id, url)
);

create table if not exists public.eros_knowledge_files (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  name text not null,
  size_bytes bigint not null default 0,
  mime text null,
  storage_path text null,
  status text not null default 'pending' check (status in ('pending', 'syncing', 'synced', 'error'))
);
```

v1 may keep `status='pending'` always until a real worker exists.

## Implementation steps

1. Add tables/migration + mirror `schema.sql`.
2. `src/services/knowledgeService.ts` — list/create groups, add/remove URLs, list files; throw if Supabase missing (setup banner).
3. `src/components/knowledge/KnowledgeBase.tsx` — port layout from paste; strip mocks; GymSite copy; agents list rebranded.
4. Train button: if no worker → toast “Indexação automática ainda não disponível”; do not run fake logs.
5. Test chat: `knowledgeService.ask({ groupId, messages })` → Edge `eros-knowledge-query` (or playground with system context of URLs). No client-side scripted replies.
6. `App.tsx` route `/knowledge`; Sidebar item `knowledge` with icon `Database`, permission `interact_chat` (manage actions gated inside).
7. `npm run build`; manual empty-state + add URL persists after refresh.

## Out of scope

- Fake Gemini training console
- Replacing Eros WhatsApp chat
- Merging Knowledge test chat into `/playground`
