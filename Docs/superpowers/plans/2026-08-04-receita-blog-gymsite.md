# Receita Blog GymSite — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Trimestre Top N (mortalidade + crescimento) → fichas JSON sourced → skill blog → Markdown em `Docs/blog/gymsite/` (1º material Blog GymSite).

**Architecture:** Helpers puros agregam CSV por trimestre; CLI monta fichas e enriquece live GymSite Supabase (`municipio_pib` + `renda_bairro`); skill agente narra Markdown só a partir da ficha. Dashboard mensal `/receita` intocado.

**Tech Stack:** `tsx`, `node:test`, `@supabase/supabase-js`, `municipioMapper` / `municipios-rfb-tom.json`, Agent Skill Markdown.

**Spec:** `Docs/superpowers/specs/2026-08-04-receita-blog-gymsite-design.md`

## Global Constraints

- CNAE principal 9313100 nos CSVs já filtrados
- Blog = janela **trimestral** (`YYYY-QN`); KPI mensal permanece separado
- Ranking = **absoluto**; `--n` obrigatório no CLI (sem default de produto; exemplos usam `3`)
- Vida = faixas `<1` / `1–3` / `3–5` / `5+` anos **+ mediana**; counts + pct
- Onda default lookback **3** meses (`--onda-months`)
- GymSite **live**; falha → `gymsite.status=indisponivel` (não bloqueia)
- Skill: **proibido inventar número**; todo valor no MD ∈ ficha
- Cidade nas 2 listas → **uma** ficha / **um** post
- Windows PowerShell-friendly
- Commit só se humano pedir
- Não CMS, não ranking por taxa, não mudar UI `/receita` neste plan

---

## File map

| Path | Responsibility |
|------|----------------|
| `scripts/lib/receitaBlogReport.ts` | Pure: quarter↔months, vida/faixas, Top N, onda, merge rankings, build ficha (sem I/O rede) |
| `scripts/lib/receitaBlogReport.test.ts` | Unit tests |
| `scripts/lib/gymsiteReceitaEnrich.ts` | Client Supabase GymSite → bloco `gymsite` da ficha |
| `scripts/lib/gymsiteReceitaEnrich.test.ts` | Unit com fetch/client mock |
| `scripts/receita-cnae-blog-report.ts` | CLI: CSV → Top N → enrich → write fichas |
| `data/processed/receita-blog/.gitkeep` | Pasta fichas |
| `Docs/blog/gymsite/.gitkeep` | Pasta posts |
| `.agents/skills/gymsite-blog-receita/SKILL.md` | Skill narração |
| `Docs/ops/receita-loop.md` | Estender tick trimestral blog |
| `Docs/ops/receita-loop-state.md` | `last_blog_quarter` |
| `.agents/skills/receita-cnae-loop/SKILL.md` | Link para report blog |
| `package.json` | `report:receita-blog`, `test:receita-blog` |

---

### Task 1: Helpers puros (trimestre, vida, Top N, onda)

**Files:**
- Create: `scripts/lib/receitaBlogReport.ts`
- Create: `scripts/lib/receitaBlogReport.test.ts`

**Interfaces:**
- Consumes: `CnpjRow`, `parseRfDate`, `monthOf`, `normalizeBairro` from `./receitaKpis.ts`
- Produces:
  - `parseQuarter(q: string): { year: number; q: number }` — throws se não `^\d{4}-Q[1-4]$`
  - `monthsInQuarter(quarter: string): string[]` — ex. `2026-Q1` → `['2026-01','2026-02','2026-03']`
  - `lifeDays(inicioRaw: string, baixaRaw: string): number | null`
  - `buildVidaStats(lifeDaysList: number[]): { n, median_years, faixas, faixas_pct }`
  - `type CityMovimento = { key, label, uf, ibge?, ativos, entrantes, baixados, saldo }`
  - `rankTopN(cities: CityMovimento[], n: number): { mortalidade: CityMovimento[]; crescimento: CityMovimento[] }`
  - `mergeRankedCities(mort, cresc): Array<CityMovimento & { rankings: ReceitaBlogFicha['rankings'] }>`
  - `buildOnda(baixadosRows: CnpjRow[], cityKey: string, endMonth: string, lookback: number, resolveKey): { lookback_months, baixados_por_mes }`
  - `buildBairrosFechamento(baixadosInQuarter: CnpjRow[], cityKey, resolveKey, minN=2): Array<{bairro,n,median_years}>`
  - `type ReceitaBlogFicha` — espelhar spec (sem `gymsite` preenchido: stub `indisponivel` ou omitir até Task 2)
  - `buildFichaBase(...): Omit<ReceitaBlogFicha, 'gymsite'> & { gymsite?: never }` — ou `buildFichaBase` retorna ficha com `gymsite: { status: 'indisponivel', motivo: 'pending_enrich' }`

- [ ] **Step 1: Write failing tests**

```ts
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  monthsInQuarter,
  buildVidaStats,
  rankTopN,
  mergeRankedCities,
} from './receitaBlogReport.ts';

describe('monthsInQuarter', () => {
  it('maps Q1', () => {
    assert.deepEqual(monthsInQuarter('2026-Q1'), ['2026-01', '2026-02', '2026-03']);
  });
});

describe('buildVidaStats', () => {
  it('faixas + mediana', () => {
    // 100, 400, 800, 2000 days ≈ buckets
    const s = buildVidaStats([100, 400, 800, 2000]);
    assert.equal(s.n, 4);
    assert.ok(s.median_years !== null);
    assert.equal(s.faixas.lt_1y + s.faixas.y1_3 + s.faixas.y3_5 + s.faixas.y5_plus, 4);
  });
});

describe('rankTopN + merge', () => {
  it('merge same city once', () => {
    const cities = [
      { key: 'SP|São Paulo', label: 'São Paulo/SP', uf: 'SP', ativos: 100, entrantes: 10, baixados: 5, saldo: 5 },
      { key: 'CE|Fortaleza', label: 'Fortaleza/CE', uf: 'CE', ativos: 50, entrantes: 1, baixados: 4, saldo: -3 },
      { key: 'MG|Belo Horizonte', label: 'Belo Horizonte/MG', uf: 'MG', ativos: 60, entrantes: 8, baixados: 1, saldo: 7 },
    ];
    const { mortalidade, crescimento } = rankTopN(cities, 2);
    const merged = mergeRankedCities(mortalidade, crescimento);
    const keys = merged.map((c) => c.key);
    assert.equal(new Set(keys).size, keys.length);
    const sp = merged.find((c) => c.key.startsWith('SP|'));
    assert.ok(sp?.rankings.mortalidade || sp?.rankings.crescimento);
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

```powershell
npx tsx --test scripts/lib/receitaBlogReport.test.ts
```

Expected: FAIL module not found / export missing.

- [ ] **Step 3: Implement `receitaBlogReport.ts`**

Regras:
- `lifeDays`: parse RF dates; `null` se inválido ou baixa &lt; inicio.
- Faixas em **anos** (`days/365.25`): `<1`, `[1,3)`, `[3,5)`, `≥5`.
- `median_years`: mediana de days / 365.25, `null` se n=0.
- `rankTopN`: mortalidade sort `-baixados,-entrantes,key`; crescimento sort `-saldo,-entrantes,key`; slice `n`.
- `mergeRankedCities`: union por `key`; preenche `rankings.mortalidade` / `crescimento` com `{ rank: 1-based, baixados|saldo }`.
- Agregar movimento cidade: reutilizar resolve cidade igual Scout (`CODIGO_RFB_PARA_MUNICIPIO` ou JSON `by_rfb`); key = `UF|nome`.

- [ ] **Step 4: Run — expect PASS**

```powershell
npx tsx --test scripts/lib/receitaBlogReport.test.ts
```

- [ ] **Step 5: Commit** (se pedido)

```powershell
git add scripts/lib/receitaBlogReport.ts scripts/lib/receitaBlogReport.test.ts
git commit -m "feat(receita): blog report pure helpers (quarter/vida/topN)"
```

---

### Task 2: Enrich GymSite live

**Files:**
- Create: `scripts/lib/gymsiteReceitaEnrich.ts`
- Create: `scripts/lib/gymsiteReceitaEnrich.test.ts`

**Interfaces:**
- Consumes: `ibge: string`
- Produces:
  - `type GymsiteBloco = ReceitaBlogFicha['gymsite']`
  - `enrichCityFromGymsite(ibge: string, opts?: { url?: string; key?: string; fetchImpl? }): Promise<GymsiteBloco>`
  - Se sem url/key ou erro/timeout → `{ status: 'indisponivel', motivo: string }`
  - Se ok: `{ status: 'ok', pib: {...}, renda: {...} }` com fontes das rows

- [ ] **Step 1: Write failing tests** (mock fetch / client)

```ts
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { enrichCityFromGymsite } from './gymsiteReceitaEnrich.ts';

describe('enrichCityFromGymsite', () => {
  it('returns indisponivel without credentials', async () => {
    const r = await enrichCityFromGymsite('2304400', { url: '', key: '' });
    assert.equal(r.status, 'indisponivel');
  });

  it('maps pib + renda from mock client', async () => {
    const mock = {
      from(table: string) {
        return {
          select() {
            return {
              eq() {
                return {
                  limit: async () => {
                    if (table === 'municipio_pib') {
                      return {
                        data: [{
                          id_municipio: '2304400',
                          populacao: 1,
                          pib_reais: 1e9,
                          pib_per_capita: 1000,
                          ano: 2023,
                          fonte: 'test',
                        }],
                        error: null,
                      };
                    }
                    return {
                      data: [{
                        bairro: 'Aldeota',
                        renda_pc: 2000,
                        renda_media: 4000,
                      }],
                      error: null,
                    };
                  },
                };
              },
            };
          },
        };
      },
    };
    const r = await enrichCityFromGymsite('2304400', { client: mock as never });
    assert.equal(r.status, 'ok');
    assert.equal(r.pib?.ano, 2023);
    assert.equal(r.renda?.n_bairros, 1);
  });
});
```

Ajuste a API mock ao client real que a implementação usar (`createClient` injectável via `opts.client`).

- [ ] **Step 2: Run — expect FAIL**

```powershell
npx tsx --test scripts/lib/gymsiteReceitaEnrich.test.ts
```

- [ ] **Step 3: Implement enrich**

```ts
// Pseudocódigo alvo
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export async function enrichCityFromGymsite(
  ibge: string,
  opts: { url?: string; key?: string; client?: SupabaseClient } = {},
) {
  const url = opts.url ?? process.env.GYMSITE_SUPABASE_URL ?? process.env.SUPABASE_URL;
  const key =
    opts.key ??
    process.env.GYMSITE_SUPABASE_SERVICE_ROLE_KEY ??
    process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!opts.client && (!url || !key)) {
    return { status: 'indisponivel' as const, motivo: 'missing_gymsite_supabase_env' };
  }
  const cli = opts.client ?? createClient(url!, key!);
  try {
    const pibRes = await cli.from('municipio_pib').select('...').eq('id_municipio', ibge).limit(1);
    const rendaRes = await cli.from('renda_bairro').select('...').eq('municipio_cod', ibge).limit(5000);
    // se ambos vazios → indisponivel
    // senão status ok com mediana renda_pc + top3
  } catch (e) {
    return { status: 'indisponivel' as const, motivo: String(e).slice(0, 200) };
  }
}
```

Prefer env `GYMSITE_SUPABASE_*` para não colidir com Supabase do assistent-control; fallback `SUPABASE_*` se for o mesmo .env carregado do GymSite no smoke.

Documentar em ops: carregar credenciais GymSite (`epgedaiukjippepujuzc`), não `logistica-containers`.

- [ ] **Step 4: Run — expect PASS**

```powershell
npx tsx --test scripts/lib/gymsiteReceitaEnrich.test.ts
```

- [ ] **Step 5: Commit** (se pedido)

---

### Task 3: CLI `report:receita-blog`

**Files:**
- Create: `scripts/receita-cnae-blog-report.ts`
- Create: `data/processed/receita-blog/.gitkeep`
- Modify: `package.json` — scripts:
  - `"report:receita-blog": "npx tsx scripts/receita-cnae-blog-report.ts"`
  - `"test:receita-blog": "npx tsx --test scripts/lib/receitaBlogReport.test.ts scripts/lib/gymsiteReceitaEnrich.test.ts"`

**Interfaces:**
- Consumes: Task 1 + Task 2 + CSV parse pattern from `receita-cnae-scout-kpis.ts` + mapper
- Produces: `data/processed/receita-blog/{quarter}/{city-slug}.json` + `index.json` (lista paths)

**CLI args:**
- `--quarter YYYY-QN` (obrigatório)
- `--n <int>` (obrigatório, ≥1)
- `--onda-months <int>` default `3`
- `--ativos-csv`, `--baixada-csv` (defaults iguais Scout)
- `--out-dir` default `data/processed/receita-blog`
- `--skip-enrich` → todas fichas com `gymsite.indisponivel` motivo `skip_enrich`

**Behavior:**
1. Parse args; fail fast se faltar `--quarter` ou `--n`.
2. Load CSVs → `CnpjRow[]`.
3. `months = monthsInQuarter(quarter)`; marcar `partial` se max data CSV &lt; último mês do trimestre (opcional meta no `index.json`).
4. Por cidade: contar ativos (sit 02), entrantes (inicio em months), baixados (sit 08 e data_situacao em months).
5. `rankTopN` + `mergeRankedCities`.
6. Para cada cidade merged: vida dos baixados do trimestre; bairros; onda; enrich GymSite; write ficha.
7. Stdout summary: `{ quarter, n, fichas: number, paths: string[] }`.

City slug: normalize label → `sao-paulo-sp` (lowercase, sem acento, hífen).

- [ ] **Step 1: Implement CLI** (reusar parse CSV do Scout — extrair helper só se necessário; YAGNI copy mínima ok)

- [ ] **Step 2: Run dry**

```powershell
npm run report:receita-blog -- --quarter 2026-Q1 --n 3 --skip-enrich
```

Expected: pasta `data/processed/receita-blog/2026-Q1/` com ≤6 JSON; cada um com `movimento`, `vida_baixados`, `rankings`; `gymsite.status=indisponivel`.

- [ ] **Step 3: Run enrich real** (se env GymSite disponível)

```powershell
npm run report:receita-blog -- --quarter 2026-Q1 --n 3
```

Expected: ao menos 1 ficha com `gymsite.status=ok` nas capitais do smoke (SP/RJ/BH).

- [ ] **Step 4: Commit** (se pedido) — **não** commitar fichas geradas grandes se política do repo for gitignore; commitar só código + `.gitkeep`. Se commitar amostra, 1 ficha mini ok.

---

### Task 4: Skill blog + ops

**Files:**
- Create: `.agents/skills/gymsite-blog-receita/SKILL.md`
- Create: `Docs/blog/gymsite/.gitkeep`
- Create: `Docs/blog/gymsite/README.md` (1 parágrafo: posts gerados; não editar números sem atualizar ficha)
- Modify: `Docs/ops/receita-loop.md` — seção “Blog trimestral”
- Modify: `Docs/ops/receita-loop-state.md` — campos `last_blog_quarter`, `last_blog_n`, `last_blog_paths`
- Modify: `.agents/skills/receita-cnae-loop/SKILL.md` — passo opcional trimestral apontando skill blog

**Skill contents (obrigatório no arquivo):**

```markdown
---
name: gymsite-blog-receita
description: >-
  Gera post Markdown Blog GymSite a partir de ficha JSON receita-blog
  (trimestre Top N). Use após npm run report:receita-blog. Números só da ficha.
---

# GymSite Blog — Receita CNAE

## Input
- Um ou mais paths: `data/processed/receita-blog/{quarter}/{slug}.json`

## Output
- `Docs/blog/gymsite/{quarter}-{slug}-{mortalidade|crescimento|ambos}.md`

## Regras
1. Todo número do texto deve existir na ficha.
2. Se `gymsite.status=indisponivel`, dizer indisponível — não inventar PIB/renda.
3. Causa/efeito = associação; não acusar sem dado.
4. Estrutura: gancho → movimento → vida/faixas → bairros/onda → PIB/renda → fechamento GymSite.
5. Angle no filename: `ambos` se os dois rankings presentes.

## Checklist antes de salvar
- [ ] Contagens = ficha.movimento
- [ ] Mediana/faixas = ficha.vida_baixados
- [ ] Bairros citados ⊆ ficha.bairros_fechamento
- [ ] PIB/renda só se status=ok
```

- [ ] **Step 1: Write skill + ops + README + gitkeep**

- [ ] **Step 2: Manual gate** — agent (ou humano) gera **1** post a partir de 1 ficha do Task 3; conferir checklist.

- [ ] **Step 3: Update state.md** com paths do run.

- [ ] **Step 4: Commit** (se pedido)

```powershell
git add .agents/skills/gymsite-blog-receita Docs/blog/gymsite Docs/ops/receita-loop.md Docs/ops/receita-loop-state.md .agents/skills/receita-cnae-loop/SKILL.md package.json scripts/
git commit -m "feat(receita): blog trimestral report + gymsite-blog skill"
```

---

## Spec coverage

| Spec requirement | Task |
|------------------|------|
| Top N mortalidade + crescimento absoluto | 1, 3 |
| `--n` por tick | 3 |
| Trimestre | 1, 3 |
| Vida faixas + mediana | 1, 3 |
| Bairros + onda N meses | 1, 3 |
| GymSite live PIB/renda | 2, 3 |
| Ficha JSON schema | 1–3 |
| Skill blog Markdown | 4 |
| `Docs/blog/gymsite/` | 4 |
| Merge cidade 2 rankings | 1, 3 |
| GymSite fail → indisponivel | 2, 3 |
| Ops/state tick blog | 4 |
| Non-goals CMS/taxa/UI | docs only |

## Placeholder scan

Nenhum TBD. Tipos `ReceitaBlogFicha` definidos na Task 1 alinhados à spec. Mock enrich ajustável na Task 2 sem “implement later”.

## Type consistency

- `ReceitaBlogFicha` / `gymsite` status union `ok | indisponivel` — Task 1 define, Task 2/3 consomem.
- `rankings.mortalidade.rank` 1-based — Task 1 `mergeRankedCities`.
- Filename angle: skill Task 4 usa mesmos enums da ficha (`mortalidade` presente / `crescimento` presente → `ambos`).

---

## Execution handoff

Plan saved to `Docs/superpowers/plans/2026-08-04-receita-blog-gymsite.md`.
