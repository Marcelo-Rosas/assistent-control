# Ops — Evolution + Sakana best-fit (GymSite)

**Date:** 2026-07-24  
**Decision:** Use **webhook → Edge → Sakana**. Do **not** enable Evolution OpenAI bots (`/openai/create`). Do **not** use Evolution Bot unless you later want Evolution-owned triggers (then Edge must only return text — no double `sendText`).

## Architecture (locked)

```
WhatsApp (Baileys via Evolution)
  → webhook MESSAGES_UPSERT + apikey
  → Edge eros-evolution-webhook
       → eros_leads / eros_conversations / eros_messages / eros_pipeline
       → if eros_auto_reply.enabled: EdgeRuntime.waitUntil → eros-ai-reply
            → resolveLlmProvider (eros_config → env → sakana)
            → callLlm (SAKANA_*)
            → Evolution POST /message/sendText/{INSTANCE}
            → persist outgoing eros_messages
  → Realtime / poll → /eros/chat + Kanban

Human / SPIN:
  UI → eros-send-message → Evolution sendText (CHANNEL_PROVIDER=evolution)
```

## Rejected

| Evolution feature | Why reject |
|-------------------|------------|
| `/openai/creds` + `/openai/create` | Locks OpenAI; bypasses `eros_*` CRM + Sakana toggle |
| Evolution Bot → random URL | Only if Edge returns `{message}` and **stops** calling sendText |

## Secrets (Edge Dashboard or CLI)

Required:

- `CHANNEL_PROVIDER=evolution`
- `EVOLUTION_URL` (no trailing slash)
- `EVOLUTION_INSTANCE`
- `EVOLUTION_API_KEY` (also used as webhook `apikey` unless `EVOLUTION_WEBHOOK_SECRET` set)
- `SAKANA_API_KEY` (from local `.env.local` — copy to Edge; never `VITE_`)
- `SAKANA_BASE_URL=https://api.sakana.ai/v1`
- `LLM_PROVIDER=sakana`
- `EROS_AUTO_REPLY=false` (default safe; UI can override via `eros_config`)

Optional: `SAKANA_MODEL`, `SAKANA_TIMEOUT_MS`, `EVOLUTION_WEBHOOK_SECRET`

Push filtered secrets:

```powershell
.\scripts\push-edge-secrets.ps1 -ProjectRef gxmaxbjgdrqdcizvdojp
```

## Evolution Manager / API

1. Instance connected (QR / Baileys).
2. Webhook URL:

```
https://gxmaxbjgdrqdcizvdojp.supabase.co/functions/v1/eros-evolution-webhook
```

3. Events: enable **MESSAGES_UPSERT** (or `messages.upsert`).
4. Header: `apikey: <EVOLUTION_API_KEY or EVOLUTION_WEBHOOK_SECRET>`.
5. Leave OpenAI / Evolution Bot **disabled**.

## UI

- Eros header: LLM provider + **Auto-reply** toggle → `eros_config`.
- Manual chat / SPIN always available when auto-reply off.

## Smoke test

1. Send WA text to instance.
2. Row appears in `eros_leads` (`channel=whatsapp`) + message + pipeline `new`.
3. Visible in `/eros/chat`.
4. With auto-reply **off**: no bot reply.
5. Toggle auto-reply **on** + Sakana secret set: outbound via Evolution, stored as `outgoing`.
6. Browser Network never hits `api.sakana.ai` (only Supabase functions).
