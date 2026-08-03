# Regulatório CONFEF/CREF Refresh Loop — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Automatizar tick Scout→Analyst→Curator→Verifier que só ingere delta operacional CONFEF/CREF no `REGULATORIO_GROUP_ID`, com state persistente e gate anti-scrap.

**Architecture:** Helpers puros (hash URL, triage enum, inbox front matter) + CLI dry-run de tick + smoke ask no grupo Regulatório. Ingest/embed reusam `ingest:regulatorio-curado` / `embed:regulatorio`. Skill e state já bootstrapados; este plano completa código executável.

**Tech Stack:** TypeScript (`tsx`), `node:test` ou vitest já no repo se existir, `node:crypto` para hash, fetch HTTP para Scout/Verifier, Supabase só via scripts npm existentes no apply.

**Spec:** `Docs/superpowers/specs/2026-08-03-regulatorio-confef-cref-loop-design.md`

## Amendments (review 2026-08-03)

| Feedback | Decisão |
|----------|---------|
| Validar args CLI (URL, data) | **Aceito** — Task 1 helpers + Task 2 |
| Smoke: fail claro se secret/group ausente/inválido | **Aceito** — Task 3 |
| Secrets só via `.env` / env CI | **Aceito** — já padrão; ops doc reforça; nunca logar service_role |
| “Colisão SHA-256” | **Rejeitado** — risco irrelevante p/ URL+title+date |
| Ajustar 20h por “alta carga” | **Rejeitado v1** — cadência diária; `--force` basta |
| DAGs Scout∥Scout | **Rejeitado v1** — ciclo sequencial; Task 5 ainda linear |
| Auto-atualizar `regulatorio-loop-state.md` | **Aceito** — Task 2 `--update-state` (default on) |
| Rejeitar URL fora allowlist / group Wellhub | **Aceito** — `assertAllowlistedUrl` + `assertRegulatorioGroupId` |
| Ops com cenários force/dev/prod | **Aceito** — Task 4 |
| CLI muitos args → doc clara | **Aceito** — Task 4 tabela de flags |
| Rollback state ↔ Supabase | **Rejeitado v1** — state = log operacional; SoT chunks = DB + `content_hash` |
| Cap tamanho URL / “perf hash” | **Aceito leve** — max 2048 chars em `assertAllowlistedUrl` |
| Orquestrador CLI→ingest→embed→smoke | **Parcial** — v1: skill/ops encadeia; **sem** auto-ingest. Task 6 opcional: `--apply-pipeline` só se `decision=ingest` + dry-run OK |
| Agrupar flags / JSON config CLI | **Rejeitado v1** — tabela de flags no ops basta |
| Rollback se write state falhar | **Parcial** — state write por último; fail → exit 1 (sem rollback DB) |
| MD5 / timeout hash | **Rejeitado** — 2048 cap; SHA-256 de 2KB é instantâneo |
| Teste integração CLI→ingest→embed→smoke | **Parcial** — smoke = integração ask; chain full = Task 6 |

---

## Global Constraints

- Só grupo `b7dad505-2d2a-49a9-bbaf-d4b9c4929dea` / `REGULATORIO_GROUP_ID`
- Proibido prefixo Wellhub `553fa8d6`
- Candidate URL deve passar `assertAllowlistedUrl` (host `confef.org.br` ou `*.cref*` allowlist; rejeitar resto)
- Não misturar Mercado / aggregadores
- Taxas prefeitura = fora (fase 2)
- Ingest apply só após dry-run OK e `decision=ingest`
- Verifier ≠ auto-re-ingest em fail
- State Markdown atualizado pelo CLI (`--update-state`, default true) — agente não edita à mão salvo âmbar narrativo
- Nunca imprimir `SUPABASE_SERVICE_ROLE_KEY` em stdout/log
- Windows PowerShell-friendly nos comandos de smoke
- Spec/skill/state já criados — não duplicar conteúdo; só referenciar
- **Sem DAG** neste plano

---

## File map

| Path | Responsibility |
|------|----------------|
| `.agents/skills/regulatorio-confef-loop/SKILL.md` | ✅ bootstrap — skill do agente |
| `Docs/ops/regulatorio-loop-state.md` | ✅ bootstrap — estado do loop (CLI append) |
| `Docs/superpowers/specs/2026-08-03-regulatorio-confef-cref-loop-design.md` | ✅ bootstrap — design |
| `data/raw/Regulatorio/inbox/README.md` | ✅ bootstrap — contrato inbox |
| `scripts/lib/regulatorioLoop.ts` | Pure: hash, triage, inbox, skip, allowlist, group assert, state patch |
| `scripts/lib/regulatorioLoop.test.ts` | Testes unitários dos helpers |
| `scripts/regulatorio-loop-tick.ts` | CLI tick + validação + write inbox + update state |
| `scripts/smoke-regulatorio-ask.ts` | POST knowledge-ask; fail hard se env/group inválido |
| `Docs/ops/regulatorio-loop.md` | Cenários force/dev/prod + `/loop` + secrets |
| `package.json` | Scripts `loop:regulatorio-tick`, `smoke:regulatorio-ask` |

---

### Task 1: Helpers puros + testes

**Files:**
- Create: `scripts/lib/regulatorioLoop.ts`
- Create: `scripts/lib/regulatorioLoop.test.ts`

**Interfaces:**
- Consumes: none
- Produces:
  - `urlHash(url: string, title: string, date: string): string` — sha256 hex dos 3 campos joined por `|`
  - `type TriageDecision = 'drop' | 'raw-only' | 'ingest' | 'human-amber'`
  - `parseDecision(raw: string): TriageDecision` — throw se inválido
  - `shouldSkipTick(lastTickIso: string | null, now: Date, minHours = 20): boolean`
  - `buildInboxDoc(meta: { source_url: string; fetched_at: string; tema: string; decision: TriageDecision }, body: string): string`
  - `assertIsoDate(date: string): string` — exige `YYYY-MM-DD` ou ISO parseável; throw senão
  - `assertAllowlistedUrl(url: string): string` — `new URL`; host termina com `confef.org.br` **ou** match `/cref/i` no hostname; throw senão
  - `assertRegulatorioGroupId(id: string): string` — throw se vazio ou prefixo `553fa8d6`
  - `extractLastTickIso(stateMarkdown: string): string | null` — regex `**ISO:**` sob `## last_tick`
  - `appendTickToState(stateMarkdown: string, tick: { iso: string; result: string; ingestCount: number; amberCount: number; decisionLine?: string; urlSeenLine?: string }): string` — substitui bloco `last_tick` + append em `decisions` / `urls_seen` se lines dadas

- [x] **Step 1: Write failing tests**
- [x] **Step 2: Run tests — expect FAIL (module missing)**
- [x] **Step 3: Implement `scripts/lib/regulatorioLoop.ts`**
- [x] **Step 4: Run tests — expect PASS**
- [ ] **Step 5: Commit** (só se humano pedir commit)

Create `scripts/lib/regulatorioLoop.test.ts` matching the repo’s existing test runner (prefer `node:test` + `tsx`).

```ts
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  urlHash,
  parseDecision,
  shouldSkipTick,
  buildInboxDoc,
  assertIsoDate,
  assertAllowlistedUrl,
  assertRegulatorioGroupId,
  extractLastTickIso,
  appendTickToState,
} from './regulatorioLoop.ts';

describe('urlHash', () => {
  it('is stable for same inputs', () => {
    const a = urlHash('https://www.confef.org.br/x', 'Titulo', '2026-08-01');
    const b = urlHash('https://www.confef.org.br/x', 'Titulo', '2026-08-01');
    assert.equal(a, b);
    assert.equal(a.length, 64);
  });
  it('changes when title changes', () => {
    const a = urlHash('https://www.confef.org.br/x', 'A', '2026-08-01');
    const b = urlHash('https://www.confef.org.br/x', 'B', '2026-08-01');
    assert.notEqual(a, b);
  });
});

describe('parseDecision', () => {
  it('accepts ingest', () => {
    assert.equal(parseDecision('ingest'), 'ingest');
  });
  it('rejects garbage', () => {
    assert.throws(() => parseDecision('maybe'));
  });
});

describe('shouldSkipTick', () => {
  it('skips when last tick < 20h ago', () => {
    const now = new Date('2026-08-03T15:00:00Z');
    const last = '2026-08-03T00:00:00Z';
    assert.equal(shouldSkipTick(last, now, 20), true);
  });
  it('does not skip when never run', () => {
    assert.equal(shouldSkipTick(null, new Date(), 20), false);
  });
});

describe('assertAllowlistedUrl', () => {
  it('allows confef.org.br', () => {
    assert.equal(
      assertAllowlistedUrl('https://www.confef.org.br/comunicacao/noticias/1'),
      'https://www.confef.org.br/comunicacao/noticias/1',
    );
  });
  it('rejects random host', () => {
    assert.throws(() => assertAllowlistedUrl('https://evil.example/x'));
  });
  it('rejects invalid URL', () => {
    assert.throws(() => assertAllowlistedUrl('not-a-url'));
  });
});

describe('assertIsoDate', () => {
  it('accepts YYYY-MM-DD', () => {
    assert.equal(assertIsoDate('2026-08-03'), '2026-08-03');
  });
  it('rejects garbage', () => {
    assert.throws(() => assertIsoDate('03/08/2026'));
  });
});

describe('assertRegulatorioGroupId', () => {
  it('rejects Wellhub prefix', () => {
    assert.throws(() =>
      assertRegulatorioGroupId('553fa8d6-0000-0000-0000-000000000000'),
    );
  });
});

describe('buildInboxDoc', () => {
  it('includes front matter keys', () => {
    const doc = buildInboxDoc(
      {
        source_url: 'https://www.confef.org.br/comunicacao/noticias/1',
        fetched_at: '2026-08-03T12:00:00Z',
        tema: 'resolucao_confef',
        decision: 'raw-only',
      },
      'corpo da noticia',
    );
    assert.match(doc, /source_url:/);
    assert.match(doc, /decision: raw-only/);
    assert.match(doc, /corpo da noticia/);
  });
});

describe('state helpers', () => {
  const sample = `# x\n\n## last_tick\n\n- **ISO:** _(nunca)_\n- **Resultado:** bootstrap\n\n## urls_seen\n\n_(vazio)_\n\n## decisions (ticks recentes)\n\n_(vazio)_\n`;

  it('extractLastTickIso returns null for bootstrap', () => {
    assert.equal(extractLastTickIso(sample), null);
  });

  it('appendTickToState sets ISO', () => {
    const next = appendTickToState(sample, {
      iso: '2026-08-03T15:00:00Z',
      result: 'ok',
      ingestCount: 0,
      amberCount: 0,
      decisionLine: '2026-08-03 | https://www.confef.org.br/x | drop | teste',
    });
    assert.match(next, /\*\*ISO:\*\* 2026-08-03T15:00:00Z/);
    assert.match(next, /drop \| teste/);
  });
});
```

- [ ] **Step 2: Run tests — expect FAIL (module missing)**

```powershell
npx tsx --test scripts/lib/regulatorioLoop.test.ts
```

Expected: fail cannot find module / exports.

- [ ] **Step 3: Implement `scripts/lib/regulatorioLoop.ts`**

Implement all exports from Interfaces. Regras allowlist:

```ts
export function assertAllowlistedUrl(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`URL inválida: ${url}`);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`protocolo inválido: ${parsed.protocol}`);
  }
  const host = parsed.hostname.toLowerCase();
  const ok =
    host === 'confef.org.br' ||
    host.endsWith('.confef.org.br') ||
    /cref/i.test(host);
  if (!ok) throw new Error(`URL fora allowlist CONFEF/CREF: ${host}`);
  if (url.length > 2048) throw new Error('URL excede 2048 chars');
  return parsed.toString();
}
```

Também: teste `rejects URL longer than 2048`.

`assertIsoDate`: aceitar `/^\d{4}-\d{2}-\d{2}/` ou `Date.parse` finito; rejeitar `DD/MM/YYYY`.

`extractLastTickIso`: se valor contém `nunca` ou vazio → `null`; senão ISO trim.

`appendTickToState`: replace linha `- **ISO:** ...` e `- **Resultado:** ...` e contagens; se `decisionLine`, append após header `## decisions`; idem `urlSeenLine` em `## urls_seen`.

- [ ] **Step 4: Run tests — expect PASS**

```powershell
npx tsx --test scripts/lib/regulatorioLoop.test.ts
```

- [ ] **Step 5: Commit** (só se humano pedir commit)

```bash
git add scripts/lib/regulatorioLoop.ts scripts/lib/regulatorioLoop.test.ts
git commit -m "feat: helpers do loop regulatório CONFEF/CREF"
```
---

### Task 2: CLI tick dry-run (Scout log + skip + inbox + state)

**Files:**
- Create: `scripts/regulatorio-loop-tick.ts`
- Modify: `package.json` (add `"loop:regulatorio-tick": "npx tsx scripts/regulatorio-loop-tick.ts"`)

**Interfaces:**
- Consumes: all Task 1 helpers from `scripts/lib/regulatorioLoop.ts`
- Produces: CLI exit 0 ou 1; stdout JSON `{ skipped, candidates, written[], stateUpdated, error? }`; opcional inbox + patch state

Comportamento v1:

- Lê `Docs/ops/regulatorio-loop-state.md` via `extractLastTickIso`. Se `shouldSkipTick` e sem `--force` → exit 0 `skipped: true` (ainda pode `--update-state` com result `skipped`).
- Scout v1: **não** scrapa HTML. Args: `--candidate-url` `--title` `--date` `--decision` `--tema` `--body-file` `--force` `--write-inbox` `--update-state` (default **true**; `--no-update-state` desliga).
- Validar URL (`assertAllowlistedUrl`), date (`assertIsoDate`), decision (`parseDecision`) **antes** de write; exit 1 + JSON `error` se falhar.
- Se `decision` ∈ `raw-only|ingest|human-amber` e `--write-inbox`: grava inbox.
- Se `--update-state` (default): `appendTickToState` + `fs.writeFileSync` no state.
- Nunca chama ingest apply neste task.
- Nunca loga secrets.

- [x] **Step 1: Implement CLI** com validação + state patch

- [x] **Step 2: Manual dry-run**

```powershell
npm run loop:regulatorio-tick -- --force --candidate-url "https://www.confef.org.br/comunicacao/noticias/exemplo" --title "Exemplo" --date "2026-08-03" --decision drop --tema resolucao_confef
```

Expected: JSON `decision: drop`, `written: []`, `stateUpdated: true`.

```powershell
npm run loop:regulatorio-tick -- --force --candidate-url "https://evil.example/x" --title "X" --date "2026-08-03" --decision drop --tema resolucao_confef
```

Expected: exit 1, `error` allowlist.

```powershell
npm run loop:regulatorio-tick -- --force --write-inbox --candidate-url "https://www.confef.org.br/comunicacao/noticias/exemplo" --title "Anuidade" --date "2026-08-03" --decision raw-only --tema anuidades_cref --body-file data/raw/Regulatorio/inbox/README.md
```

Expected: arquivo em `data/raw/Regulatorio/inbox/2026-08-03/` + state com nova linha decisions.

- [ ] **Step 3: Commit** (se humano pedir)
---

### Task 3: Smoke ask Regulatório

**Files:**
- Create: `scripts/smoke-regulatorio-ask.ts`
- Modify: `package.json` (`"smoke:regulatorio-ask": "npx tsx scripts/smoke-regulatorio-ask.ts"`)

**Interfaces:**
- Consumes: env `SUPABASE_URL` | `VITE_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `REGULATORIO_GROUP_ID`; `assertRegulatorioGroupId`
- Produces: exit 0 se 3/3 HTTP 200; exit 1 se env ausente, group inválido, network error, ou HTTP ≠200; tabela query→status (**sem** dump de key)

Antes do fetch:

1. Se faltar URL ou service_role → `console.error` mensagem nome da var; exit 1
2. `assertRegulatorioGroupId(REGULATORIO_GROUP_ID)` — catch → exit 1
3. Timeout fetch sugerido 30s; catch network → exit 1 com `details` curtos

```http
POST {SUPABASE_URL}/functions/v1/knowledge-ask
Authorization: Bearer {SERVICE_ROLE}
apikey: {SERVICE_ROLE}
{"groupId":"{REGULATORIO_GROUP_ID}","messages":[{"role":"user","content":"<query>"}]}
```

Queries default = 3 do state (UF default `CE` na 3ª).

- [x] **Step 1: Implement smoke script**
- [x] **Step 2: Run**

```powershell
npm run smoke:regulatorio-ask
```

Expected: 3× HTTP 200. Sem env: exit 1 claro.

- [ ] **Step 3: Commit** (se humano pedir)
---

### Task 4: Ops doc + marcar spec approved

**Files:**
- Create: `Docs/ops/regulatorio-loop.md`
- Modify: `Docs/superpowers/specs/2026-08-03-regulatorio-confef-cref-loop-design.md` — Status → `approved` após humano confirmar review

**Ops doc deve conter:**

1. Pré-requisitos env (só `.env` / secrets CI; nunca commit key)
2. **Tabela de flags CLI** (`--force`, `--write-inbox`, `--update-state` / `--no-update-state`, `--candidate-url`, `--title`, `--date`, `--decision`, `--tema`, `--body-file`) com 1 linha cada
3. Cenários:
   - dev dry-run `--force --decision drop`
   - write inbox `--write-inbox`
   - skip natural (sem `--force` <20h)
   - `--no-update-state` (debug)
   - prod tick via `/loop 1d` + sentinel `AGENT_LOOP_TICK_regulatorio`
4. Fluxo agente (manual chain, sem auto-ingest): skill → `loop:regulatorio-tick` → **só se** `decision=ingest`: dry-run `ingest:regulatorio-curado` → `--apply` → `embed:regulatorio` → `smoke:regulatorio-ask`
5. Nota: state.md ≠ rollback DB; SoT = `eros_knowledge_chunks` + hash
6. Fora de escopo: Mercado, taxas prefeitura, DAG, heal timeout, orquestrador all-in-one v1
- [x] **Step 1: Write ops doc**
- [x] **Step 2: After human reviews spec, set Status: approved**
- [ ] **Step 3: Commit** (se humano pedir)

---

### Task 5 (fase 1.5, opcional): Scout HTTP allowlist

**Files:**
- Create: `scripts/lib/regulatorioScout.ts`
- Modify: `scripts/regulatorio-loop-tick.ts` — `--scout-noticias` fetch da listagem CONFEF notícias

Só implementar depois Tasks 1–4 estáveis. Deduplicar via `urlHash` contra lista parseada do state (`urls_seen`). Sem ingest automático — só imprime candidatos para Analyst (agente) decidir `--decision`.

---

### Task 6 (opcional, pós-estável): wrapper `--apply-pipeline`

**Não** na v1 obrigatória. Só se humano pedir depois.

- Flag no tick **ou** script `scripts/regulatorio-loop-apply.ts`
- Roda **somente** se último decision do tick = `ingest`
- Sequência: dry-run ingest → apply → embed → smoke
- Fail em qualquer passo → exit 1; **não** marca state como saudável

---

## Spec coverage checklist

| Spec item | Task |
|-----------|------|
| Scout allowlist | Task 2 (manual) + Task 5 (HTTP) |
| Analyst gate enum | Task 1 `parseDecision` + Task 2 CLI |
| Inbox path | Task 2 `--write-inbox` |
| Ingest/embed reuse | Task 4 ops (comandos existentes) |
| Verifier ask | Task 3 |
| State file | Task 2 `--update-state` + bootstrap |
| Allowlist URL / group assert | Task 1 + Task 2/3 |
| Skill | bootstrap |
| Skip &lt;20h | Task 1 + Task 2 |
| Non-goals Mercado/taxas/DAG | Task 4 ops + skill + Amendments |

## Placeholder scan

Nenhum TBD/TODO aberto nas Tasks 1–4. Task 5 marcada opcional/fase 1.5.
