# Gurupass accept-geo — ops runbook

Date: 2026-07-25  
Spec: `Docs/superpowers/specs/2026-07-25-gurupass-accept-geo-design.md`  
Plan: `Docs/superpowers/plans/2026-07-25-gurupass-accept-geo.md`

## Product question

> Quais academias aceitam Gurupass no bairro Cocó?

Answer source: accept list from [`buscar-academias/`](https://www.gurupass.com.br/buscar-academias/) (fixture), **not** plan tier and **not** Maps name join.

Planos Ilimitado / créditos / preços = **out of this path**.

## Hot path (daily / local, $0 API)

| Env | Role |
|-----|------|
| `GP_ACCEPT_FIXTURE` | Path to accept JSON (e.g. `ingest/fixtures/gp-accept-coco.json`) |
| `BAIRRO` / `CIDADE` / `UF` | Target geo (defaults Cocó / Fortaleza / CE) |
| `REQUIRE_ACCEPT_FIXTURE=1` | Fail if fixture unset/missing |
| `GEO_FIXTURE` | Optional Maps context only — does **not** set acceptance |

### PowerShell smoke

```powershell
$env:GP_ACCEPT_FIXTURE="ingest/fixtures/gp-accept-coco.json"
$env:BAIRRO="Cocó"
$env:CIDADE="Fortaleza"
$env:UF="CE"
node scripts/ingest-gurupass-canonical.mjs
```

Expect: `ingest_kind: gurupass_accept_geo`, `gp_accept_count` ≥ 0, artifact under `ingest/gurupass/`.

Seed fixture currently yields **2** hits (Cocó + citywide unknown); Aldeota dropped.

### Bash smoke

```bash
GP_ACCEPT_FIXTURE=ingest/fixtures/gp-accept-coco.json \
BAIRRO=Cocó CIDADE=Fortaleza UF=CE \
node scripts/ingest-gurupass-canonical.mjs
```

### Tests

```powershell
node --test scripts/lib/gpAcceptGeo.test.mjs
```

## Cold path (stub)

`GP_ACCEPT_REFRESH=1` → exit **2** with stub error. Not implemented.

Future: Playwright on `buscar-academias/` (filter cidade/bairro) → rewrite `ingest/fixtures/gp-accept-*.json` → optional diff. Cron ~30d. Hot path keeps reading disk only.

## Artifact fields (hot)

- `accept_list` — filtered gyms
- `summary.gp_accept_count`
- `catalog.plan.status` = `out_of_scope`
- `maps_context` — optional; never defines GP hit
