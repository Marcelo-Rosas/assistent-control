# Receita CNAE 9313100 — KPIs loop

Spec KPIs: `Docs/superpowers/specs/2026-08-03-receita-cnae-loop-design.md`  
Spec blog: `Docs/superpowers/specs/2026-08-04-receita-blog-gymsite-design.md`  
Skill KPIs: `.agents/skills/receita-cnae-loop/SKILL.md`  
Skill blog: `.agents/skills/gymsite-blog-receita/SKILL.md`  
UI: `/receita` · Posts: `Docs/blog/gymsite/`

## Gerar KPIs (mensal)

```powershell
npm run scout:receita-kpis -- --month 2025-01
npm run test:receita-kpis
```

Default mês = calendário anterior.  
`--no-write-public` só grava em `data/processed/`.

## Blog trimestral

```powershell
npm run report:receita-blog -- --quarter 2026-Q1 --n 3
npm run test:receita-blog
```

- `--n` obrigatório (Top N mortalidade + Top N crescimento; merge se overlap).
- `--skip-enrich` se GymSite Supabase indisponível.
- Fichas: `data/processed/receita-blog/{quarter}/`
- Posts: skill `gymsite-blog-receita` → `Docs/blog/gymsite/`

Credenciais: preferir `GYMSITE_SUPABASE_URL` + `GYMSITE_SUPABASE_SERVICE_ROLE_KEY` (projeto GymSite). Fallback: `SUPABASE_*` do `.env` GymSite carregado pelo CLI.

## Entrantes / baixados

| Sinal | Regra |
|-------|--------|
| Entrantes mês | `data_inicio_atividade` no `YYYY-MM` |
| Baixados mês | `situacao=08` e `data_situacao_cadastral` no mês |
| Diff novos | CNPJ no dump atual ausente do snapshot anterior |
| Diff baixados | saiu do snapshot ou virou `08` |

## Dashboard

1. `npm run scout:receita-kpis -- --month …`
2. `npm run dev` → Sidebar **Receita CNAE** → `/receita`
3. Seletor de mês; click UF → cidade → bairro

## Fora de escopo v1

Zip download Receita, ingest RAG, upsert KPIs Supabase, mapa, CMS blog automático.
