# Env & secrets — regras

## Arquivos

| Arquivo | Uso |
|---------|-----|
| `.env.local` | Dev local (gitignore) — **fonte principal** |
| `.env.example` | Template sem secrets |
| `.env` | Pode ser diretório nesta máquina — scripts devem skip se não for arquivo |

## Frontend (VITE_)

```env
VITE_SUPABASE_URL=https://gxmaxbjgdrqdcizvdojp.supabase.co
VITE_SUPABASE_ANON_KEY=...
```

Browser **nunca** recebe `SERVICE_ROLE`.

## Scripts / notebooks (server)

```env
SUPABASE_URL=https://gxmaxbjgdrqdcizvdojp.supabase.co
SUPABASE_SERVICE_ROLE_KEY=...
```

## Group IDs (exemplos — conferir `.env.local`)

```env
GURUPASS_GROUP_ID=4d1e2c40-217b-4a39-bc08-f9c3e90fd803
ENGENHEIRO_GROUP_ID=f087bfc8-ad2b-434c-bc18-a38608be183d
```

Criar novo grupo: `npm run setup:<dominio>` → gravar ID no env.

## Embeddings

```env
EMBEDDING_PROVIDER=ollama
OLLAMA_BASE_URL=https://ollama2.vectracargo.com.br
EMBEDDING_MODEL=mxbai-embed-large
EMBEDDING_DIMENSION=1024
RAG_MIN_SIMILARITY=0.35
RAG_TOP_K=5
```

## Edge secrets (prod)

Não prefixar com `VITE_`:

- `SAKANA_API_KEY`, `EVOLUTION_*`, `OLLAMA_BASE_URL`
- Push: `scripts/push-edge-secrets.ps1`

Local serve:

```bash
supabase functions serve --env-file .env.local
```

## Regras

- Nunca commitar `.env.local`
- RPC `match_chunks` = service_role (migration 20260729)
- JWT tenant: `app_metadata.company_id` (não `user_metadata`)
