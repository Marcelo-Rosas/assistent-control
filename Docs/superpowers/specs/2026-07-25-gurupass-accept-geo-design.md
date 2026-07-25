# Gurupass accept-geo ingest

Date: 2026-07-25  
Status: approved (amended 2026-07-25 — plano_minimo)  
Scope: hot path “quem aceita GP no geo + a partir de qual Ilimitado N”

## Problem

Manual export from [`buscar-academias/brasil/fortaleza---ce/?type=city`](https://www.gurupass.com.br/buscar-academias/brasil/fortaleza---ce/?type=city) shows each gym has **`plano_minimo`** (e.g. `Ilimitado 70`) and **`valor_mensal_brl`**. GP is **not** binary accept/reject.

Gate (same idea as TP): user credits ≥ gym `creditos_minimos` parsed from `plano_minimo`.

Source of truth for geo+plan: buscar-academias export (fixture), not `/nossos-planos/` alone and not Maps name join.

> Liste quais academias aceitam Gurupass em Fortaleza / no bairro — e com qual plano mínimo.

## Goals

1. Hot ingest lists GP gyms for target geo with `plano_minimo` + `valor_mensal_brl`.
2. Optional user plan filter: `creditos_minimos ≤ GP_USER_CREDITS`.
3. Hot path $0 API (fixture on disk); accepts page export `{ academias: [...] }`.
4. Cold path (cron) refreshes fixture from buscar-academias **including plano_minimo**.
5. Smoke Fortaleza: fixture → artifact with plan fields (count 6 city-wide).

## Non-goals (this cycle)

- Live browser on every hot run
- Full national Ilimitado 10…140 ladder scrape (prices already on each gym card)
- Name-to-name join Maps × GP
- Dashboard / NL agent wiring
- Playwright cold job implementation (stub only)

## Approach (chosen)

**Hybrid hot fixture + cold browser**, with **plan gate**:

| Path | Behavior |
|------|----------|
| Hot | Read fixture → geo filter → optional user-credits filter → artifact |
| Cold | Browser export buscar-academias → rewrite fixture (must keep `plano_minimo`) |

Match rule: gym on list for geo **and** (if user plan set) `creditos_minimos ≤ user_credits`.

## Architecture

```
HOT (daily / local smoke)
  GP_ACCEPT_FIXTURE → filter(GEO) → artifact

COLD (cron ~30d)
  Playwright → buscar-academias/ (cidade/bairro)
            → rewrite fixture
            → optional diff (added/removed)
```

Env:

- `GP_ACCEPT_FIXTURE` — path to accept-list JSON (required for meaningful hot runs)
- `BAIRRO` / `CIDADE` / `UF` — target geo (defaults may match Cocó smoke)
- `GEO_FIXTURE` — optional Maps context only; must not define GP acceptance
- `REQUIRE_ACCEPT_FIXTURE=1` — fail hard if fixture missing (optional)
- `GP_ACCEPT_REFRESH=1` — reserved for cold refresh job (follow-up)

## Fixture schema

Path example: `ingest/fixtures/gp-accept-coco.json`

```json
{
  "aggregator": "gurupass",
  "source": {
    "url": "https://www.gurupass.com.br/buscar-academias/",
    "method": "browser_export",
    "fetched_at": "ISO-8601"
  },
  "target_geo": { "bairro": "Cocó", "cidade": "Fortaleza", "uf": "CE" },
  "items": [
    {
      "name": "string",
      "address": "string|null",
      "bairro": "string|null",
      "cidade": "string",
      "uf": "string",
      "partner_url": "string|null"
    }
  ]
}
```

Filter rules:

- Match `cidade` (and `uf` when both present) against target.
- If item has `bairro`, also match target bairro (slug-normalized).
- If item lacks `bairro`, include in city-wide slice and flag `bairro_unknown: true`.

## Artifact shape

- `schema_version`: 1
- `ingest_kind`: `gurupass_accept_geo`
- `aggregator`: `gurupass`
- `run_id`, `geo` (target)
- `accept_list`: filtered items
- `summary.gp_accept_count`: number
- `catalog` / plan prices: `status: "out_of_scope"` (or omitted); no fetch of `/nossos-planos/` in this cycle
- `maps_context` (optional): raw Maps sample if `GEO_FIXTURE` set — separate from acceptance

Match rule: **hit = present on GP accept list for geo**. No Maps name join.

## Script changes (`ingest-gurupass-canonical.mjs`)

1. Load and filter `GP_ACCEPT_FIXTURE` → `accept_list`.
2. Set `ingest_kind` to `gurupass_accept_geo`.
3. Default catalog path to out-of-scope (skip `/nossos-planos/` smoke for this design).
4. Keep Maps behind `GEO_FIXTURE` as optional `maps_context` only.
5. Drop plan-tier gating (`plan_hint` as acceptance signal).
6. Emit `summary.gp_accept_count`.

Cold browser: document + env hook; first smoke may use a **manual seed fixture** (empty or real GP names). Playwright implementation is a follow-up task in the implementation plan, not a blocker for Cocó hot smoke.

## Errors

| Case | Behavior |
|------|----------|
| Fixture JSON invalid | Exit non-zero |
| Fixture missing | Warning + `gp_accept_count: 0`, unless `REQUIRE_ACCEPT_FIXTURE=1` → fail |
| Zero hits after filter | Success; count 0 is valid product answer |

## Smoke (Cocó)

```bash
GP_ACCEPT_FIXTURE=ingest/fixtures/gp-accept-coco.json \
BAIRRO=Cocó CIDADE=Fortaleza UF=CE \
node scripts/ingest-gurupass-canonical.mjs
```

Expect: artifact under `ingest/gurupass/` with `accept_list` array and `summary.gp_accept_count`.

## Testing

- Invalid fixture → non-zero exit
- Missing fixture + `REQUIRE_ACCEPT_FIXTURE=1` → non-zero exit
- Valid fixture → `aggregator === "gurupass"` and `Array.isArray(accept_list)`
- Filter: city-only vs city+bairro cases covered by fixture items

## Follow-ups (out of this spec’s implementation gate)

- Playwright cold refresh writing `gp-accept-*.json`
- Diff report vs previous fixture
- Reintroduce national Ilimitado price catalog as a separate ingest/catalog module
- Cross-aggregator “aceita agregadores no Cocó” rollup (TP ∩ WH ∩ GP) at product layer
