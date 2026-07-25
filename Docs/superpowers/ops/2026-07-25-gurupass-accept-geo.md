# Gurupass accept-geo — ops runbook

Date: 2026-07-25 (refactored: plano_minimo)  
Spec: `Docs/superpowers/specs/2026-07-25-gurupass-accept-geo-design.md`  
Plan: `Docs/superpowers/plans/2026-07-25-gurupass-accept-geo.md`

## Product question

> Quais academias aceitam Gurupass em Fortaleza / no bairro X — e a partir de qual plano?

Source: [`buscar-academias/…](https://www.gurupass.com.br/buscar-academias/brasil/fortaleza---ce/?type=city)` export.

**Correction:** GP is **not** binary. Each gym has `plano_minimo` (ex. `Ilimitado 35`) + `valor_mensal_brl`. Gate = `creditos_minimos ≤ user_credits` (same idea as TP “a partir de”).

## Hot path ($0 API)

| Env | Role |
|-----|------|
| `GP_ACCEPT_FIXTURE` | JSON with `academias[]` (page export) or `items[]` |
| `BAIRRO` | Empty = city-wide; set to filter (ex. `Aldeota`) |
| `CIDADE` / `UF` | Default Fortaleza / CE |
| `GP_USER_CREDITS` | e.g. `35` — filter gyms with min ≤ 35 |
| `GP_USER_PLAN` | e.g. `Ilimitado 35` — same as credits parse |
| `REQUIRE_ACCEPT_FIXTURE=1` | Fail if fixture missing |

Default fixture: `ingest/fixtures/gp-accept-fortaleza.json` (manual export 2026-07-25).

### PowerShell — all Fortaleza GP gyms

```powershell
$env:GP_ACCEPT_FIXTURE="ingest/fixtures/gp-accept-fortaleza.json"
$env:BAIRRO=""
Remove-Item Env:GP_USER_CREDITS -ErrorAction SilentlyContinue
node scripts/ingest-gurupass-canonical.mjs
```

Expect: `gp_accept_count: 6`, each row has `plano_minimo` + `valor_mensal_brl`.

### PowerShell — user has Ilimitado 35

```powershell
$env:GP_ACCEPT_FIXTURE="ingest/fixtures/gp-accept-fortaleza.json"
$env:BAIRRO=""
$env:GP_USER_CREDITS="35"
node scripts/ingest-gurupass-canonical.mjs
```

Expect: gyms with min ≤ 35 (Healthy 15, Libra 25, CT Libra 30, Cross Experience 30, vs club 35). Crossfit Aldeota (70) out.

### Tests

```powershell
node --test scripts/lib/gpAcceptGeo.test.mjs
```

## Fixture formats

**Page export (preferred):**

```json
{
  "cidade": "Fortaleza, CE",
  "academias": [
    {
      "nome": "…",
      "endereco": "…, Bairro - Fortaleza",
      "modalidades": [],
      "plano_minimo": "Ilimitado 35",
      "valor_mensal_brl": 173.25
    }
  ]
}
```

Canonical `items[]` also accepted (name/address/bairro/…).

## Cold stub

`GP_ACCEPT_REFRESH=1` → exit 2. Future Playwright must capture **plano_minimo** + price per card, not name-only.
