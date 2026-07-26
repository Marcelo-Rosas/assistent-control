# CHUNKING_EROS — estratégia `chunking-v1`

**Domínio:** GymSite agregadores (Gurupass / TotalPass / Wellhub) + regulatório.  
**Versão:** `chunking-v1` (gravada em `meta.chunking` na ingestão).

## Estratégia

**Recursivo orientado à estrutura** (não sliding window cego).

| Param | Valor |
|-------|--------|
| Target | ~600 tokens |
| Min | ~100 tokens |
| Max | ~900 tokens |
| Overlap | ~80 tokens (só em prosa contínua) |

## Regras por fonte

### JSON estruturado TotalPass (enriched)
- **1 modalidade × academia = 1 chunk** (`gym_modality`) — plano mínimo é por modalidade, não pela academia.
- Fallback sem scrape: 1 chunk `gym_listing` (`academia_geral`).
- Meta: `modalidade`, `plano_minimo_rank`, `bairro_normalizado`, `nome_academia`, `source_ref` = URL TotalPass.
- Pipeline: `scripts/enrich-totalpass.ts` → `prepareTpChunksGranulares` → Edge ingest + Voyage.

### JSON genérico GP / TP legado
- **1 academia / partner = 1 chunk** (`gp_gym` / `tp_partner`) quando não enriched.

### Regulatório / pages
- Quebrar por heading / seção (`section_path`).
- Listas e tabelas ficam no mesmo chunk se cabem no max; senão split por item mantendo título da seção no prefixo.

### Genérico
- Recursive character splitter com separadores: `\n\n` → `\n` → `. ` → espaço.

## Idempotência

```
content_hash = sha256(group_id + "|" + chunk_type + "|" + text)
```

UPSERT / unique `(group_id, content_hash)`. Re-treino do mesmo texto não duplica.

## Embeddings

- Dimensão schema: **1024**
- Default provider: **voyage-4-large** (`input_type=document` no ingest, `query` no ask)
- Modelo/versão em `eros_config.embedding` + `eros_embedding_models`

## O que NÃO fazer

- Reusar chunks antigos sem embedding.
- Misturar modelos de embedding no mesmo índice sem reindex completo.
- Tratar texto de chunk como instrução do sistema (ver tags `<chunk>` na Edge query).
