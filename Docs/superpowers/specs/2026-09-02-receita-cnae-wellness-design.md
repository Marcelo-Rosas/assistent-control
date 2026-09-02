# Receita CNAE Wellness — multi-segmento (pilates, luta, dança, clínica, spa, fisio)

Date: 2026-09-02  
Status: **approved — Fase 1 implemented (2026-09-02)**  
Scope: expandir universo Receita além de `9313100` para prospecção GymSite, KPIs `/receita` por segmento e catálogo bairro — mesmo schema JSON do dump atual + campos de segmento.

## Problem

O pipeline atual (`filter-receita-cnae-academias.py`) filtra só **CNAE 9313100**. Estabelecimentos como **[Vivedouro Saúde Integrada](https://vivedouro.com.br/)** — clínica multidisciplinar com academia no site e no TotalPass — **não aparecem** no JSON porque:

- CNAE principal = `8630599` (atenção ambulatorial NE)
- Secundários incluem `8630503`, `8711501`, `8650001`, etc.
- **`9313100` ausente** (principal e secundário)

Gap: prospecção, KPIs de mercado e catálogo bairro subestimam “saúde integrada” e studios classificados fora de condicionamento físico.

## Decisions (brainstorm 2026-09-02)

| Tema | Escolha |
|------|---------|
| Escopo | **D** — prospecção GymSite + KPIs dashboard + catálogo bairro |
| Arquitetura filter | **A** — generalizar script DuckDB com config multi-CNAE |
| Output | Union `receita-cnae-wellness.json` + slices `-principal-ativos` / `-principal-ativo-baixada` |
| Compat | Manter artefatos `9313100-*` (subset ou `--legacy`) |
| Clínica | Incluir **`8630599`** e **`8711501`** além de `8630503` |
| Fixture canônica | **Vivedouro** `29460053000177` — teste de presença pós-filter |
| Pilates | Tag heurística `nome_fantasia` sobre universo `9313100`, não CNAE separado |

## Canonical fixture — Vivedouro

Referência validada via [Brasil API](https://brasilapi.com.br/api/cnpj/v1/29460053000177) + TotalPass (`vivedouro-geriatria-ltda`, Alfredo Pujol 1117).

| Campo | Valor |
|-------|-------|
| CNPJ | `29460053000177` |
| Razão social | VIVEDOURO SAUDE INTEGRADA LTDA |
| Nome fantasia | VIVEDOURO SAUDE INTEGRADA |
| Endereço | Rua Alfredo Pujol, 1117, Santana, SP |
| CNAE principal | `8630599` |
| CNAE secundários | `4771701,7210000,8412400,8599604,8610101,8610102,8630501,8630503,8630506,8640205,8640210,8650001,8660700,8711501` |
| Segmento esperado | `clinica` |
| Tags esperadas | `geriatria` (CNAE `8711501` ou nome) |
| **Não** deve aparecer em | `receita-cnae-9313100.json` |
| **Deve** aparecer em | `receita-cnae-wellness-principal-ativos.json` |

Arquivo fixture: `data/fixtures/receita-wellness-vivedouro.json` (snapshot estável para testes).

## Segment config

Arquivo: `data/config/receita-cnae-segments.json`

```json
{
  "version": 1,
  "segments": [
    { "id": "academia",     "cnae": "9313100", "label": "Condicionamento físico" },
    { "id": "esportes",     "cnae": "8591100", "label": "Ensino de esportes (luta)" },
    { "id": "danca",        "cnae": "8592901", "label": "Ensino de dança" },
    { "id": "spa_estetica", "cnae": "9602502", "label": "Estética / spa" },
    { "id": "clinica",      "cnae": "8630503", "label": "Clínica ambulatorial (consultas)" },
    { "id": "clinica_ne",   "cnae": "8630599", "label": "Atenção ambulatorial NE" },
    { "id": "geriatria",    "cnae": "8711501", "label": "Clínicas geriátricas" },
    { "id": "fisioterapia", "cnae": "8650004", "label": "Fisioterapia" }
  ],
  "segment_groups": {
    "clinica": ["clinica", "clinica_ne", "geriatria"]
  },
  "tags": [
    { "id": "pilates",    "match": "nome_fantasia", "pattern": "(?i)pilates" },
    { "id": "geriatria",  "match": "nome_fantasia", "pattern": "(?i)geriatria" }
  ]
}
```

**Dedup (1 row / CNPJ):**

1. Preferir match onde `cnae_fiscal_matched` = CNAE **principal**
2. Empate: ordem da config (academia → esportes → … → fisioterapia)
3. `cnae_segment` = `id` do segmento vencedor; UI agrupa clínica via `segment_groups.clinica`

**Tags:** aplicadas após dedup; não alteram segmento — campo `cnae_tags: string[]`.

## Record schema (extends current)

Campos existentes (`OUT_FIELDS` em `filter-receita-cnae-academias.py`) **inalterados**, mais:

| Campo | Tipo | Exemplo |
|-------|------|---------|
| `cnae_segment` | string | `clinica_ne` |
| `cnae_fiscal_matched` | string | `8630599` |
| `cnae_tags` | string[] | `["geriatria"]` |

Array JSON flat (mesmo formato que `receita-cnae-9313100.json`).

## Scripts & outputs

| Script | Ação |
|--------|------|
| `scripts/filter-receita-cnae-wellness.py` | Novo — generaliza filter com config |
| `scripts/filter-receita-cnae-academias.py` | Wrapper fino → `--legacy` ou chama wellness com subset `9313100` |
| `npm run filter:receita-wellness` | Novo comando package.json |

| Output | Conteúdo |
|--------|----------|
| `data/processed/receita-cnae-wellness.json` | Union todos CNAEs config |
| `data/processed/receita-cnae-wellness-principal-ativos.json` | principal + situação `02` |
| `data/processed/receita-cnae-wellness-principal-ativo-baixada.json` | principal + `02`/`08` |
| `data/processed/receita-cnae-9313100-*.json` | Mantidos (backward compat) |

## Phased delivery

### Fase 1 — Filter + fixture + test (this plan)

- Config + filter wellness
- Fixture Vivedouro + test unitário: CNPJ presente, segmento `clinica_ne`, ausente em 9313100 slice
- Smoke: contagem por `cnae_segment` no stdout

### Fase 2 — Scout KPIs + `/receita`

- Generalizar `receita-cnae-scout-kpis.ts` / `receitaKpis.ts` para fonte wellness
- KPIs totais + `by_segment`
- Dashboard: seletor segmento (All | academia | clinica | …)

### Fase 3 — Prospecção + bairro

- `gymsiteReceitaEnrich.ts`: fonte wellness + filtro segmento
- Cross-ref CNPJ/endereço com agregadores WH/TP/GP
- `build-bairros-catalog-*.ts`: `--source=wellness --segment=…`

## Non-goals (v1 filter)

- Download automático zip Receita (continua manual / `fetch-receita-estabelecimentos.ps1`)
- Ingest RAG automático dos novos CNAEs
- Upsert Supabase
- CNAEs hospitalares pesados (`8610101`, `8610102`) como segmento próprio — entram no dump se listados na config futura; v1 **não** inclui (só secundário de clínicas como Vivedouro via match principal `8630599`)

## Volume guardrails

| Segmento | CNAE | Risco volume |
|----------|------|--------------|
| spa_estetica | 9602502 | alto (~100k+) |
| clinica | 8630503 | alto |
| clinica_ne | 8630599 | médio-alto |
| academia | 9313100 | ~34k ativos (baseline) |

Dashboard e prospecção: **default UF T4** ou filtro cidade na UI; scout BR completo opcional via CLI.

## Tests

| Test | Assert |
|------|--------|
| `receitaWellnessFilter.test.ts` ou pytest | Vivedouro CNPJ in wellness principal-ativos |
| | Vivedouro `cnae_segment` ∈ `clinica_ne`, `geriatria` group |
| | Vivedouro `cnae_tags` contains `geriatria` |
| | Vivedouro **not** in 9313100-only export |
| Dedup | CNPJ com principal `8591100` + secundário `9313100` → segment `esportes` |

## Success criteria

- `filter-receita-cnae-wellness.py` roda sobre dump local existente (`D:/receita-estab-filter`)
- Vivedouro presente no JSON wellness ativos
- Contagem por segmento logged; academia ≈ baseline 9313100 ativos
- Zero regressão: `9313100-principal-ativos.json` row count unchanged quando gerado via `--legacy`

## Commands (propostos)

```bash
npm run filter:receita-wellness
npm run filter:receita-wellness -- --smoke
python scripts/filter-receita-cnae-wellness.py --skip-extract
npm test -- receitaWellness
```

## Relação com loops existentes

- **receita-cnae-loop** (9313100 KPIs): continua; wellness = extensão fase 2
- **Bairros catalog**: passa a poder usar wellness como fonte alternativa
- **Recomendador planos**: Vivedouro já classificado `estabelecimento_saude` — passa a ter espelho Receita

## Open questions (resolved)

| Q | A |
|---|---|
| Incluir 8630599 / 8711501? | **Sim** — fixture Vivedouro |
| Escopo spa/clínica BR ou T4? | Filter BR; UI/KPIs default T4 na v1 |

## Next step

Após aprovação desta spec → `writing-plans` → plano de implementação Fase 1.
