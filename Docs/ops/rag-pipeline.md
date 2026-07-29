# RAG pipeline — regras

## Modelo mental

```
raw → normalize → ingest (chunks) → embed (vector 1024) → publish agent → match_chunks RPC
```

- **Dimensão:** 1024 (`mxbai-embed-large` / Ollama)
- **Isolamento:** `group_id` obrigatório + `tenant_id` opcional (JWT `company_id`)
- **Upsert key:** `(group_id, content_hash)`

## Por domínio (npm scripts)

| Domínio | setup | ingest | embed | Group env |
|---------|-------|--------|-------|-----------|
| GuruPass | `setup:gurupass` | `ingest:gurupass --apply` | `embed:gurupass` | `GURUPASS_GROUP_ID` |
| Wellhub | `setup:wellhub` | `ingest:wellhub` | `embed:wellhub` | `WELLHUB_GROUP_ID` |
| TotalPass | `ingest:tp` / `ingest:tp-sp` | — | `embed:tp` | `TOTALPASS_GROUP_ID` |
| Regulatório | `setup:regulatorio` | `ingest:law-9696`, `ingest:regulatorio-taxas` | `embed:regulatorio` | `REGULATORIO_GROUP_ID` |
| Mercado | `setup:mercado` | `ingest:mercado` | `embed:mercado` | `MERCADO_GROUP_ID` |
| Engenheiro | `setup:engenheiro` | `ingest:engenheiro` | `embed:engenheiro` | `ENGENHEIRO_GROUP_ID` |

## GuruPass (referência)

```bash
# dry-run default
npx tsx scripts/ingest-gurupass.ts

# gravar chunks
npx tsx scripts/ingest-gurupass.ts --apply

# embeddings (ordena por id — não created_at)
npm run embed:gurupass
```

Fonte: `data/processed/gurupass-normalized.json` (~3063 gyms → ~5008 chunks).

## Meta obrigatória (agregadores)

```json
{
  "cidade": "São Paulo",
  "municipios_relacionados": ["Guarulhos", "Arujá"],
  "modalidade": "musculacao",
  "modalidade_key": "musculacao",
  "nome_academia": "...",
  "gym_id": "..."
}
```

## `match_chunks` (SQL)

Parâmetros RPC — Edge passa todos:

- `query_embedding`, `match_group_id`, `match_tenant_id`
- `match_modalidade`, `match_bairro`, `match_plano_rank`, `match_municipio`
- `match_k`, `min_similarity`, `match_query`

Pós-RPC TS: `filterByCityPriority` — prioriza `meta.cidade` exact CI.

## Publicar agente

Após embed: `eros_knowledge_agents.status = published`, `chunk_count` atualizado.

**Treinar & Publicar (UI):** `KnowledgeBase` → `trainAndPublish` → Edge `eros-knowledge-ingest`:
wipe grupo → `embedDocuments` (1024) → `content_hash` + `embedding` + model/version → upsert batches → publish.

Scripts de embed CLI (`embed:gurupass` etc.) fazem publish automático ao final (chunks com `embedding_model=pending` no ingest).

## Não fazer

- `.select().limit(80)` em `eros_knowledge_chunks` no Edge — usar RPC
- Re-ingest sem entender duplicata `content_hash`
- Commitar JSON de 500MB+
- Gerar embedding no browser (só Edge / scripts com service_role)
