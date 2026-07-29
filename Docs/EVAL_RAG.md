# Avaliação RAG — City Primary Boost

## Status

**Calibrado e validado** (2026-07-28).  
`CITY_PRIMARY_BOOST = 0.08` em `supabase/functions/_shared/matchChunks.ts`.

RPC `match_chunks`, migrations `20260726` / `20260729` e pipeline de ingestão **não** foram alterados neste passo.

## Soft-rank (por que 0.08)

Após o RPC híbrido (vector + FTS), `boostByCityPrimary`:

1. Identifica chunks **primary** — `meta.cidade` exact match (CI + NFD) com o município da query.
2. Soma `+0.08` ao `score` (cap 1.0) só nesses chunks.
3. Reordena por `score` desc (tie-break: `similarity`).
4. Chunks **related-only** (`municipios_relacionados` contém a cidade, mas `cidade` é outra) **permanecem no set** — apenas ficam abaixo dos primary. Sem hard-cut.

Ask path (`knowledge-ask`, `eros-knowledge-query`) usa soft boost. Hard cut `filterByCityPriority` fica para eval / experimentos.

## Métricas (dataset GuruPass, 15 queries)

Fonte: `data/evaluation/city_boost_eval_results.json`  
Dataset: `data/samples/evaluation.json`  
Grupo: `GURUPASS_GROUP_ID`

| Métrica | Sem boost | Com boost (+0.08) | Δ |
|---------|-----------|-------------------|---|
| Primary@1 | 93.3% (14/15) | **100%** (15/15) | **+6.7 pp** |
| Primary@3 | 100% | 100% | 0 |
| MRR (1ª primary) | 0.967 | **1.000** | **+0.033** |
| Queries melhoradas | — | 1 (Arujá) | 0 pioras |

**Veredicto:** manter `CITY_PRIMARY_BOOST = 0.08`.

## Como re-executar

### Unit / smoke (sem RPC, sem Ollama)

```bash
npm run test:rag-filters
```

Cobre `boostByCityPrimary`, `filterByCityPriority`, `extractQueryFilters`.

### Eval A/B empírico (RPC + embed)

```bash
npm run eval:city-boost
```

Requer `.env.local`: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `GURUPASS_GROUP_ID`, `OLLAMA_BASE_URL`, modelo `mxbai-embed-large`.

Saída: `data/evaluation/city_boost_eval_results.json`.

Opcional: `EVAL_TOP_K`, `EVAL_MIN_SIM`, `EVAL_DATASET`, `EVAL_OUT`.

## Checklist relacionado

Ver `Docs/CHECKLIST_RAG.md`.
