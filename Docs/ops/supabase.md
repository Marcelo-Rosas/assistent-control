# Supabase — regras

## Projeto

- **Ref:** `gxmaxbjgdrqdcizvdojp`
- **Extensão:** `vector` (1024)
- **Tabelas RAG:** `eros_knowledge_groups`, `eros_knowledge_chunks`, `eros_knowledge_agents`

## Schema evolutivo

| Migration | Conteúdo |
|-----------|----------|
| `20260724_eros_knowledge.sql` | groups, urls, files |
| `20260725_eros_knowledge_chunks.sql` | chunks base (sem tenant) |
| `20260726_rag_phase1.sql` | **`tenant_id`**, embedding vector(1024) |
| `20260729_rag_cleanup_and_hardening.sql` | **canônico** — match_chunks + RLS + índices |

`tenant_id` **existe** (phase1) — não remover.

## `match_chunks`

- **Grant:** `service_role` only (revoke `authenticated`)
- **Filtro município:** `lower(cidade) =` OR `municipios_relacionados ?` OR CI exact no array
- **FTS:** boost via `match_query` (não gate duro)

## RLS

- `eros_knowledge_chunks`: enabled
- `authenticated`: `tenant_id IS NULL` OR `tenant_id = jwt app_metadata.company_id`
- `service_role`: bypass (scripts + Edge)

## Índices (pós 20260729)

- `eros_knowledge_chunks_embedding_hnsw_idx` (partial `embedding IS NOT NULL`)
- `eros_chunks_group_cidade_lower_idx`
- `eros_knowledge_chunks_meta_municipios_gin_idx`
- `eros_knowledge_chunks_text_fts_idx`
- `eros_knowledge_chunks_group_tenant_idx`

## Aplicar migration

SQL Editor: colar arquivo inteiro → Run.

Validação:

```sql
select indexname from pg_indexes
where tablename = 'eros_knowledge_chunks'
  and indexname like 'eros_%'
order by 1;
```

## RPC smoke (sem embedding literal inválido)

Não usar `'[...]'::vector` — Postgres rejeita.

Opções:

1. Notebook `embed_query()`
2. `npm run test:rag-filters` (vetor aleatório 1024)
3. Função teste SQL `generate_test_vector(1024)` se criada manualmente

## Inventário GuruPass

```sql
select count(*), count(*) filter (where embedding is not null)
from eros_knowledge_chunks
where group_id = '4d1e2c40-217b-4a39-bc08-f9c3e90fd803';
```

## MCP / CLI

```bash
npx supabase functions deploy <name> --project-ref gxmaxbjgdrqdcizvdojp
```

MCP `apply_migration` pode falhar por permissão — usar SQL Editor.
