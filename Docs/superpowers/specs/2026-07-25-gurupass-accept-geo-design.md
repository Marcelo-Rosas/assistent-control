# Gurupass accept-geo ingest

Date: 2026-07-25  
Status: draft (awaiting user review)  
Scope: hot path “quem aceita GP no bairro” — não planos/preços

## Problem

Gurupass differs from TotalPass and Wellhub. TP/WH gate access by plan tier (`plan_minimo ≤ user_plan`). Gurupass gates by **binary acceptance**: the gym is (or is not) on Gurupass.

National plan catalog (Ilimitado 10…140, credits/day, BRL) does **not** answer “which gyms in Cocó accept GP?”. If zero gyms in the target geo accept GP, the subscriber’s plan is irrelevant for that map question.

Current `scripts/ingest-gurupass-canonical.mjs` still frames catalog as `/nossos-planos/` smoke (`needs_browser`) and geo as Maps fixture with empty `gurupass_hit` / `plan_hint`. That does not answer the product question:

> Liste quais academias aceitam os agregadores no bairro Cocó

For Gurupass, the answer source is [`buscar-academias/`](https://www.gurupass.com.br/buscar-academias/), not plan join.

## Goals

1. Hot ingest produces an artifact that lists GP-accepted gyms for a target geo (bairro/cidade/uf).
2. Hot path stays $0 API (fixture on disk).
3. Cold path (cron ~30d) refreshes the fixture via browser against `buscar-academias/`.
4. Smoke Cocó: one hot run → readable `accept_list` + `gp_accept_count` (0 is a valid answer).

## Non-goals (this cycle)

- Ilimitado / credits / price catalog join
- Name-to-name join Maps × GP (Maps optional context only)
- Partner page modalidades / grade horária
- Live browser on every hot run
- Dashboard / NL agent wiring
- Implementing Playwright cold job in the same first smoke (contract + stub only)

## Approach (chosen)

**Hybrid hot fixture + cold browser** (approach 2).

| Path | Behavior |
|------|----------|
| Hot | Read `GP_ACCEPT_FIXTURE`, filter by target geo, write `ingest/gurupass/<run_id>.json` |
| Cold | Browser export from `buscar-academias/` → rewrite fixture; optional diff vs previous |

Rejected:

- Fixture-only forever (no refresh contract)
- Live browser on hot ingest (breaks $0 / speed)

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
