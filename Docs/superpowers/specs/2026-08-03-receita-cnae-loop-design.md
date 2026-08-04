# Receita CNAE 9313100 Refresh Loop + Dashboard KPIs

Date: 2026-08-03  
Status: approved (2026-08-03)  
Scope: loop Scout (janela mês + diff dump) → artefatos JSON → rota `/receita` com KPIs UF → cidade → bairro

## Problem

CSV Receita CNAE **9313100** (academia / atividade física) já existe em `data/processed/`, mas:

1. Não há ciclo que detecte **entrantes** vs **baixados** de forma repetível.
2. Não há dashboard no app com KPIs por UF / cidade / bairro.
3. `municipio` no CSV é código RFB — UI precisa nome legível (mapper já existe).

Sem isso: humano abre CSV de 33k–57k linhas à mão; GymSite/Eros não mostra movimento de mercado.

## Decisions (brainstorm)

| Tema | Escolha |
|------|---------|
| Entrantes / baixados | **Os dois**: janela por data **e** diff entre dumps |
| Persistência KPIs | **Híbrido**: JSON v1; upsert Supabase = fase 2 |
| Janela padrão | **Mês calendário** + seletor no dashboard |
| Arquitetura v1 | **A**: script Scout → JSON em `public/receita/` + React |

## Goals

1. Scout mensal lê CSVs CNAE 9313100 principal e calcula:
   - **Janela:** entrantes (`data_inicio_atividade` no mês) + baixados (`situacao=08` e `data_situacao_cadastral` no mês).
   - **Diff:** CNPJ presentes no dump atual e ausentes no snapshot anterior; CNPJ que passaram a `08` vs snapshot.
2. Escrever artefatos versionados + `kpis-latest.json` servido ao app.
3. Rota `/receita` com drill-down UF → cidade → bairro e seletor de mês.
4. Reusar `CODIGO_RFB_PARA_MUNICIPIO` / `municipios-rfb-tom` para nome de cidade.

## Non-goals (v1)

- Download automático dos zips Receita no loop.
- Ingest RAG automático dos deltas (script `ingest-receita-cnae` já existe — fora deste ciclo).
- Upsert Supabase (fase 2).
- Mapa Leaflet / geomarketing.
- CNAE secundário (só `cnae_match=principal` / arquivos já filtrados).
- Taxas prefeitura / Regulatório.

## Inputs

| Arquivo | Papel |
|---------|--------|
| `data/processed/receita-cnae-9313100-principal-ativos.csv` | universo ativos (`02`) |
| `data/processed/receita-cnae-9313100-principal-ativo-baixada.csv` | ativos + baixados (`02`+`08`) — fonte para baixados e snapshot completo |
| `data/processed/receita-cnpj-snapshot-prev.json` *(gerado)* | snapshot anterior p/ diff |
| `scripts/lib/municipioMapper.ts` | RFB → `{ nome, uf }` |

Datas Receita: `YYYYMMDD` string/number → normalizar `YYYY-MM-DD` / mês `YYYY-MM`.

## Outputs

| Artefato | Conteúdo |
|----------|----------|
| `data/processed/receita-delta-{YYYY-MM}.json` | listas CNPJ entrantes_mes, baixados_mes, diff_novos, diff_baixados (amostra + counts) |
| `data/processed/receita-kpis-{YYYY-MM}.json` | árvore agregada + meta |
| `public/receita/kpis-{YYYY-MM}.json` | cópia para o app |
| `public/receita/kpis-latest.json` | ponteiro = último mês gerado |
| `public/receita/months.json` | lista de meses disponíveis p/ seletor |
| `data/processed/receita-cnpj-snapshot-prev.json` | atualizado ao fim do Scout (CNPJ → sit + datas chave) |

### Schema KPI (v1)

```ts
type ReceitaKpisFile = {
  generated_at: string;       // ISO
  month: string;              // YYYY-MM
  cnae: '9313100';
  source: {
    ativos_csv: string;
    ativo_baixada_csv: string;
    snapshot_prev: string | null;
  };
  totals: {
    ativos: number;
    entrantes_mes: number;
    baixados_mes: number;
    saldo_mes: number;        // entrantes - baixados
    diff_novos: number;
    diff_baixados: number;
  };
  by_uf: ReceitaGeoNode[];
};

type ReceitaGeoNode = {
  key: string;                // UF | "UF|cidade" | "UF|cidade|bairro"
  label: string;
  ativos: number;
  entrantes_mes: number;
  baixados_mes: number;
  saldo_mes: number;
  diff_novos: number;
  diff_baixados: number;
  children?: ReceitaGeoNode[]; // cidade sob UF; bairro sob cidade
};
```

Listas completas de CNPJ ficam no **delta** (não inflar KPI JSON). Delta pode truncar `samples` a N (ex. 200) + `count`.

## Loop (primitivas)

| Primitiva | Uso |
|-----------|-----|
| Automation | `/loop` mensal ou cron pós-filter CSV; sentinel `AGENT_LOOP_TICK_receita` |
| Skills | `.agents/skills/receita-cnae-loop/SKILL.md` |
| Scout script | `scripts/receita-cnae-scout-kpis.ts` |
| State | `Docs/ops/receita-loop-state.md` |
| Worktree | só se mudar schema app em paralelo |
| Plugins | fase 2 Supabase |
| Subagents | opcional: Scout script + Verifier smoke JSON |

### Ciclo

```
1. Ler CSVs + snapshot_prev (se houver)
2. Calcular janela mês M (default = mês do dump / CLI --month)
3. Calcular diff vs snapshot
4. Agregar KPIs UF → cidade → bairro
5. Escrever delta + kpis + public/ + months.json
6. Atualizar snapshot_prev
7. Atualizar state.md
8. (humano/CI) smoke: arquivo JSON válido + totals coerentes
```

## UI `/receita`

- Rota em `App.tsx`; item Sidebar (ícone tipo `Building2` / `BarChart3`).
- Componente `ReceitaMercadoDashboard` (ou `pages/ReceitaKpis.tsx`).
- Seletor de mês ← `months.json`.
- Cards totais: ativos, entrantes, baixados, saldo, diffs.
- Tabela/drill: clicar UF → cidades → bairros.
- Empty state se `kpis-latest` ausente: “rode `npm run scout:receita-kpis`”.
- Visual: seguir padrões escuros existentes do Eros (não reinventar design system).

## Commands (propostos)

```bash
npm run scout:receita-kpis              # mês default (anterior ou CLI)
npm run scout:receita-kpis -- --month 2026-07
npm run scout:receita-kpis -- --month 2026-07 --write-public
```

## Success criteria

- Scout dry-run em CSV local &lt; ~30s em máquina dev.
- `kpis-latest.json` com `by_uf.length >= 1`.
- UI `/receita` mostra totais e drill CE → Fortaleza → bairro sem crash.
- Diff: segundo run sem mudança de CSV → `diff_novos=0` e `diff_baixados=0` (idempotente).
- Gate: `municipio` sem mapper → cidade label = `RFB:{codigo}` (não drop row).

## Open / fase 2

- Tabela Supabase `receita_cnae_kpis` + RLS.
- Wire dump download Receita → filter → scout em um pipeline.
- Alert Slack/Linear se `diff_novos` ou baixados &gt; limiar.

## Relação com Regulatório loop

Mesmo padrão operacional (Scout → artefato → state → skill). Domínio e artefatos **separados** — não misturar groups RAG.
