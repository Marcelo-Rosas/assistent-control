# Receita CNAE 9313100 KPIs Loop — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Scout CSV CNAE 9313100 (janela mês + diff dump) → JSON KPIs → rota `/receita` com drill UF/cidade/bairro e seletor de mês.

**Architecture:** Script TypeScript puro agrega CSVs + snapshot; escreve `data/processed` + `public/receita/`; React fetch JSON estático. Supabase = fora v1.

**Tech Stack:** `tsx`, CSV parse (readline/`csv-parse` se já no repo ou split manual), React + react-router, `municipioMapper.ts`.

**Spec:** `Docs/superpowers/specs/2026-08-03-receita-cnae-loop-design.md`

## Global Constraints

- Só CNAE principal 9313100 nos CSVs já filtrados
- Mês = `YYYY-MM`; datas Receita `YYYYMMDD`
- Cidade via RFB mapper; fallback `RFB:{code}`
- Não download zip Receita; não ingest RAG neste plan
- Não upsert Supabase (fase 2)
- Windows PowerShell-friendly
- Commit só se humano pedir

---

## File map

| Path | Responsibility |
|------|----------------|
| `scripts/lib/receitaKpis.ts` | Pure: parse date, month filter, aggregate, diff |
| `scripts/lib/receitaKpis.test.ts` | Unit tests |
| `scripts/receita-cnae-scout-kpis.ts` | CLI Scout |
| `public/receita/.gitkeep` + generated JSON | Artefatos UI |
| `src/components/ReceitaMercadoDashboard.tsx` | UI KPIs |
| `src/App.tsx` | Rota `/receita` |
| `src/components/Sidebar.tsx` | Menu item |
| `.agents/skills/receita-cnae-loop/SKILL.md` | Skill agente |
| `Docs/ops/receita-loop.md` + `receita-loop-state.md` | Ops + state |
| `package.json` | `scout:receita-kpis`, `test:receita-kpis` |

---

### Task 1: Helpers puros + testes

**Files:**
- Create: `scripts/lib/receitaKpis.ts`
- Create: `scripts/lib/receitaKpis.test.ts`

**Interfaces:**
- `parseRfDate(raw: string | number): string | null` → `YYYY-MM-DD`
- `monthOf(isoDate: string): string` → `YYYY-MM`
- `normalizeBairro(s: string): string`
- `type CnpjRow = { cnpj, situacao_cadastral, data_inicio_atividade, data_situacao_cadastral, uf, municipio, bairro, nome_fantasia }`
- `filterEntrantes(rows, month): CnpjRow[]` — sit `02` (ou qualquer) com `monthOf(data_inicio)=month`
- `filterBaixados(rows, month): CnpjRow[]` — sit `08` e `monthOf(data_situacao)=month`
- `diffSnapshots(prev: Map&lt;cnpj,sit&gt;, curr: Map&lt;cnpj,sit&gt;): { novos, baixados }`
- `buildKpiTree(rowsAtivos, entrantes, baixados, diff, resolveCity): ReceitaKpisFile`

- [ ] **Step 1: Write failing tests** (fixtures mini 4–6 rows)
- [ ] **Step 2: Run — expect FAIL**
- [ ] **Step 3: Implement helpers**
- [ ] **Step 4: Run — expect PASS**
- [ ] **Step 5: Commit** (se pedido)

---

### Task 2: CLI Scout

**Files:**
- Create: `scripts/receita-cnae-scout-kpis.ts`
- Modify: `package.json` — `scout:receita-kpis`, `test:receita-kpis`
- Create: `public/receita/.gitkeep`

**Behavior:**
- Args: `--month YYYY-MM` (default: mês anterior ao `today`), `--write-public` (default true), `--ativos-csv`, `--baixada-csv`, `--snapshot path`
- Lê CSVs (stream ou readFile — 57k ok em memória)
- Resolve cidade: import dinâmico ou JSON `municipios-rfb-tom.json` (evitar puxar `.ts` de 66k linhas no bundle UI — no script CLI pode importar mapper)
- Escreve delta + kpis + public + months.json + atualiza snapshot
- Exit 0 + summary JSON stdout

- [ ] **Step 1: Implement CLI**
- [ ] **Step 2: Run**

```powershell
npm run scout:receita-kpis -- --month 2025-01
```

Expected: `public/receita/kpis-latest.json` existe; `totals.ativos > 0`.

- [ ] **Step 3: Commit** (se pedido)

---

### Task 3: UI `/receita`

**Files:**
- Create: `src/components/ReceitaMercadoDashboard.tsx`
- Modify: `src/App.tsx` — route
- Modify: `src/components/Sidebar.tsx` — item `receita` (permission `read_dashboard` ou `access_eros`)

**UI:**
- `useEffect` fetch `/receita/months.json` + `/receita/kpis-{month}.json` (ou latest)
- Cards totais
- Lista `by_uf`; click → `children` cidades; click → bairros
- Seletor `<select>` meses
- Empty: mensagem com comando scout

- [ ] **Step 1: Implement component + route + sidebar**
- [ ] **Step 2: Manual** — `npm run dev` → `/receita` após scout
- [ ] **Step 3: Commit** (se pedido)

---

### Task 4: Skill + ops + state

**Files:**
- Create: `.agents/skills/receita-cnae-loop/SKILL.md`
- Create: `Docs/ops/receita-loop.md`
- Create: `Docs/ops/receita-loop-state.md`
- Modify: spec Status → `approved` após review humano

- [ ] **Step 1: Write docs/skill**
- [ ] **Step 2: Mark spec approved**
- [ ] **Step 3: Commit** (se pedido)

---

## Spec coverage

| Spec | Task |
|------|------|
| Janela mês entrantes/baixados | Task 1–2 |
| Diff dump | Task 1–2 |
| JSON + public/ | Task 2 |
| KPIs UF/cidade/bairro | Task 1–2 |
| Rota + seletor | Task 3 |
| Mapper RFB | Task 2 |
| Skill/state | Task 4 |
| Non-goals zip/RAG/Supabase | docs |

## Placeholder scan

Nenhum TBD nas Tasks 1–4.
