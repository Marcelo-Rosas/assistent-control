# Deploy — regras

## Componentes

| Camada | O quê | Como |
|--------|-------|------|
| Frontend | Vite → Cloudflare Worker | `npm run deploy` |
| Edge Functions | Supabase Deno | `npx supabase functions deploy` |
| SQL | Migrations | SQL Editor ou `db push` |
| Embeddings | Ollama remoto | não deploy — só URL em secrets |

## 1. Worker (GymSite UI)

### Local

```bash
npm run build
npx wrangler deploy
# ou
npm run deploy
```

Pré-requisito: `wrangler login` (`npm run cf:login`).

### Auto-deploy (GitHub Actions → main)

Workflow: `.github/workflows/ci.yml`  
Após CI verde no push em `main`, job **Deploy Workers** roda.

Secrets do repo (Settings → Secrets and variables → Actions):

| Secret | Valor |
|--------|--------|
| `CLOUDFLARE_ACCOUNT_ID` | `361e9e1383bfa8e95e1db54e6c2a3bba` (já setado) |
| `CLOUDFLARE_API_TOKEN` | Token com permissão **Edit Cloudflare Workers** |

Criar token: https://dash.cloudflare.com/profile/api-tokens → *Create token* → template **Edit Cloudflare Workers**.

```bash
# colar o token (não commitar)
gh secret set CLOUDFLARE_API_TOKEN
```

Logs: `npm run cf:tail`  
Actions: https://github.com/Marcelo-Rosas/assistent-control/actions


## 2. Edge Functions (RAG / Eros)

**Projeto:** `gxmaxbjgdrqdcizvdojp`

```bash
npx supabase functions deploy knowledge-ask --project-ref gxmaxbjgdrqdcizvdojp --no-verify-jwt
npx supabase functions deploy eros-knowledge-query --project-ref gxmaxbjgdrqdcizvdojp --no-verify-jwt
```

Outras functions (quando mudar):

- `eros-knowledge-ingest`
- `eros-evolution-webhook`
- `eros-ai-reply`
- `eros-fugu-playground`

Secrets (prod): `scripts/push-edge-secrets.ps1` — ver [env-secrets.md](./env-secrets.md).

Local:

```bash
supabase functions serve --env-file .env.local
```

## 3. SQL / migrations

Ordem: arquivos em `supabase/migrations/` por timestamp.

Estado canônico RAG (jul/2026):

- `20260729_rag_cleanup_and_hardening.sql` — `match_chunks` + RLS chunks + índices

Aplicar no **SQL Editor** Supabase ou:

```bash
npx supabase db push --project-ref gxmaxbjgdrqdcizvdojp
```

DDL = `Success. No rows returned` (normal).

## Checklist pós-deploy

- [ ] `npm run test:rag-filters` (local)
- [ ] Edge: pergunta teste no KnowledgeBase ou RagPlayground
- [ ] `match_chunks` só `service_role` (RPC com anon deve falhar)

## Ordem recomendada (mudança RAG)

1. Migration SQL
2. Deploy `knowledge-ask` + `eros-knowledge-query`
3. Smoke eval (notebook ou script)
4. Worker só se mudou `src/`
