# Gurupass Accept-Geo Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Hot ingest lists which gyms accept Gurupass in a target bairro/cidade via offline `GP_ACCEPT_FIXTURE`, answering “quem aceita GP no Cocó?” without plan/price join.

**Architecture:** Binary acceptance only. Hot path reads fixture → filters by geo → writes `ingest/gurupass/<run_id>.json` with `accept_list` + `summary.gp_accept_count`. Maps (`GEO_FIXTURE`) is optional context, never the acceptance source. Catalog `/nossos-planos/` is `out_of_scope`. Cold Playwright refresh is stubbed (env + docs); not required for Cocó smoke.

**Tech Stack:** Node.js ESM (`.mjs`), `node:fs` / `node:path`, `node --test` for pure helpers, no new npm deps.

**Spec:** `Docs/superpowers/specs/2026-07-25-gurupass-accept-geo-design.md`

## Global Constraints

- Aggregator script stays separate: only `scripts/ingest-gurupass-canonical.mjs` (do not reuse TP/WH parsers)
- Hot path: $0 API — no live fetch to Gurupass for acceptance or planos
- Match rule: hit = on GP accept list for geo; **no** Maps name-to-name join
- Plan catalog Ilimitado / credits / BRL: **out of scope** this cycle
- Zero hits after filter = success (`gp_accept_count: 0`)
- Invalid fixture JSON = exit non-zero
- Missing fixture: warn + count 0 unless `REQUIRE_ACCEPT_FIXTURE=1` → exit non-zero
- Cold `GP_ACCEPT_REFRESH`: contract/stub only — no Playwright implementation in this plan
- Prefer PowerShell-friendly smoke commands on Windows (`$env:VAR=...`)

---

## File map

| Path | Responsibility |
|------|----------------|
| `scripts/lib/gpAcceptGeo.mjs` | Pure: slug, load/filter accept items, build catalog out-of-scope stub |
| `scripts/lib/gpAcceptGeo.test.mjs` | `node --test` for filter + require-fixture behavior |
| `ingest/fixtures/gp-accept-coco.json` | Seed accept list for Cocó/Fortaleza smoke |
| `scripts/ingest-gurupass-canonical.mjs` | Wire env → filter → artifact `gurupass_accept_geo` |
| `Docs/superpowers/ops/2026-07-25-gurupass-accept-geo.md` | Hot smoke + cold stub contract |
| `Docs/superpowers/specs/2026-07-25-gurupass-accept-geo-design.md` | Mark status approved (meta only) |

---

### Task 1: Pure accept-geo helpers + tests

**Files:**
- Create: `scripts/lib/gpAcceptGeo.mjs`
- Create: `scripts/lib/gpAcceptGeo.test.mjs`

**Interfaces:**
- Consumes: none
- Produces:
  - `slug(s: string): string`
  - `filterAcceptItems(items: AcceptItem[], targetGeo: {bairro,cidade,uf}): FilteredItem[]`
  - `loadAcceptFixture(absOrRelPath: string, root: string): { aggregator, source, target_geo?, items }` (throws on bad JSON / missing file when calling `fs.readFileSync`)
  - `resolveAcceptList({ fixturePath, root, targetGeo, requireFixture }): { accept_list, warnings, source }`

`FilteredItem` = AcceptItem fields + optional `bairro_unknown: true`.

- [ ] **Step 1: Write failing tests**

Create `scripts/lib/gpAcceptGeo.test.mjs`:

```js
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  slug,
  filterAcceptItems,
  resolveAcceptList,
} from './gpAcceptGeo.mjs';

describe('slug', () => {
  it('normalizes accents', () => {
    assert.equal(slug('Cocó'), 'coco');
  });
});

describe('filterAcceptItems', () => {
  const target = { bairro: 'Cocó', cidade: 'Fortaleza', uf: 'CE' };

  it('keeps city+bairro match', () => {
    const out = filterAcceptItems(
      [
        {
          name: 'Keep In Shape',
          cidade: 'Fortaleza',
          uf: 'CE',
          bairro: 'Cocó',
        },
        {
          name: 'Other City',
          cidade: 'Recife',
          uf: 'PE',
          bairro: 'Boa Viagem',
        },
      ],
      target,
    );
    assert.equal(out.length, 1);
    assert.equal(out[0].name, 'Keep In Shape');
  });

  it('includes missing bairro with bairro_unknown', () => {
    const out = filterAcceptItems(
      [{ name: 'City Only', cidade: 'Fortaleza', uf: 'CE', bairro: null }],
      target,
    );
    assert.equal(out.length, 1);
    assert.equal(out[0].bairro_unknown, true);
  });

  it('drops wrong bairro when bairro set', () => {
    const out = filterAcceptItems(
      [
        {
          name: 'Aldeota Gym',
          cidade: 'Fortaleza',
          uf: 'CE',
          bairro: 'Aldeota',
        },
      ],
      target,
    );
    assert.equal(out.length, 0);
  });
});

describe('resolveAcceptList', () => {
  it('returns empty + warning when fixture missing and not required', () => {
    const r = resolveAcceptList({
      fixturePath: '',
      root: process.cwd(),
      targetGeo: { bairro: 'Cocó', cidade: 'Fortaleza', uf: 'CE' },
      requireFixture: false,
    });
    assert.deepEqual(r.accept_list, []);
    assert.ok(r.warnings.some((w) => /GP_ACCEPT_FIXTURE/i.test(w)));
  });

  it('throws when requireFixture and path empty', () => {
    assert.throws(
      () =>
        resolveAcceptList({
          fixturePath: '',
          root: process.cwd(),
          targetGeo: { bairro: 'Cocó', cidade: 'Fortaleza', uf: 'CE' },
          requireFixture: true,
        }),
      /REQUIRE_ACCEPT_FIXTURE/,
    );
  });

  it('loads fixture and filters', () => {
    const dir = join(tmpdir(), `gp-accept-${Date.now()}`);
    mkdirSync(dir, { recursive: true });
    const path = join(dir, 'fix.json');
    writeFileSync(
      path,
      JSON.stringify({
        aggregator: 'gurupass',
        source: {
          url: 'https://www.gurupass.com.br/buscar-academias/',
          method: 'manual_seed',
          fetched_at: '2026-07-25T00:00:00.000Z',
        },
        items: [
          {
            name: 'Seed Gym',
            cidade: 'Fortaleza',
            uf: 'CE',
            bairro: 'Cocó',
            partner_url: null,
          },
        ],
      }),
      'utf8',
    );
    try {
      const r = resolveAcceptList({
        fixturePath: path,
        root: process.cwd(),
        targetGeo: { bairro: 'Cocó', cidade: 'Fortaleza', uf: 'CE' },
        requireFixture: true,
      });
      assert.equal(r.accept_list.length, 1);
      assert.equal(r.accept_list[0].name, 'Seed Gym');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
```

- [ ] **Step 2: Run tests — expect FAIL**

```powershell
node --test scripts/lib/gpAcceptGeo.test.mjs
```

Expected: FAIL — `Cannot find module` / import error for `./gpAcceptGeo.mjs`.

- [ ] **Step 3: Implement helpers**

Create `scripts/lib/gpAcceptGeo.mjs`:

```js
import { readFileSync, existsSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';

export function slug(s) {
  return String(s)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

export function filterAcceptItems(items, targetGeo) {
  const tc = slug(targetGeo?.cidade || '');
  const tb = slug(targetGeo?.bairro || '');
  const tuf = (targetGeo?.uf || '').toUpperCase();
  const out = [];
  for (const raw of items || []) {
    const cidade = slug(raw.cidade || '');
    const uf = (raw.uf || '').toUpperCase();
    if (!tc || !cidade || cidade !== tc) continue;
    if (tuf && uf && uf !== tuf) continue;
    const hasBairro = Boolean(raw.bairro);
    if (hasBairro && tb) {
      const b = slug(raw.bairro);
      if (b !== tb && !b.includes(tb) && !tb.includes(b)) continue;
      out.push({ ...raw });
      continue;
    }
    out.push({ ...raw, bairro_unknown: true });
  }
  return out;
}

export function loadAcceptFixture(pathLike, root) {
  const abs = isAbsolute(pathLike) ? pathLike : join(root, pathLike);
  if (!existsSync(abs)) {
    const err = new Error(`GP_ACCEPT_FIXTURE not found: ${abs}`);
    err.code = 'ENOENT';
    throw err;
  }
  const doc = JSON.parse(readFileSync(abs, 'utf8'));
  if (!Array.isArray(doc.items)) {
    throw new Error('GP_ACCEPT_FIXTURE.items must be an array');
  }
  return doc;
}

/**
 * @returns {{ accept_list: object[], warnings: string[], source: object|null }}
 */
export function resolveAcceptList({
  fixturePath,
  root,
  targetGeo,
  requireFixture,
}) {
  const warnings = [];
  if (!fixturePath) {
    if (requireFixture) {
      throw new Error('REQUIRE_ACCEPT_FIXTURE=1 but GP_ACCEPT_FIXTURE is empty');
    }
    warnings.push('GP_ACCEPT_FIXTURE unset — accept_list empty');
    return { accept_list: [], warnings, source: null };
  }
  let doc;
  try {
    doc = loadAcceptFixture(fixturePath, root);
  } catch (e) {
    if (requireFixture) throw e;
    warnings.push(String(e.message || e));
    return { accept_list: [], warnings, source: null };
  }
  if (doc.aggregator && doc.aggregator !== 'gurupass') {
    warnings.push(`fixture aggregator=${doc.aggregator} ≠ gurupass`);
  }
  const accept_list = filterAcceptItems(doc.items, targetGeo);
  return {
    accept_list,
    warnings,
    source: {
      ...(doc.source || {}),
      fixture: fixturePath,
      item_count_raw: doc.items.length,
    },
  };
}

export function catalogOutOfScope() {
  return {
    source: {
      url: 'https://www.gurupass.com.br/nossos-planos/',
      method: 'out_of_scope',
      http_status: null,
    },
    parse_mode: 'out_of_scope',
    prices_seen: [],
    plan: {
      code: 'GP',
      price_brl_month: null,
      parse_warnings: ['plan_catalog_out_of_scope_this_cycle'],
      status: 'out_of_scope',
    },
  };
}
```

- [ ] **Step 4: Run tests — expect PASS**

```powershell
node --test scripts/lib/gpAcceptGeo.test.mjs
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```powershell
git add scripts/lib/gpAcceptGeo.mjs scripts/lib/gpAcceptGeo.test.mjs
git commit -m "feat: add Gurupass accept-geo filter helpers"
```

---

### Task 2: Seed Cocó accept fixture

**Files:**
- Create: `ingest/fixtures/gp-accept-coco.json`

**Interfaces:**
- Consumes: fixture schema from spec
- Produces: seed file with ≥1 Cocó item (synthetic OK for smoke; replace later via cold refresh)

- [ ] **Step 1: Write fixture**

```json
{
  "aggregator": "gurupass",
  "source": {
    "url": "https://www.gurupass.com.br/buscar-academias/",
    "method": "manual_seed",
    "fetched_at": "2026-07-25T00:00:00.000Z",
    "note": "Synthetic seed for hot smoke; replace via cold browser refresh"
  },
  "target_geo": {
    "bairro": "Cocó",
    "cidade": "Fortaleza",
    "uf": "CE"
  },
  "items": [
    {
      "name": "Keep In Shape Cocó (seed)",
      "address": "Cocó, Fortaleza - CE",
      "bairro": "Cocó",
      "cidade": "Fortaleza",
      "uf": "CE",
      "partner_url": null
    },
    {
      "name": "Fortaleza Citywide Unknown Bairro (seed)",
      "address": null,
      "bairro": null,
      "cidade": "Fortaleza",
      "uf": "CE",
      "partner_url": null
    },
    {
      "name": "Aldeota Only (seed)",
      "address": "Aldeota, Fortaleza - CE",
      "bairro": "Aldeota",
      "cidade": "Fortaleza",
      "uf": "CE",
      "partner_url": null
    }
  ]
}
```

Note: with target Cocó, expect **2** hits (Keep In Shape + citywide unknown). Aldeota dropped.

- [ ] **Step 2: Sanity-check JSON**

```powershell
node -e "const d=require('./ingest/fixtures/gp-accept-coco.json'); if(!Array.isArray(d.items)) process.exit(1); console.log(d.items.length)"
```

Expected: `3`

- [ ] **Step 3: Commit**

```powershell
git add ingest/fixtures/gp-accept-coco.json
git commit -m "chore: seed Gurupass Cocó accept fixture"
```

---

### Task 3: Rewire `ingest-gurupass-canonical.mjs` to accept-geo

**Files:**
- Modify: `scripts/ingest-gurupass-canonical.mjs` (full rewrite of main/artifact; keep file path)

**Interfaces:**
- Consumes: `resolveAcceptList`, `catalogOutOfScope` from `scripts/lib/gpAcceptGeo.mjs`
- Produces: artifact with `ingest_kind: "gurupass_accept_geo"`, `accept_list`, `summary.gp_accept_count`

- [ ] **Step 1: Replace script header + env**

At top of `scripts/ingest-gurupass-canonical.mjs`, set purpose comment and env:

```js
/**
 * ingest-gurupass-canonical.mjs
 * Accept-geo: lista academias que ACEITAM Gurupass no geo alvo.
 * Fonte aceite = GP_ACCEPT_FIXTURE (buscar-academias export).
 * Planos/preços = out_of_scope neste ciclo.
 * Maps GEO_FIXTURE = contexto opcional (não define aceite).
 *
 * Hot smoke:
 *   GP_ACCEPT_FIXTURE=ingest/fixtures/gp-accept-coco.json `
 *     node scripts/ingest-gurupass-canonical.mjs
 */

import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  catalogOutOfScope,
  resolveAcceptList,
  slug,
} from './lib/gpAcceptGeo.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

const GEO = {
  bairro: process.env.BAIRRO || 'Cocó',
  cidade: process.env.CIDADE || 'Fortaleza',
  uf: process.env.UF || 'CE',
};
const GP_ACCEPT_FIXTURE = process.env.GP_ACCEPT_FIXTURE || '';
const REQUIRE_ACCEPT_FIXTURE = process.env.REQUIRE_ACCEPT_FIXTURE === '1';
const GEO_FIXTURE = process.env.GEO_FIXTURE || '';
const GP_ACCEPT_REFRESH = process.env.GP_ACCEPT_REFRESH === '1';
```

- [ ] **Step 2: Implement optional maps_context loader (no join)**

Keep a minimal `loadMapsContext()` that returns `null` or `{ source, items_count, note }` from `GEO_FIXTURE` without setting acceptance. Do **not** call partner enrich for acceptance. If `PARTNER_ENRICH_FIXTURE` still referenced, remove from hot path or ignore with warning in console summary.

- [ ] **Step 3: Implement `buildArtifact`**

```js
function buildArtifact({ catalog, acceptResolved, mapsContext }) {
  const runId = new Date().toISOString().replace(/[:.]/g, '-');
  const accept_list = acceptResolved.accept_list;
  return {
    schema_version: 1,
    ingest_kind: 'gurupass_accept_geo',
    aggregator: 'gurupass',
    run_id: runId,
    geo: GEO,
    catalog,
    accept_source: acceptResolved.source,
    accept_warnings: acceptResolved.warnings,
    accept_list,
    summary: {
      gp_accept_count: accept_list.length,
      target_geo: GEO,
    },
    maps_context: mapsContext,
    cold_refresh: {
      env: 'GP_ACCEPT_REFRESH',
      requested: GP_ACCEPT_REFRESH,
      status: GP_ACCEPT_REFRESH ? 'not_implemented_stub' : 'idle',
      note: 'Cold browser → buscar-academias/ rewrites GP_ACCEPT_FIXTURE; follow-up',
    },
    rag_chunks: [
      {
        id: `gp-accept-${slug(GEO.cidade)}-${slug(GEO.bairro || 'all')}`,
        type: 'gp_accept_geo',
        text: `Gurupass aceita em ${GEO.bairro || '*'}, ${GEO.cidade}-${GEO.uf}: ${accept_list.length} academias | ${accept_list.map((i) => i.name).slice(0, 12).join('; ')}`,
      },
    ],
  };
}
```

- [ ] **Step 4: Implement `main`**

```js
async function main() {
  if (GP_ACCEPT_REFRESH) {
    console.error(
      JSON.stringify({
        error: 'GP_ACCEPT_REFRESH not implemented — stub only',
        hint: 'Populate ingest/fixtures/gp-accept-*.json manually for hot path',
      }),
    );
    process.exit(2);
  }

  const catalog = catalogOutOfScope();
  const acceptResolved = resolveAcceptList({
    fixturePath: GP_ACCEPT_FIXTURE,
    root: ROOT,
    targetGeo: GEO,
    requireFixture: REQUIRE_ACCEPT_FIXTURE,
  });

  let mapsContext = null;
  if (GEO_FIXTURE) {
    const abs = isAbsolute(GEO_FIXTURE) ? GEO_FIXTURE : join(ROOT, GEO_FIXTURE);
    mapsContext = {
      source: { method: 'geo_fixture', fixture: GEO_FIXTURE },
      note: 'Maps context only — does not define GP acceptance',
      exists: existsSync(abs),
    };
  }

  const artifact = buildArtifact({ catalog, acceptResolved, mapsContext });
  const outDir = join(ROOT, 'ingest', 'gurupass');
  mkdirSync(outDir, { recursive: true });
  const out = join(outDir, `${artifact.run_id}.json`);
  writeFileSync(out, JSON.stringify(artifact, null, 2), 'utf8');
  console.log(
    JSON.stringify(
      {
        out: out.replace(ROOT + '\\', '').replace(ROOT + '/', ''),
        aggregator: 'gurupass',
        ingest_kind: artifact.ingest_kind,
        gp_accept_count: artifact.summary.gp_accept_count,
        accept_names: artifact.accept_list.map((i) => i.name),
        warnings: artifact.accept_warnings,
        catalog_status: catalog.plan.status,
      },
      null,
      2,
    ),
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
```

Remove dead code: `fetchCatalog` HTML smoke, `applyPartnerEnrich`, old `geo_sample` as acceptance source. Keep file focused.

- [ ] **Step 5: Smoke Cocó (PowerShell)**

```powershell
$env:GP_ACCEPT_FIXTURE="ingest/fixtures/gp-accept-coco.json"
$env:BAIRRO="Cocó"
$env:CIDADE="Fortaleza"
$env:UF="CE"
node scripts/ingest-gurupass-canonical.mjs
```

Expected console includes `"gp_accept_count": 2` and `"ingest_kind": "gurupass_accept_geo"`. Artifact under `ingest/gurupass/*.json` has `accept_list` length 2.

- [ ] **Step 6: Require-fixture fail check**

```powershell
Remove-Item Env:GP_ACCEPT_FIXTURE -ErrorAction SilentlyContinue
$env:REQUIRE_ACCEPT_FIXTURE="1"
node scripts/ingest-gurupass-canonical.mjs
```

Expected: exit code 1, error mentions `REQUIRE_ACCEPT_FIXTURE`.

- [ ] **Step 7: Commit**

```powershell
git add scripts/ingest-gurupass-canonical.mjs
git commit -m "feat: wire Gurupass ingest to accept-geo fixture"
```

---

### Task 4: Ops doc (hot smoke + cold stub)

**Files:**
- Create: `Docs/superpowers/ops/2026-07-25-gurupass-accept-geo.md`
- Modify: `Docs/superpowers/specs/2026-07-25-gurupass-accept-geo-design.md` — set `Status: approved`

**Interfaces:**
- Consumes: smoke commands from Task 3
- Produces: operator runbook

- [ ] **Step 1: Write ops doc**

Include:

- Product question answered
- Hot env table (`GP_ACCEPT_FIXTURE`, `BAIRRO`, `CIDADE`, `UF`, `REQUIRE_ACCEPT_FIXTURE`, `GEO_FIXTURE` optional)
- PowerShell + bash smoke one-liners
- Cold stub: `GP_ACCEPT_REFRESH=1` exits 2; future Playwright rewrites fixture from `https://www.gurupass.com.br/buscar-academias/`
- Explicit: planos Ilimitado not in this path

- [ ] **Step 2: Mark spec approved**

Change header status line to `Status: approved`.

- [ ] **Step 3: Commit**

```powershell
git add Docs/superpowers/ops/2026-07-25-gurupass-accept-geo.md Docs/superpowers/specs/2026-07-25-gurupass-accept-geo-design.md
git commit -m "docs: Gurupass accept-geo ops runbook"
```

---

## Spec coverage (self-review)

| Spec requirement | Task |
|------------------|------|
| Hot fixture → accept_list + count | 2, 3 |
| $0 API hot | 3 (no fetch) |
| Cold browser contract stub | 3 (`GP_ACCEPT_REFRESH`), 4 |
| Smoke Cocó | 3 Step 5 |
| No plan catalog join | 3 `catalogOutOfScope` |
| No Maps name join | 3 `maps_context` note only |
| Invalid / require fixture errors | 1 tests + 3 Step 6 |
| Filter city / bairro / unknown | 1 |
| Playwright cold implement | **out of plan** (follow-up) |

## Placeholder scan

No TBD. Cold job explicitly stub with exit 2.

## Type consistency

- `resolveAcceptList` → `{ accept_list, warnings, source }` used in Task 1 and Task 3
- `ingest_kind` always `gurupass_accept_geo`
- Env names match spec: `GP_ACCEPT_FIXTURE`, `REQUIRE_ACCEPT_FIXTURE`, `GP_ACCEPT_REFRESH`

---

## Execution handoff

Plan complete and saved to `Docs/superpowers/plans/2026-07-25-gurupass-accept-geo.md`.

**Two execution options:**

1. **Subagent-Driven (recommended)** — fresh subagent per task, review between tasks  
2. **Inline Execution** — this session, `executing-plans`, batch with checkpoints  

Which approach?
