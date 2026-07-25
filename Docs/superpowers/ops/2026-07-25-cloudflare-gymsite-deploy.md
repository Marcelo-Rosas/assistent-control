# Ops — Cloudflare deploy (GymSite SPA)

**Date:** 2026-07-25  
**Worker:** `gymsite-pipeline`  
**Scope:** Frontend SPA only. Supabase Edge unchanged.

## Rotas host (decisão)

| Papel | Host | Uso |
|-------|------|-----|
| **Produção** | `https://app-assistent.gymsite.com.br` | Cliente / time — canônico |
| **Preview / staging** | `https://preview-assistent.gymsite.com.br` | QA antes de promover |
| **Ephemeral** | `https://gymsite-pipeline.marcelo-rosas.workers.dev` + Preview URLs por versão | CI / smoke pós-`wrangler deploy` |

`app-assistent-gymsite.com.br` (hífen, domínio 2º nível) = fora até zona própria no Dashboard.

Apex `gymsite.com.br` = marketing — **não** neste Worker.

## Architecture

```
Browser prod    → app-assistent.gymsite.com.br     → Worker ASSETS
Browser preview → preview-assistent.gymsite.com.br → mesmo Worker (mesmo dist até haver env separado)
Browser ephemeral → *.workers.dev (+ version preview URLs)
                 → VITE_SUPABASE_* → Supabase Edge
Evolution → …/eros-evolution-webhook (Supabase)
```

Hoje prod e preview apontam pro **mesmo** script. Separar build/env depois se precisar (ex. `env.preview` no wrangler + segundo Worker).

## Deploy

```powershell
# .env.production com VITE_SUPABASE_*
npm run deploy
```

Flags no `wrangler.jsonc`: `workers_dev: true`, `preview_urls: true`.

## Checklist

- [x] Produção: `https://app-assistent.gymsite.com.br/`
- [x] Preview: `https://preview-assistent.gymsite.com.br/`
- [x] workers.dev + previews_enabled
- [ ] Hard refresh rotas SPA sem 404
- [ ] Supabase Realtime / WA OK

## Não fazer

- Não colocar `EVOLUTION_*` / `SAKANA_*` no build Vite
- Não migrar webhook Evolution para este Worker neste passo
