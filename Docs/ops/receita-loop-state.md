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

- **ISO:** 2026-08-03T (local)
- **month:** 2025-01
- **Resultado:** ok
- **ativos:** 33569
- **entrantes_mes:** 466
- **baixados_mes:** 162
- **saldo_mes:** 304
- **diff_novos (2º run):** 0
- **diff_baixados (2º run):** 0

## last_blog_quarter

- **ISO:** 2026-08-04
- **quarter:** 2026-Q1
- **n:** 3
- **fichas:** 5 (SP ambos; demais 1 ângulo)
- **gymsite:** ok (5/5 com enrich live)
- **paths:** `data/processed/receita-blog/2026-Q1/*.json`
- **sample post:** `Docs/blog/gymsite/2026-Q1-belo-horizonte-mg-crescimento.md`

## notes

- 1º run KPI sem snapshot → `diff_novos` = tamanho dump (esperado).
- Snapshot: `data/processed/receita-cnpj-snapshot-prev.json`
- Blog: ranking absoluto trimestral; vida faixas+mediana; enrich GymSite live.
