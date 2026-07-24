# Safe prompt — Sakana Fugu Playground (`/playground`)

**Status:** Approved rewrite (replaces unsafe client-side Fugu prompt)  
**Date:** 2026-07-24  
**Implements via:** `docs/superpowers/plans/2026-07-24-gymsite-pipeline.md` → Task 13  
**Do not** put `SAKANA_API_KEY` in `VITE_*` or call Sakana from the browser.

---

## Role

Act as a Senior Frontend + Edge engineer (React, TypeScript, Supabase Edge/Deno).

## Objective

Add a **GymSite LLM Playground** at route `/playground` to exercise Sakana Fugu (models, reasoning effort, optional web search, streaming, token usage) **without** breaking CRM `/chat` or Eros `/eros/chat`.

## Hard security rules (non-negotiable)

1. **No** `VITE_SAKANA_API_KEY`, **no** `dangerouslyAllowBrowser`, **no** `openai` browser client to Sakana.
2. All Sakana calls go through Edge Function `eros-fugu-playground` using Edge Secrets `SAKANA_API_KEY`, `SAKANA_BASE_URL` (default `https://api.sakana.ai/v1`).
3. Prefer reuse of `supabase/functions/_shared/llm.ts` patterns; extend with Responses API helpers in `_shared/sakanaResponses.ts` if chat-completions path is insufficient.
4. Timeout default **120s** (`SAKANA_TIMEOUT_MS`).
5. Admin-oriented UI: gate with existing `RoleContext` (`currentRole === 'admin'` or `hasPermission` if a dedicated action exists). Non-admin → redirect or “acesso restrito”.
6. Never commit `.env.local`. Document secrets only in `.env.example` **without** `VITE_` prefix for Sakana.

## Project facts (use these paths)

- Live app entry: `src/App.tsx` (not orphan root `App.tsx` unless deleting duplicates later).
- Theme: dark slate + cyan/violet ambient glow in `AppLayout`.
- Keep `/chat` → `ChatInterface` as CRM mock/threads UI — **do not** wire Fugu into it.
- Keep `/eros/chat` → Evolution/SPIN CRM — separate product surface.
- After GymSite Task 6, LLM provider prefs live in `eros_config`; playground may **override model/reasoning for the request body** (playground-only), while still using server `SAKANA_*` secrets. Do not accept arbitrary base URLs from the client.

## Sakana API (server-side)

| Item | Value |
|------|--------|
| Base URL | `https://api.sakana.ai/v1` |
| Auth | `Authorization: Bearer $SAKANA_API_KEY` |
| Primary endpoint | `POST /v1/responses` |
| Fallback | `POST /v1/chat/completions` if Responses fails or unsupported for model |
| Models | `fugu` (default), `fugu-ultra` (alias accept `fugu-ultra-v1.1` → normalize to `fugu-ultra`), optional `fugu-cyber` |
| Reasoning | `high` \| `xhigh`; `max` **only** when model is ultra |
| Tools | When `web_search: true`, include `{"type": "web_search"}` on Responses API |
| Streaming | SSE from Edge → client (`text/event-stream`) or chunked JSON lines; document chosen format in code comment |

Token mapping: return `input_tokens`, `output_tokens`, plus orchestration fields when present (`orchestration_input_tokens`, `orchestration_output_tokens`).

## Implementation steps

### 1) Env docs only

Update `.env.example` (Edge / `supabase functions serve --env-file`):

```
SAKANA_API_KEY=YOUR_SAKANA_API_KEY_HERE
SAKANA_BASE_URL=https://api.sakana.ai/v1
SAKANA_MODEL=fugu
SAKANA_TIMEOUT_MS=120000
```

**Forbidden:**

```
VITE_SAKANA_API_KEY=...
```

### 2) Edge: `supabase/functions/eros-fugu-playground/index.ts`

- CORS via `_shared/cors.ts`.
- `POST` body:

```ts
type PlaygroundBody = {
  messages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>;
  model?: 'fugu' | 'fugu-ultra' | 'fugu-cyber' | 'fugu-ultra-v1.1';
  reasoning_effort?: 'high' | 'xhigh' | 'max';
  web_search?: boolean;
  stream?: boolean;
};
```

- Normalize model id; reject `reasoning_effort: 'max'` unless ultra.
- Call Sakana with server key; 120s abort.
- Non-stream: JSON `{ ok, text, model, usage }`.
- Stream: SSE events `{ type: 'delta' | 'done' | 'error', ... }`.
- Log usage to `eros_activity_log` (actor `eros-fugu-playground`) best-effort.

### 3) Client service (no secrets)

`src/services/fuguPlaygroundService.ts`:

- Uses `getSupabaseClient().functions.invoke('eros-fugu-playground', { body })` for non-stream.
- For stream: `fetch(`${supabaseUrl}/functions/v1/eros-fugu-playground`, { headers: { Authorization: `Bearer ${anonKey}`, apikey: anonKey }, body })` and parse SSE — still **no** Sakana key on client.

### 4) Hook `src/hooks/useFuguPlayground.ts`

State: `messages`, `isLoading`, `error`, `model`, `reasoningEffort`, `enableWebSearch`, `usage` (last reply), `abortController`.

API: `send(text)`, `setModel`, `setReasoningEffort`, `toggleWebSearch`, `clear`, `stop`.

Enforce UI rule: if model ≠ ultra, clamp effort away from `max`.

### 5) UI `src/components/playground/FuguPlayground.tsx`

- Header: model select, reasoning select, web-search toggle.
- Body: user/assistant bubbles (slate-950/900, cyan accents).
- Loading: “Fugu está orquestrando e pensando…”.
- Footer under assistant: input / output / orchestration tokens (discrete).
- Auto-scroll to last message.

### 6) Route + nav

- `src/App.tsx`: `<Route path="/playground" element={<FuguPlayground />} />` inside `AppLayout`.
- `Sidebar.tsx`: link “Playground” (admin-visible or always with restricted empty state).
- Do **not** change `/chat` behavior.

### 7) Verify

```
npm run build
```

Manual: open `/playground`, send message, confirm Network tab shows only Supabase function URL — never `api.sakana.ai`.

## Out of scope

- Replacing Eros SPIN / Evolution send path.
- Installing browser `openai` package for Sakana.
- Wiring Fugu into `ChatInterface.tsx`.
- Supabase Auth production login (use RoleContext only for now).
