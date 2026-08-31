# Loop Regulatório CONFEF/CREF

Spec: `Docs/superpowers/specs/2026-08-03-regulatorio-confef-cref-loop-design.md`  
Skill: `.agents/skills/regulatorio-confef-loop/SKILL.md`  
State: `Docs/ops/regulatorio-loop-state.md`  
Sentinel: `AGENT_LOOP_TICK_regulatorio`

## Pré-requisitos

Env (`.env` / `.env.local` — **nunca** commit):

| Var | Uso |
|-----|-----|
| `SUPABASE_URL` ou `VITE_SUPABASE_URL` | Edge base |
| `SUPABASE_SERVICE_ROLE_KEY` | smoke ask (não logar) |
| `REGULATORIO_GROUP_ID` | `b7dad505-2d2a-49a9-bbaf-d4b9c4929dea` |

## Scout HTTP (Task 5) + WAF

CONFEF protege o site com **WAF** (Web Application Firewall): `fetch`/`curl`/`--scout-noticias` recebem `302 → /challenge` e falham.

**Path oficial (contorno WAF):** Playwright Chromium real.

```powershell
# Path oficial — Playwright headed (Chrome instalado); contorna WAF
npm run scout:regulatorio-browser

# Com tick scout em seguida
npm run scout:regulatorio-browser -- --tick

# Forçar headless (costuma falhar no /challenge)
$env:HEADLESS="1"; npm run scout:regulatorio-browser
```

Alternativa: Cursor browser → salvar HTML → `--scout-html-file`.

```powershell
# Live fetch (quase sempre falha no WAF)
npm run loop:regulatorio-tick -- --force --scout-noticias

# HTML salvo
npm run loop:regulatorio-tick -- --force --scout-html-file data/raw/Regulatorio/inbox/fixtures/confef-noticias-2026-08-03.html
```

Saída tick: `candidatesNew` + `suggestedDecision`. **Não** ingesta sozinho.

| Flag / comando | Função |
|----------------|--------|
| `scout:regulatorio-browser` | Playwright bypass WAF → HTML fixture |
| `--scout-noticias` | fetch live (bloqueado pelo WAF) |
| `--scout-html-file` | parse HTML já salvo |

## Flags CLI (`npm run loop:regulatorio-tick`)

| Flag | Default | Função |
|------|---------|--------|
| `--force` | off | ignora skip &lt;20h |
| `--write-inbox` | off | grava `data/raw/Regulatorio/inbox/YYYY-MM-DD/` |
| `--update-state` | on | patch `regulatorio-loop-state.md` |
| `--no-update-state` | — | debug sem gravar state |
| `--candidate-url` | — | URL allowlist CONFEF/CREF |
| `--title` | untitled | título p/ hash + slug |
| `--date` | hoje | `YYYY-MM-DD` |
| `--decision` | obrigatório c/ URL | `drop` \| `raw-only` \| `ingest` \| `human-amber` |
| `--tema` | `resolucao_confef` | meta tema |
| `--body-file` | — | corpo inbox |
| `--reason` | = decision | 1 linha no log decisions |

CLI **não** roda ingest/embed. State write por último; falha → exit 1 (sem rollback DB — SoT = chunks).

## Cenários

### Dev dry-run (drop)

```powershell
npm run loop:regulatorio-tick -- --force --candidate-url "https://www.confef.org.br/comunicacao/noticias/exemplo" --title "Exemplo" --date "2026-08-03" --decision drop --tema resolucao_confef
```

### Write inbox

```powershell
npm run loop:regulatorio-tick -- --force --write-inbox --candidate-url "https://www.confef.org.br/comunicacao/noticias/exemplo" --title "Anuidade" --date "2026-08-03" --decision raw-only --tema anuidades_cref --body-file data/raw/Regulatorio/inbox/README.md
```

### Skip natural (&lt;20h, sem `--force`)

```powershell
npm run loop:regulatorio-tick
```

Expected: `{ "skipped": true, ... }` se `last_tick` recente.

### Debug sem state

```powershell
npm run loop:regulatorio-tick -- --force --no-update-state --candidate-url "https://www.confef.org.br/x" --title "T" --date "2026-08-03" --decision drop
```

### Allowlist fail

```powershell
npm run loop:regulatorio-tick -- --force --candidate-url "https://evil.example/x" --title "X" --date "2026-08-03" --decision drop
```

Expected: exit 1, `error` allowlist.

## Fluxo agente (v1 — chain manual)

1. Ler skill + state  
2. `npm run loop:regulatorio-tick -- ...` (state auto)  
3. **Só se** `decision=ingest`:  
   - `npm run ingest:regulatorio-curado` (dry-run default do script, depois apply conforme script)  
   - `npm run embed:regulatorio`  
4. `npm run smoke:regulatorio-ask`  
5. Âmbar/digest: editar state à mão se preciso  

Task 6 (`--apply-pipeline`) = opcional, não v1.

## `/loop` Cursor

```
/loop 1d
Ler skill regulatorio-confef-loop. Scout allowlist CONFEF/CREF.
Rodar tick CLI. Ingest só se approved. Smoke se ingest.
Sentinel wake: AGENT_LOOP_TICK_regulatorio
```

## Testes

```powershell
npm run test:regulatorio-loop
npm run smoke:regulatorio-ask
```

## Fora de escopo

Mercado, taxas prefeitura, DAG, heal timeout Mercado, orquestrador all-in-one v1, rollback state↔DB.
