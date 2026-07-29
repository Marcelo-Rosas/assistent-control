# Checklist RAG — City Boost & Hardening

## Escopo

Calibrar e consolidar `CITY_PRIMARY_BOOST = 0.08` (`boostByCityPrimary`) no path de ask, com eval empírico GuruPass.

**Não alterar:** RPC `match_chunks`, migrations `20260726`/`20260729`, ingest embeddings.

Doc detalhada de métricas: [`EVAL_RAG.md`](./EVAL_RAG.md).

## Checklist (concluído)

- [x] Busca híbrida avaliada (vector + FTS via `match_chunks` + soft city boost).
- [x] Top-K e limiar de relevância configuráveis (`RAG_TOP_K`, `RAG_MIN_SIMILARITY` / body / `EVAL_*`).
- [x] Citações e rastreabilidade retornadas (`sources`, `source_ref`, meta academia/cidade).
- [x] Perguntas de teste criadas e Recall@K / Precision@K / MRR medidos (Primary@1, MRR no eval city boost; notebooks domínio).
- [x] Soft-rank primary vs related-only validado (0 regressões no dataset de 15).
- [x] Smoke unitário `npm run test:rag-filters`.
- [x] Eval A/B `npm run eval:city-boost` → `data/evaluation/city_boost_eval_results.json`.

## Artefatos

| Arquivo | Função |
|---------|--------|
| `data/samples/evaluation.json` | Dataset 15 queries GuruPass |
| `scripts/eval-city-boost.ts` | A/B sem boost vs `boostByCityPrimary` |
| `data/evaluation/city_boost_eval_results.json` | Relatório empírico |
| `Docs/EVAL_RAG.md` | Métricas + como re-rodar |
| `tests/smoke-rag-filters.test.ts` | Unit boost / filter / extractors |

## Como rodar

```bash
npm run test:rag-filters
npm run eval:city-boost
```

## Interpretação rápida (recalibração)

| Resultado | Ação |
|-----------|------|
| Δ primary@1 ≥ +5pp ou Δ MRR ≥ +0.05 | Manter `0.08` ✅ (estado atual) |
| Neutro | Testar `0.10`–`0.12` ou hard filter só em eval |
| Piora | Baixar boost — **não** alterar RPC |
