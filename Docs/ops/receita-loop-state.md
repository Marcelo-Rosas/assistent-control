# Receita CNAE loop — state

> Atualizado após scout KPIs e/ou report blog.

## Meta

| Campo | Valor |
|-------|--------|
| cnae | `9313100` |
| sentinel | `AGENT_LOOP_TICK_receita` |
| sentinel blog | `AGENT_LOOP_TICK_receita_blog` |
| UI | `/receita` |
| blog | `Docs/blog/gymsite/` |
| spec KPIs | `Docs/superpowers/specs/2026-08-03-receita-cnae-loop-design.md` |
| spec blog | `Docs/superpowers/specs/2026-08-04-receita-blog-gymsite-design.md` |

## last_tick (KPIs)

- **ISO:** 2026-08-28T (local)
- **month:** 2026-07 (último mês com dados no dump)
- **dump:** RFB `2026-07` / `Estabelecimentos0.zip` → corte **20260710**
- **Resultado:** ok
- **ativos:** 34.059
- **entrantes_mes (2026-07):** 172 (parcial — dump até dia 10)
- **baixados_mes (2026-07):** 66
- **saldo_mes (2026-07):** 106
- **meses publicados:** 2026-05, 2026-06, 2026-07, 2026-08 (ago=0 — sem dados no dump)

### KPIs recentes

| Mês | Entrantes | Baixados | Saldo |
|-----|-----------|----------|-------|
| 2026-05 | 495 | 148 | +347 |
| 2026-06 | 538 | 152 | +386 |
| 2026-07 | 172 | 66 | +106 |
| 2026-08 | 0 | 0 | 0 |

## last_blog_quarter

- **ISO:** 2026-08-04
- **quarter:** 2026-Q1
- **n:** 3
- **fichas:** 5 (SP ambos; demais 1 ângulo)
- **gymsite:** ok (5/5 com enrich live)
- **paths:** `data/processed/receita-blog/2026-Q1/*.json`
- **sample post:** `Docs/blog/gymsite/2026-Q1-belo-horizonte-mg-crescimento.md`

## notes

- Scripts recriados: `scripts/fetch-receita-estabelecimentos.ps1`, `scripts/filter-receita-cnae-academias.py`
- Zip bruto em `D:\receita-raw\2026-07\` (~2 GB); CSV extraído em `D:\receita-estab-filter\`
- Zip antigo `Estabelecimentos0-2026-05.zip` removido de C: (liberou ~2 GB)
- Snapshot: `data/processed/receita-cnpj-snapshot-prev.json`
- Blog: ranking absoluto trimestral; vida faixas+mediana; enrich GymSite live.
