# GymSite Pipeline — Design Spec

**Date:** 2026-07-24  
**Product:** GymSite - Pipeline (ex “Viver de IA” / assistent-control)  
**Status:** Spec patched post-Bugbot (11 findings) — awaiting user OK → writing-plans  
**Supersedes:** draft Section 1 approval; this revision locks security + schema + send path

---

## Goals (this cycle)

1. Wire **Evolution API** WhatsApp into `eros_*` (blueprint backend).
2. **Rebrand** → “GymSite - Pipeline”; admin = Marcelo Rosas / marketing@gymsite.com.br.
3. **Remove mock data** paths; UI empty-state when DB empty.
4. **LLM provider toggle** in UI (sakana | ollama | gemini | openai).
5. Meta Edge Functions stay in repo but **must no-op** unless `CHANNEL_PROVIDER=meta`.
6. Fix **theme CSS** (`oklch` vs Tailwind `hsl(var(--…))`) so shadcn/tokens work.
7. Align **`Plan/EROS_INTEGRATION_GUIDE.md`** with Evolution-first GymSite (or add banner + pointer to this spec).
8. **Safe Sakana Fugu playground** at `/playground` (Edge secrets only; never `VITE_SAKANA_*`; never wire into CRM `/chat`). See `docs/superpowers/prompts/2026-07-24-fugu-playground-safe.md`.
9. **Knowledge Base** at `/knowledge` — persist sources; no fake train/RAG scripts. See `docs/superpowers/prompts/2026-07-24-knowledge-base-safe.md`.

Out of scope: Blueprint.js toolkit, Redis queue, Supabase Auth prod login, Instagram engage, browser OpenAI SDK to Sakana, mock Knowledge training theater.

---

## Bugbot resolution log

| # | Severity | Finding | Spec decision |
|---|----------|---------|---------------|
| 1 | high | `index.css` oklch vs `hsl(var(--…))` | **Fix in cycle 0:** convert theme vars to HSL channels **or** switch Tailwind/shadcn to oklch-native. Prefer keep slate custom UI; fix shadcn layer so both coexist. |
| 2 | high | `eros-send-message` Meta-only | **Replace/extend:** shared `sendOutbound()` → Evolution `sendText` when `CHANNEL_PROVIDER=evolution`; Meta Graph only when `meta`. UI/SPIN/send use same path. |
| 3 | high | webhook no `eros_pipeline` row | **On lead create:** insert `eros_pipeline` (`stage=new`, `position=0`) in same transaction / sequential awaits. Kanban always has card. |
| 4 | high | `EVOLUTION_API_KEY` in `eros_config` + anon RLS | **Secrets NEVER in `eros_config`.** Only Supabase Edge Secrets / `.env` for serve. `eros_config` may store non-secret: `llm_provider`, `eros_auto_reply`, `evolution_instance` name, `evolution_url` **host only if non-sensitive** — prefer URL also secret. Settings UI writes via **admin Edge `eros-settings`** that sets secrets / returns masked status — not direct client insert of keys. |
| 5 | high | Guide Meta-first + mocks | **Update guide** in same cycle: Evolution primary, mocks removed, link this spec. |
| 6 | medium | LLM via `eros_config` not impl; default gemini | **Implement** resolve: see §5. Default **`sakana`**. |
| 7 | medium | `eros-meta-webhook` ignores `CHANNEL_PROVIDER` | **Guard:** if env ≠ `meta`, return 200 `{ignored:true}` without writes. Same for send. |
| 8 | medium | no unique `(channel, phone)` / `(channel, external_id)` | **Migration:** partial unique indexes (see §Schema). |
| 9 | medium | pipeline stage vs `eros_leads.status` drift | **Single write helper** `setLeadStage(leadId, stage)` updates **both** `eros_leads.status` and `eros_pipeline.stage` (same enum values where overlapping). Discarded = lead status only; pipeline row optional archive. |
| 10 | medium | localStorage vs eros_config LLM sync | **Precedence locked** (§5). |
| 11 | medium | `eros_config (company_id, key)` NULL dupes | **Migration:** unique on `key` where `company_id IS NULL`; keep `(company_id, key)` where company set. Or use sentinel company uuid — prefer **partial unique index**. |

---

## Section 0 — Theme CSS (new)

**Problem:** shadcn/Tailwind expect `--background: H S% L%` inside `hsl(var(--background))`; file uses full `oklch(...)`.

**Fix (pick one in plan; default A):**

- **A (recommended):** rewrite `:root` / `.dark` CSS vars to HSL components matching current dark slate look of the app (cyan accents stay utility classes).
- **B:** migrate components to `oklch(var(--…))` if Tailwind v4/shadcn already oklch-native end-to-end — verify `package.json` / `components.json` before choosing.

Do this early — broken theme confuses all UI work.

---

## Section 1 — WhatsApp Evolution → eros_* (REVISED)

### Decision

**Approach B (phased):** Evolution primary. Meta code remains, **guarded** by `CHANNEL_PROVIDER`.

### Flow

```
Evolution (MESSAGES_UPSERT)
  → Edge eros-evolution-webhook (verify_jwt=false)
  → upsert eros_leads (unique channel+phone / channel+external_id)
  → upsert eros_conversations
  → insert eros_messages (incoming, text|audio)
  → ensure eros_pipeline row (stage=new) if missing
  → if EROS_AUTO_REPLY=true: waitUntil invoke eros-ai-reply
       → resolveLlmProvider() → callLlm
       → sendOutbound() → Evolution POST .../message/sendText/{INSTANCE}
       → insert eros_messages (outgoing)
       → optional setLeadStage(...)
  → Realtime → Eros Chat / Kanban
```

Human send from UI / SPIN “Usar + Enviar”:

```
erosService.sendMessage → Edge eros-send-message
  → CHANNEL_PROVIDER=evolution → Evolution sendText
  → CHANNEL_PROVIDER=meta → Meta Graph (existing)
  → persist eros_messages
```

### CRM sync

`setLeadStage(leadId, stage)` updates:

1. `eros_pipeline.stage` (+ position if needed)
2. `eros_leads.status` (same stage string when in shared enum)

| Blueprint label | eros stage |
|-----------------|------------|
| qualification   | qualifying |
| presentation    | call       |
| negotiation     | proposal   |
| close           | converted  |

### Blueprint → Edge mapping

| Blueprint mock | Implementation |
|----------------|----------------|
| WEBHOOK `/api/v1/webhooks/whatsapp` | `eros-evolution-webhook` |
| AI Response Processor | `eros-ai-reply` (+ `eros-spin-generate` for UI SPIN) |
| CRM Sync | `setLeadStage` helper shared |
| send | `evolutionClient.sendText` inside `eros-send-message` when evolution |

### Secrets vs config (LOCKED)

| Name | Where |
|------|--------|
| `EVOLUTION_API_KEY` | **Edge Secret only** |
| `EVOLUTION_URL` | **Edge Secret only** |
| `EVOLUTION_INSTANCE` | Edge Secret (or non-secret `eros_config` if instance name public) |
| `CHANNEL_PROVIDER` | Edge Secret / env (`evolution` \| `meta`) |
| `EROS_AUTO_REPLY` | Edge env or `eros_config` boolean (non-secret) |
| `llm_provider` | `eros_config` (non-secret) + localStorage mirror |
| `SAKANA_*` / `GEMINI_*` / `OPENAI_*` / `OLLAMA_*` | **Edge Secret only** |

Settings UI: form collects values → calls **`eros-settings`** (JWT/admin) which updates secrets via management API **or** documents “set in Dashboard” + saves only non-secrets to `eros_config`. **Never** `supabase.from('eros_config').insert({ key: 'EVOLUTION_API_KEY', value })` from anon client.

### Schema migrations (required this cycle)

```sql
-- Upsert-safe lead identity
create unique index if not exists eros_leads_channel_phone_uniq
  on public.eros_leads (channel, phone)
  where phone is not null;

create unique index if not exists eros_leads_channel_external_id_uniq
  on public.eros_leads (channel, external_id)
  where external_id is not null;

-- eros_config: no duplicate keys for global (company_id null)
create unique index if not exists eros_config_global_key_uniq
  on public.eros_config (key)
  where company_id is null;
```

Webhook upsert uses `on conflict` on these indexes.

### CHANNEL_PROVIDER guards

- `eros-meta-webhook`: if `CHANNEL_PROVIDER !== 'meta'` → `200 { ok: true, ignored: true }`.
- `eros-evolution-webhook`: if `CHANNEL_PROVIDER !== 'evolution'` → same.
- `eros-send-message`: branch on provider; error 503 if Evolution secrets missing when evolution selected.

---

## Section 2 — Brand: GymSite - Pipeline

Unchanged: replace all user-facing “Viver de IA” / `viverdeia.com` → **GymSite - Pipeline** / `@gymsite.com.br`. Keep `eros_*` code names.

---

## Section 3 — Admin identity

- Name: **Marcelo Rosas**
- Email: **marketing@gymsite.com.br**
- Role: **admin** (default)

---

## Section 4 — Remove mocks

- Delete Eros mock data paths; setup banner if Supabase missing.
- Functions screen: blueprint = documentation; map to real Edge names.

---

## Section 5 — LLM provider toggle (REVISED)

### Precedence (LOCKED)

1. **`eros_config.llm_provider`** (source of truth for Edge) — else  
2. **`Deno.env LLM_PROVIDER`** — else  
3. Default **`sakana`**

(Playground `/playground` may pass **model / reasoning / web_search** in body; Eros SPIN does **not** accept client `provider` override in v1.)

### UI sync

- Toggle writes **both**: `localStorage.gymsite_llm_provider` **and** upsert `eros_config` key `llm_provider` (via authenticated/service path or direct if RLS allows non-secret write).
- On load: prefer `eros_config`; if fetch fails, fall back localStorage then `sakana`.
- localStorage alone **never** drives Edge; Edge ignores localStorage.

### callLlm

Change default in `shared/llm.ts` from `gemini` → **`sakana`**. Read config in Edge entrypoints before `callLlm`.

---

## Section 6 — Docs / guide

- Patch `Plan/EROS_INTEGRATION_GUIDE.md`: Evolution-first, GymSite brand, no mock-as-default, link `docs/superpowers/specs/2026-07-24-gymsite-pipeline-design.md`.
- Or add top callout “SUPERSEDED for channel layer — see GymSite spec” if full rewrite too long — prefer real edits to webhook/send sections.

---

## Implementation order (revised)

0. Theme CSS fix (`index.css` / Tailwind alignment).  
1. Schema migrations (unique indexes + config global key).  
2. Rebrand + admin Marcelo.  
3. Remove Eros mocks.  
4. LLM toggle + Edge resolve + default sakana.  
5. `evolutionClient` + CHANNEL_PROVIDER guards on Meta/Evolution.  
6. Extend `eros-send-message` for Evolution; webhook + pipeline ensure + optional AI reply.  
7. Settings without secret-in-DB; document Dashboard secrets.  
8. Update EROS_INTEGRATION_GUIDE.  
9. Safe Fugu `/playground` (Edge-only).  
10. Safe Knowledge `/knowledge` (persist + honest status).  
11. Deploy (project must be ACTIVE).

---

## Success criteria

- [ ] Theme tokens render correctly (no broken hsl/oklch).  
- [ ] UI GymSite - Pipeline; admin Marcelo / marketing@gymsite.com.br.  
- [ ] No fake Eros leads when Supabase connected.  
- [ ] Toggle → `eros_config` → Edge uses provider (default sakana).  
- [ ] Evolution inbound → lead + conversation + message + **pipeline row**.  
- [ ] Outbound UI/SPIN uses Evolution `sendText` when provider evolution.  
- [ ] No API keys in `eros_config` / client.  
- [ ] Meta webhook no-ops unless `CHANNEL_PROVIDER=meta`.  
- [ ] Guide aligned or explicitly superseded.  
- [ ] `/playground` talks only to Edge; no Sakana key in client.  
- [ ] `/knowledge` persists sources; train/chat do not fake success.  
- [ ] User OK this patched spec → `docs/superpowers/plans/…` → implement.

---

## Locked defaults

- `CHANNEL_PROVIDER=evolution`
- `EROS_AUTO_REPLY=false`
- LLM default `sakana`
- Secrets = Edge Secrets only
- No commit of `.env.local`
