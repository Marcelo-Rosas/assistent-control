# Regulatório CONFEF/CREF — loop state

> Atualizado pelo skill `regulatorio-confef-loop`. Agente **lê primeiro** em cada tick.

## Meta

| Campo | Valor |
|-------|--------|
| group_id | `b7dad505-2d2a-49a9-bbaf-d4b9c4929dea` |
| env | `REGULATORIO_GROUP_ID` |
| sentinel | `AGENT_LOOP_TICK_regulatorio` |
| cadência | 1d Scout+Analyst; ingest só se approved |
| spec | `Docs/superpowers/specs/2026-08-03-regulatorio-confef-cref-loop-design.md` |

## last_tick

- **ISO:** 2026-08-03T18:25:22.072Z
- **Resultado:** drop
- **ingest_count:** 0
- **amber_count:** 0

## Verifier queries

1. Qual anuidade/processo CREF 2026?
2. Academia precisa registro CREF PJ?
3. Qual CREF cobre UF X? _(default X=CE se sem delta regional)_

## last_smoke

| Query | HTTP | Notas |
|-------|------|-------|
| — | — | ainda não rodou |

## urls_seen

<!-- hash | url | title | first_seen | last_seen | last_decision -->

ad7f16a78a0d | https://www.confef.org.br/comunicacao/noticias/exemplo | Exemplo | 2026-08-03 | 2026-08-03 | drop

a240df15209f | https://www.confef.org.br/comunicacao/noticias/1841 | CIP digital e-CIP | 2026-06-24 | 2026-06-24 | ingest

f2ca7001434c | https://www.confef.org.br/comunicacao/noticias/1840 | Simposio fiscalizacao protocolos | 2026-06-22 | 2026-06-22 | ingest

b11937949752 | https://www.confef.org.br/comunicacao/noticias/1837 | Cinco novos CREFs | 2026-06-13 | 2026-06-13 | drop

6c0452742288 | https://www.confef.org.br/comunicacao/noticias/1844 | Encontro Departamentos Registro | 2026-07-28 | 2026-07-28 | drop

## decisions (ticks recentes)

<!-- YYYY-MM-DD | url_or_slug | decision | reason_1_line -->

2026-08-03 | https://www.confef.org.br/comunicacao/noticias/exemplo | drop | dry-run drop

2026-06-24 | https://www.confef.org.br/comunicacao/noticias/1841 | ingest | lido: app e-CIP + renovacao 30-90d

2026-06-22 | https://www.confef.org.br/comunicacao/noticias/1840 | ingest | lido: Acordao TCU 309/2026; aguarda Plenario

2026-06-13 | https://www.confef.org.br/comunicacao/noticias/1837 | drop | ja coberto mapa_uf_cref Resolucoes 623-627

2026-07-28 | https://www.confef.org.br/comunicacao/noticias/1844 | drop | encontro institucional sem norma

## amber (aberto)

<!-- id | opened | claim | source_url | status open/resolved -->

_(vazio)_

## pass_rate_window

- janela: últimos 7 ticks com ingest
- pass / fail: 0 / 0
- nota: bootstrap

## Digest semanal

- **última emissão:** —
- **próxima devida:** após 7 ticks ou pedido humano
