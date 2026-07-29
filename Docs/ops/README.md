# Ops — regras de execução

Guias operacionais do repo `assistent-control` (GymSite pipeline + RAG Supabase).

| Guia | Quando usar |
|------|-------------|
| [commit.md](./commit.md) | Antes de commitar / PR |
| [deploy.md](./deploy.md) | Worker Cloudflare + Edge Functions |
| [testes.md](./testes.md) | Smoke, unit, validação RAG |
| [jupyter.md](./jupyter.md) | Notebooks eval / debug RAG |
| [rag-pipeline.md](./rag-pipeline.md) | Ingest → embed → publish por domínio |
| [supabase.md](./supabase.md) | Migrations SQL, `match_chunks`, RLS |
| [env-secrets.md](./env-secrets.md) | `.env.local`, chaves, grupos |

## Ordem típica (feature RAG)

1. Migration SQL → [supabase.md](./supabase.md)
2. Código TS/Edge → [testes.md](./testes.md) (`npm run test:rag-filters`)
3. Ingest + embed → [rag-pipeline.md](./rag-pipeline.md)
4. Eval notebook → [jupyter.md](./jupyter.md)
5. Deploy edge → [deploy.md](./deploy.md)
6. Commit → [commit.md](./commit.md)

## Projeto Supabase

- **Ref:** `gxmaxbjgdrqdcizvdojp`
- **URL:** `https://gxmaxbjgdrqdcizvdojp.supabase.co`

## Regra global

- **Nunca** commitar `.env.local`, service role, ou `data/raw`/`data/processed` gigantes sem pedido explícito.
- **Sempre** `service_role` em scripts de ingest/embed/RPC; browser usa `anon` + Edge.
