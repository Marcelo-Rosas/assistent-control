# Receita CNAE Loop — Relatórios gerenciais + Blog GymSite

Date: 2026-08-04  
Status: approved (design dialogue 2026-08-04)  
Parent: `Docs/superpowers/specs/2026-08-03-receita-cnae-loop-design.md`  
Scope: nova task no loop Receita — Top N trimestral → ficha determinística → skill blog → Markdown em `Docs/blog/gymsite/`

## Problem

Dashboard `/receita` e Scout mensal mostram movimento CNAE 9313100, mas não geram **relatório gerencial causa/efeito** (vida do CNPJ, bairros, onda de fechamentos, demografia/PIB) nem o **primeiro material** do projeto Blog GymSite.

Sem isso: humano interpreta CSV/KPI à mão; blog sem pipeline repetível com números sourced.

## Decisions (brainstorm + smokes)

| Tema | Escolha |
|------|---------|
| Unidade geográfica | Top N cidades do período (série curta) |
| Rankings | Dois: mortalidade (baixados) + crescimento (saldo); até 2N posts |
| N | CLI `--n` a cada tick (sem default fixo no produto; ops escolhe) |
| Janela blog | **Trimestral** (KPI dashboard permanece mensal) |
| Métrica ranking | **Absoluto** (contagem), não taxa |
| Vida CNPJ baixado | Faixas `<1a` / `1–3a` / `3–5a` / `5a+` **+ mediana** |
| Relação fechamentos | Cluster **bairro** + **onda temporal** N meses (default 3) |
| Demografia / PIB / renda | **Live GymSite** (`municipio_pib` + `renda_bairro` via Supabase GymSite) |
| Saída blog | Markdown em `Docs/blog/gymsite/` |
| Prosa | LLM via **skill especialista**; números **só** da ficha |
| Arquitetura | Task nova **dentro** do loop Receita (não loop blog separado) |

### Smoke evidence (2026-08-04)

- Top N 6m (`receita-topn-smoke-6m.json`): Jaccard mês→mês ~0.5 — reforça trimestral.
- Vida (`receita-lifespan-smoke-6m.json`): mediana window 5.44a; bairro mensal sparse.
- Enrich A live (`receita-enrich-gymsite-smoke.json`): PIB + renda OK nas cidades amostra.
- Enrich C local bateu 5/5 com A; decisão final = **A (live)**.

## Goals

1. Script `report:receita-blog` agrega trimestre, elege Top N mortalidade + Top N crescimento, monta **ficha JSON** por cidade.
2. Ficha inclui movimento, vida (faixas + mediana), bairros, onda, enrich GymSite (ou `indisponivel`).
3. Skill `.agents/skills/gymsite-blog-receita/` gera Markdown (1 ficha → 1 post).
4. Cidade nas duas listas → **um** post com ambos ângulos.
5. Atualizar `Docs/ops/receita-loop.md` + `receita-loop-state.md` com tick trimestral blog.

## Non-goals (v1)

- Publicação CMS / site GymSite automático.
- Ranking por taxa (`baixados/ativos`).
- Snapshot local híbrido (opção C testada; não adotada).
- Mapa Leaflet / geomarketing.
- Ingest RAG automático dos posts.
- Alterar schema do dashboard mensal `/receita` (só documentar relação trimestral).

## Architecture

```
CSV Receita (ativos + ativo-baixada)
  → report:receita-blog --quarter YYYY-QN --n N
  → fichas data/processed/receita-blog/{quarter}/{city-slug}.json
  → skill gymsite-blog-receita (agent)
  → Docs/blog/gymsite/{quarter}-{city-slug}-{angle}.md
  → Docs/ops/receita-loop-state.md
```

### Components

| Unit | Role | Depends on |
|------|------|------------|
| `scripts/lib/receitaBlogReport.ts` (ou extensão `receitaKpis`) | Agrega trimestre; Top N; vida; bairros; onda | CSV + `municipioMapper` |
| `scripts/receita-cnae-blog-report.ts` | CLI + enrich GymSite + write fichas | lib + env GymSite Supabase |
| `.agents/skills/gymsite-blog-receita/SKILL.md` | Narração blog; gate anti-invenção | ficha JSON |
| `Docs/blog/gymsite/` | Artefatos humanos | skill |
| Ops docs | Runbook + state | humano / loop |

## Ficha schema (v1)

```ts
type ReceitaBlogFicha = {
  generated_at: string;
  quarter: string;              // YYYY-QN
  city_key: string;             // UF|Nome
  city_label: string;
  uf: string;
  ibge?: string;
  rankings: {
    mortalidade?: { rank: number; baixados: number };
    crescimento?: { rank: number; saldo: number };
  };
  movimento: {
    ativos: number;
    entrantes: number;
    baixados: number;
    saldo: number;
  };
  vida_baixados: {
    n: number;
    median_years: number | null;
    faixas: { lt_1y: number; y1_3: number; y3_5: number; y5_plus: number }; // counts
    faixas_pct: { lt_1y: number; y1_3: number; y3_5: number; y5_plus: number }; // 0-100
  };
  bairros_fechamento: Array<{
    bairro: string;
    n: number;
    median_years: number | null;
  }>;
  onda: {
    lookback_months: number;    // default 3
    baixados_por_mes: Array<{ month: string; n: number }>;
  };
  gymsite: {
    status: 'ok' | 'indisponivel';
    pib?: { populacao: number; pib_reais: number; pib_per_capita: number; ano: number; fonte: string };
    renda?: {
      n_bairros: number;
      renda_pc_mediana: number;
      top3: Array<{ bairro: string; renda_pc: number }>;
      fonte: string;
    };
    motivo?: string;
  };
  fontes: string[];
};
```

Listas CNPJ completas **não** entram na ficha (ficar no delta/KPI se precisar).

## Skill `gymsite-blog-receita`

### Quando usar

- Após `report:receita-blog` gerar fichas.
- Humano pede “gera posts do trimestre” / “primeiro material blog GymSite”.

### Regras

1. Entrada = caminho(s) da ficha JSON. Saída = Markdown em `Docs/blog/gymsite/`.
2. **Todo número no texto deve existir na ficha.** Sem inventar PIB, renda, bairro, vida, contagem.
3. Campo `gymsite.status=indisponivel` → declarar indisponível; não completar.
4. Linguagem causa/efeito: associação / hipótese rotulada; não culpabilizar setor sem evidência na ficha.
5. Estrutura sugerida: gancho → movimento trimestre → vida/faixas → bairros + onda → PIB/renda → fechamento com CTA GymSite Intelligence (sem métrica falsa).
6. Cidade com ambos rankings → um arquivo; `angle=ambos` ou título composto.

### Nome arquivo

`{quarter}-{city-slug}-{mortalidade|crescimento|ambos}.md`

## Loop ops

Estender ciclo Receita:

```
… (scout mensal KPI inalterado)
trimestral:
  1. report:receita-blog --quarter … --n …
  2. skill gymsite-blog-receita nas fichas
  3. atualizar receita-loop-state.md (last_blog_quarter, n, paths)
```

Sentinel opcional: `AGENT_LOOP_TICK_receita_blog`.

## Commands (propostos)

```bash
npm run report:receita-blog -- --quarter 2026-Q1 --n 3
npm run test:receita-blog
```

Env: `SUPABASE_URL` + service role do **GymSite** (mesmo padrão smoke A; não o projeto logistica-containers do MCP assistent-control).

## Error handling

| Caso | Comportamento |
|------|----------------|
| Trimestre parcial (dump corta mês) | Marcar `partial: true` na meta do run; skill menciona cobertura incompleta se flag |
| GymSite down / timeout | `gymsite.status=indisponivel`; fichas e posts seguem |
| Cidade sem baixados na vida | `vida_baixados.n=0`; faixas zeradas; skill não inventa mediana |
| Bairro n&lt;2 | Omitir da lista ou listar só com n≥2 |
| Mesma cidade 2 rankings | Merge rankings na mesma ficha |

## Testing

- Unit: agregação trimestre, faixas vida, Top N merge, onda lookback.
- Smoke: `--quarter` com CSV local → ≥1 ficha; enrich real ou mock `indisponivel`.
- Gate skill (manual/agent): amostrar post e conferir cada número ∈ ficha.

## Success criteria

- `--quarter 2026-Q1 --n 3` produz ≤6 fichas e, via skill, ≤6 Markdown.
- Todo número no Markdown rastreável à ficha.
- GymSite indisponível não bloqueia geração de ficha/post Receita.
- Cidade nas duas listas → um Markdown.
- Ops docs descrevem tick trimestral blog.

## Relação com parent loop

- Scout mensal + `/receita` **inalterados** na função.
- Blog = task **adicional** trimestral no mesmo domínio Receita / mesma skill ops family.
- Não misturar com Regulatório RAG.

## Open / fase 2

- Taxa como ranking alternativo (`--rank taxa`).
- Snapshot local (C) como fallback offline.
- Push CMS GymSite.
- UI Eros listando posts gerados.
- Cobertura Brasília/distritos SP (renda agregada fraca no espelho).
