# Testes — regras

## Framework

Projeto usa **`node:test` + `tsx`** (não vitest/jest).

## Comandos

| Comando | O quê |
|---------|-------|
| `npm run test:rag-filters` | Smoke RAG: cidade, boost, queryFilters, tipos, RPC |
| `npm run eval:gurupass-boost` | Eval GuruPass baseline vs `boostByCityPrimary` (+0.08) |
| `npm run validate:query` | Dataset `data/samples/query-test-cases.json` |
| `npm run validate:rag-answer` | Formato resposta RAG |
| `npm run smoke:eros-chat` | Webhook Evolution + thread (precisa env) |

## `test:rag-filters` (principal)

Arquivo: `tests/smoke-rag-filters.test.ts`

Cobre:

- `filterByCityPriority` — `meta.cidade` > `municipios_relacionados` (exact CI)
- `extractQueryFilters` — Arujá, Niterói, Santos (primeira cidade)
- `MatchChunkMeta` — campos do contrato
- `KnowledgeBase.tsx` — inputs município + select modalidade
- RPC `match_chunks` — skip sem `SUPABASE_SERVICE_ROLE_KEY`

```bash
npm run test:rag-filters
```

Esperado: `pass 11` (ou skip RPC se sem credenciais).

## Deno (Edge isolado)

```bash
cd supabase/functions/_shared
deno test whatsappNormalize.test.ts
```

## Notebooks eval

Não são CI — rodar manual após ingest/embed. Ver [jupyter.md](./jupyter.md).

Resultados: `data/evaluation/*_eval_results.json`

## Quando rodar

| Mudança | Teste mínimo |
|---------|--------------|
| `matchChunks.ts` / `queryFilters.ts` | `npm run test:rag-filters` |
| Edge `knowledge-ask` | acima + deploy + 1 pergunta UI |
| Migration SQL | RPC smoke (integração no test) |
| Ingest schema meta | notebook eval do domínio |

## Adicionar teste novo

1. Criar em `tests/*.test.ts`
2. Registrar script em `package.json`: `"test:foo": "npx tsx --test tests/foo.test.ts"`
3. Importar de `supabase/functions/_shared/` (fonte única Edge + testes)
