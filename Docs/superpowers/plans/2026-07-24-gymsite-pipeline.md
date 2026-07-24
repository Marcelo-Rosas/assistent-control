# GymSite Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make GymSite - Pipeline Evolution-first WhatsApp on `eros_*`, with real empty states, LLM toggle, Meta no-op unless selected, working theme tokens, safe Sakana `/playground`, and safe `/knowledge` base (persist sources, no fake train).

**Architecture:** Edge Functions own secrets and channel I/O. Frontend talks only to Supabase + Edge (`eros-send-message`, `eros-spin-generate`, `eros-evolution-webhook`, `eros-ai-reply`, `eros-fugu-playground`, `eros-knowledge-query`). Shared Deno modules live under `supabase/functions/_shared/`. Non-secret prefs in `eros_config`; all API keys in Edge Secrets only. CRM `/chat` stays CRM; Fugu lab = `/playground`; RAG/sources UI = `/knowledge`.

**Tech Stack:** Vite/React 18, Tailwind 3 + shadcn (`hsl(var(--…))`), Supabase Postgres + Edge (Deno), Evolution API WhatsApp, LLM via existing `callLlm` (sakana | ollama | gemini | openai) + Sakana Responses API for playground.

**Spec:** `docs/superpowers/specs/2026-07-24-gymsite-pipeline-design.md`  
**Safe Fugu prompt:** `docs/superpowers/prompts/2026-07-24-fugu-playground-safe.md`  
**Safe Knowledge prompt:** `docs/superpowers/prompts/2026-07-24-knowledge-base-safe.md`

## Global Constraints

- Brand copy: **GymSite - Pipeline**; admin **Marcelo Rosas** / **marketing@gymsite.com.br**
- Keep code names `eros_*` and routes `/eros/*`
- `CHANNEL_PROVIDER=evolution` default; Meta no-ops unless `meta`
- `EROS_AUTO_REPLY` default **false**; resolve `eros_config` → env → `false`
- LLM default **sakana**; Edge precedence: `eros_config.llm_provider` → `LLM_PROVIDER` env → `sakana` (**no** request-body provider override in v1)
- Secrets: Edge Secrets / Dashboard only — never `eros_config` / never `VITE_*` keys (**forbid** `VITE_SAKANA_API_KEY` and browser `dangerouslyAllowBrowser`)
- Fugu playground: route `/playground` only — **never** wire Sakana into `ChatInterface` / `/chat`
- Settings v1: UI saves non-secrets to `eros_config` + documents Dashboard secrets (no Management API)
- Theme fix = **option A** (HSL channel vars for Tailwind 3); do not migrate to oklch
- Inbound WhatsApp: sequential awaits + idempotent helpers (no RPC required in v1)
- Normalize: `external_id` = full `remoteJid`; `phone` = digits only; upsert on `(channel, phone)`
- Evolution webhook: require `apikey` header === `EVOLUTION_API_KEY` (or `EVOLUTION_WEBHOOK_SECRET` if set)
- Message idempotency: column `provider_message_id` + unique partial index
- Auto-reply: **text only**; skip audio/image for `eros-ai-reply`
- No commit of `.env.local`
- Verification without new test framework unless task adds `node --test` for pure helpers; always `npm run build` after UI tasks

### Locked residual decisions (from review)

| Topic | Lock |
|-------|------|
| Theme | A — HSL |
| Multi-row write | Sequential + ensure helpers |
| Pipeline unique NULL company | Partial unique on `lead_id` where `company_id IS NULL` |
| `eros-settings` Management API | Deferred; Dashboard docs |
| Body `provider` override | Deferred for Eros SPIN (Auth later); playground may send model/reasoning/web_search in body |
| Fugu UI surface | `/playground` only (safe prompt rewrite) |
| Knowledge UI | `/knowledge` — real persist or honest pending; no fake train/RAG scripts (`docs/superpowers/prompts/2026-07-24-knowledge-base-safe.md`) |
| Spec LLM body override | Plan wins: **no** request-body `provider` for Eros SPIN v1; playground may send model/reasoning only |

---

## File map

| Path | Responsibility |
|------|----------------|
| `src/index.css` | HSL CSS variables for shadcn |
| `supabase/migrations/20260724_gymsite_pipeline.sql` | Unique indexes + `provider_message_id` |
| `supabase/schema.sql` | Keep in sync with migration |
| `supabase/functions/_shared/cors.ts` | CORS JSON helpers |
| `supabase/functions/_shared/supabase.ts` | Service role client |
| `supabase/functions/_shared/channel.ts` | `getChannelProvider()`, guards |
| `supabase/functions/_shared/evolutionClient.ts` | `sendText`, env readers |
| `supabase/functions/_shared/llm.ts` | Moved `callLlm` + `resolveLlmProvider` |
| `supabase/functions/_shared/sakanaResponses.ts` | Responses API + stream helpers for playground |
| `supabase/functions/_shared/stage.ts` | `setLeadStage`, `ensurePipelineRow` |
| `supabase/functions/_shared/whatsappNormalize.ts` | phone/jid helpers |
| `supabase/functions/eros-evolution-webhook/index.ts` | Inbound Evolution |
| `supabase/functions/eros-ai-reply/index.ts` | Optional auto reply |
| `supabase/functions/eros-send-message/index.ts` | Outbound Evolution/Meta |
| `supabase/functions/eros-meta-webhook/index.ts` | Guard + existing Meta |
| `supabase/functions/eros-spin-generate/index.ts` | Use shared llm + resolve |
| `supabase/functions/eros-fugu-playground/index.ts` | Safe Sakana playground (Edge secrets) |
| `src/services/erosService.ts` | No mocks; setup error path |
| `src/services/fuguPlaygroundService.ts` | Invoke Edge only (no Sakana key) |
| `src/hooks/useFuguPlayground.ts` | Playground chat state |
| `src/components/playground/FuguPlayground.tsx` | `/playground` UI |
| `src/components/knowledge/KnowledgeBase.tsx` | `/knowledge` UI (safe, no fake train) |
| `src/services/knowledgeService.ts` | Persist groups/urls/files via Supabase |
| `supabase/functions/eros-knowledge-query/index.ts` | Optional Edge Q&A over knowledge URLs |
| `docs/superpowers/prompts/2026-07-24-knowledge-base-safe.md` | Canonical Knowledge prompt |
| `src/constants/erosMocks.ts` | Delete |
| `src/components/eros/*` | Empty states / setup banner / LLM toggle |
| `src/components/Sidebar.tsx`, `src/constants.ts`, `src/context/RoleContext.tsx` | Brand + Marcelo + Playground nav |
| `src/App.tsx` | Route `/playground` |
| `Plan/EROS_INTEGRATION_GUIDE.md` | Evolution-first alignment |
| `docs/superpowers/prompts/2026-07-24-fugu-playground-safe.md` | Canonical safe Fugu prompt |
| `.env.example` | Document Edge secret names (no values) |

---

### Task 1: Theme CSS — HSL tokens

**Files:**
- Modify: `src/index.css`
- Modify: `tailwind.config.ts` (only if a var still broken after HSL rewrite)
- Verify: `npm run build` + visual spot-check

**Interfaces:**
- Consumes: existing `hsl(var(--background))` mappings in `tailwind.config.ts`
- Produces: `:root` / `.dark` vars as space-separated `H S% L%` (no `oklch(...)`)

- [ ] **Step 1: Rewrite `:root` and `.dark` semantic tokens to HSL channels**

Replace every `oklch(...)` semantic token used by shadcn with HSL components matching current dark slate app look. Keep cyan accents as Tailwind utility classes (`cyan-*`) where already used.

Example shape (adjust exact HSL to match current slate/cyan UI — dark app primary surface ~ slate-950):

```css
@layer base {
  :root {
    --background: 0 0% 100%;
    --foreground: 222.2 84% 4.9%;
    --card: 0 0% 100%;
    --card-foreground: 222.2 84% 4.9%;
    --popover: 0 0% 100%;
    --popover-foreground: 222.2 84% 4.9%;
    --primary: 222.2 47.4% 11.2%;
    --primary-foreground: 210 40% 98%;
    --secondary: 210 40% 96.1%;
    --secondary-foreground: 222.2 47.4% 11.2%;
    --muted: 210 40% 96.1%;
    --muted-foreground: 215.4 16.3% 46.9%;
    --accent: 210 40% 96.1%;
    --accent-foreground: 222.2 47.4% 11.2%;
    --destructive: 0 84.2% 60.2%;
    --destructive-foreground: 210 40% 98%;
    --border: 214.3 31.8% 91.4%;
    --input: 214.3 31.8% 91.4%;
    --ring: 222.2 84% 4.9%;
    --radius: 0.625rem;
    --sidebar-background: 0 0% 98%;
    --sidebar-foreground: 240 5.3% 26.1%;
    --sidebar-primary: 240 5.9% 10%;
    --sidebar-primary-foreground: 0 0% 98%;
    --sidebar-accent: 240 4.8% 95.9%;
    --sidebar-accent-foreground: 240 5.9% 10%;
    --sidebar-border: 220 13% 91%;
    --sidebar-ring: 217.2 91.2% 59.8%;
  }

  .dark {
    --background: 222.2 84% 4.9%;
    --foreground: 210 40% 98%;
    --card: 222.2 47.4% 11.2%;
    --card-foreground: 210 40% 98%;
    --popover: 222.2 47.4% 11.2%;
    --popover-foreground: 210 40% 98%;
    --primary: 210 40% 98%;
    --primary-foreground: 222.2 47.4% 11.2%;
    --secondary: 217.2 32.6% 17.5%;
    --secondary-foreground: 210 40% 98%;
    --muted: 217.2 32.6% 17.5%;
    --muted-foreground: 215 20.2% 65.1%;
    --accent: 217.2 32.6% 17.5%;
    --accent-foreground: 210 40% 98%;
    --destructive: 0 62.8% 30.6%;
    --destructive-foreground: 210 40% 98%;
    --border: 217.2 32.6% 17.5%;
    --input: 217.2 32.6% 17.5%;
    --ring: 212.7 26.8% 83.9%;
    --sidebar-background: 240 5.9% 10%;
    --sidebar-foreground: 240 4.8% 95.9%;
    --sidebar-primary: 224.3 76.3% 48%;
    --sidebar-primary-foreground: 0 0% 100%;
    --sidebar-accent: 240 3.7% 15.9%;
    --sidebar-accent-foreground: 240 4.8% 95.9%;
    --sidebar-border: 240 3.7% 15.9%;
    --sidebar-ring: 217.2 91.2% 59.8%;
  }
}
```

Remove leftover `oklch` chart/sidebar aliases that still feed `hsl(var(--…))`, or stop referencing them.

- [ ] **Step 2: Verify build + token sanity**

Run: `npm run build`  
Expected: exit 0  

In DevTools on a shadcn surface (`border-border`, `bg-background`): computed color must not be invalid.

- [ ] **Step 3: Commit**

```bash
git add src/index.css tailwind.config.ts
git commit -m "fix: align theme CSS vars with Tailwind hsl() tokens"
```

---

### Task 2: Schema migrations (uniques + message idempotency)

**Files:**
- Create: `supabase/migrations/20260724_gymsite_pipeline.sql`
- Modify: `supabase/schema.sql` (mirror indexes + column)

**Interfaces:**
- Produces: indexes/columns webhook + upsert will use

- [ ] **Step 1: Write migration SQL**

```sql
-- GymSite pipeline cycle: upsert safety + config + message idempotency

alter table public.eros_messages
  add column if not exists provider_message_id text null;

create unique index if not exists eros_messages_provider_message_id_uniq
  on public.eros_messages (provider_message_id)
  where provider_message_id is not null;

create unique index if not exists eros_leads_channel_phone_uniq
  on public.eros_leads (channel, phone)
  where phone is not null;

create unique index if not exists eros_leads_channel_external_id_uniq
  on public.eros_leads (channel, external_id)
  where external_id is not null;

create unique index if not exists eros_config_global_key_uniq
  on public.eros_config (key)
  where company_id is null;

create unique index if not exists eros_pipeline_lead_global_uniq
  on public.eros_pipeline (lead_id)
  where company_id is null;
```

- [ ] **Step 2: Mirror into `supabase/schema.sql`**

Add `provider_message_id` to `eros_messages` create table (or alter section) and append the same indexes after existing table defs so fresh installs match.

- [ ] **Step 3: Apply migration**

Prefer Supabase MCP/`supabase db push` / SQL editor on project `gxmaxbjgdrqdcizvdojp` when ACTIVE.  
Expected: indexes created; no error on empty tables.

If duplicates already exist, clean before apply:

```sql
-- inspect only; fix manually if needed
select channel, phone, count(*) from eros_leads where phone is not null group by 1,2 having count(*) > 1;
```

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260724_gymsite_pipeline.sql supabase/schema.sql
git commit -m "feat(db): unique indexes and provider_message_id for Evolution upserts"
```

---

### Task 3: Shared Edge modules (`_shared`)

**Files:**
- Create: `supabase/functions/_shared/cors.ts`
- Create: `supabase/functions/_shared/supabase.ts`
- Create: `supabase/functions/_shared/channel.ts`
- Create: `supabase/functions/_shared/whatsappNormalize.ts`
- Create: `supabase/functions/_shared/evolutionClient.ts`
- Create: `supabase/functions/_shared/stage.ts`
- Create: `supabase/functions/_shared/llm.ts` (move from `eros-spin-generate/shared/llm.ts`, default sakana + resolve)
- Create: `supabase/functions/_shared/whatsappNormalize.test.ts` (node:test portable pure fns only — or Deno.test)
- Modify later tasks to import from `../_shared/...`

**Interfaces:**
- Produces:
  - `getChannelProvider(): 'evolution' | 'meta'`
  - `normalizeWhatsAppJid(remoteJid: string): { external_id: string; phone: string }`
  - `sendEvolutionText(opts: { number: string; text: string }): Promise<{ ok: boolean; raw: unknown }>`
  - `ensurePipelineRow(supabase, leadId: string): Promise<void>`
  - `setLeadStage(supabase, leadId: string, stage: string): Promise<void>`
  - `resolveLlmProvider(supabase): Promise<LlmProvider>`
  - `callLlm(prompt: string, provider?: LlmProvider): Promise<CallLlmResult>`

- [ ] **Step 1: Add pure normalize helper + tiny test**

`whatsappNormalize.ts`:

```ts
export function digitsOnly(input: string): string {
  return input.replace(/\D/g, '');
}

/** remoteJid like 5511999999999@s.whatsapp.net or ...@lid */
export function normalizeWhatsAppJid(remoteJid: string): { external_id: string; phone: string } {
  const external_id = remoteJid.trim();
  const userPart = external_id.split('@')[0] || '';
  const phone = digitsOnly(userPart);
  return { external_id, phone };
}
```

Test with `node --experimental-strip-types --test` **or** Deno:

```ts
import { assertEquals } from 'https://deno.land/std@0.168.0/testing/asserts.ts';
import { normalizeWhatsAppJid } from './whatsappNormalize.ts';

Deno.test('normalize jid', () => {
  const r = normalizeWhatsAppJid('5511987654321@s.whatsapp.net');
  assertEquals(r.phone, '5511987654321');
  assertEquals(r.external_id, '5511987654321@s.whatsapp.net');
});
```

Run: `deno test supabase/functions/_shared/whatsappNormalize.test.ts`  
Expected: PASS

- [ ] **Step 2: Implement `channel.ts`, `cors.ts`, `supabase.ts`, `evolutionClient.ts`, `stage.ts`**

`channel.ts`:

```ts
export type ChannelProvider = 'evolution' | 'meta';

export function getChannelProvider(): ChannelProvider {
  const raw = (Deno.env.get('CHANNEL_PROVIDER') || 'evolution').toLowerCase();
  return raw === 'meta' ? 'meta' : 'evolution';
}

export function ignoredProviderResponse(expected: ChannelProvider) {
  return {
    ok: true,
    ignored: true,
    reason: `CHANNEL_PROVIDER!=${expected}`,
    current: getChannelProvider(),
  };
}
```

`evolutionClient.ts` core:

```ts
export function getEvolutionConfig() {
  const url = Deno.env.get('EVOLUTION_URL');
  const instance = Deno.env.get('EVOLUTION_INSTANCE');
  const apiKey = Deno.env.get('EVOLUTION_API_KEY');
  if (!url || !instance || !apiKey) {
    throw new Error('Missing EVOLUTION_URL, EVOLUTION_INSTANCE, or EVOLUTION_API_KEY');
  }
  return { url: url.replace(/\/$/, ''), instance, apiKey };
}

export async function sendEvolutionText(input: { number: string; text: string }) {
  const { url, instance, apiKey } = getEvolutionConfig();
  const resp = await fetch(`${url}/message/sendText/${instance}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      apikey: apiKey,
    },
    body: JSON.stringify({ number: input.number, text: input.text }),
  });
  const raw = await resp.json().catch(() => ({}));
  return { ok: resp.ok, raw };
}
```

`stage.ts`:

```ts
export async function ensurePipelineRow(supabase: any, leadId: string) {
  const { data } = await supabase.from('eros_pipeline').select('id').eq('lead_id', leadId).maybeSingle();
  if (data?.id) return;
  await supabase.from('eros_pipeline').insert({ lead_id: leadId, stage: 'new', position: 0 });
}

const SHARED = new Set(['new', 'qualifying', 'qualified', 'call', 'proposal', 'converted']);

export async function setLeadStage(supabase: any, leadId: string, stage: string) {
  if (stage === 'discarded') {
    await supabase.from('eros_leads').update({ status: 'discarded' }).eq('id', leadId);
    return;
  }
  if (!SHARED.has(stage)) throw new Error(`invalid_stage:${stage}`);
  await supabase.from('eros_leads').update({ status: stage }).eq('id', leadId);
  await supabase.from('eros_pipeline').upsert(
    { lead_id: leadId, stage, position: 0 },
    { onConflict: 'lead_id' }, // relies on eros_pipeline_lead_global_uniq for company_id null
  );
}
```

Note: if PostgREST `onConflict` needs the unique constraint name on `(lead_id)` only when `company_id` null, prefer select-then-insert/update in `ensurePipelineRow` / `setLeadStage` (already sequential) — **do not invent multi-column conflict targets that do not exist**.

- [ ] **Step 3: Move `llm.ts` to `_shared`; add `resolveLlmProvider`; default sakana**

```ts
export async function resolveLlmProvider(supabase: any): Promise<LlmProvider> {
  const { data } = await supabase
    .from('eros_config')
    .select('value_json')
    .eq('key', 'llm_provider')
    .is('company_id', null)
    .maybeSingle();
  const fromConfig = String(data?.value_json?.provider || data?.value_json || '').toLowerCase();
  const allowed = new Set(['sakana', 'ollama', 'gemini', 'openai']);
  if (allowed.has(fromConfig)) return fromConfig as LlmProvider;
  const fromEnv = (Deno.env.get('LLM_PROVIDER') || 'sakana').toLowerCase();
  const normalized = fromEnv === 'fugu' ? 'sakana' : fromEnv;
  return (allowed.has(normalized) ? normalized : 'sakana') as LlmProvider;
}

export async function callLlm(prompt: string, provider?: LlmProvider): Promise<CallLlmResult> {
  const p = provider || ((Deno.env.get('LLM_PROVIDER') || 'sakana').toLowerCase() as LlmProvider);
  // ... existing switch, use `p`
}
```

Store config value as `{ "provider": "sakana" }` JSON.

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/_shared
git commit -m "feat(edge): add shared channel, Evolution, stage, and LLM helpers"
```

---

### Task 4: Rebrand + admin Marcelo

**Files:**
- Modify: `src/components/Sidebar.tsx`
- Modify: `src/constants.ts` (`MOCK_TEAM` admin row)
- Modify: `src/components/Settings.tsx` (user-facing Viver copy)
- Modify: `src/components/Team.tsx` (domain placeholders)
- Modify: `README.md`
- Modify: `package.json` `name` → `gymsite-pipeline` (optional but recommended)
- Grep: `Viver de IA|viverdeia.com` under `src/` and fix user-facing hits in cycle

**Interfaces:**
- Produces: UI brand string `GymSite - Pipeline`; admin identity Marcelo

- [ ] **Step 1: Grep and replace user-facing brand**

Run: `rg -n "Viver de IA|viverdeia\.com" src README.md`

Update Sidebar brand span + profile email; `MOCK_TEAM[0]` → Marcelo Rosas / marketing@gymsite.com.br; creator/basic emails `@gymsite.com.br`.

- [ ] **Step 2: Build**

Run: `npm run build`  
Expected: exit 0

- [ ] **Step 3: Commit**

```bash
git add src/components/Sidebar.tsx src/constants.ts src/components/Settings.tsx src/components/Team.tsx README.md package.json
git commit -m "chore: rebrand UI to GymSite - Pipeline and set admin Marcelo"
```

---

### Task 5: Remove Eros mocks + setup banner

**Files:**
- Delete: `src/constants/erosMocks.ts`
- Modify: `src/services/erosService.ts`
- Modify: `src/hooks/useEros.ts`
- Modify: `src/components/eros/ErosDashboard.tsx`, `ErosChat.tsx`, `ErosKanban.tsx`, `ErosContacts.tsx` (and others showing `useMock`)

**Interfaces:**
- Consumes: `isSupabaseConfigured`
- Produces: `erosService` always hits Supabase when configured; else throws/`needsSetup`

- [ ] **Step 1: Rewrite `erosService` without mock arrays**

```ts
export const erosService = {
  get configured() {
    return isSupabaseConfigured;
  },

  async listLeads(): Promise<ErosLead[]> {
    if (!isSupabaseConfigured) throw new Error('SUPABASE_NOT_CONFIGURED');
    const supabase = getSupabaseClient();
    const { data, error } = await supabase.from('eros_leads').select('*').order('updated_at', { ascending: false });
    if (error) throw error;
    return data as ErosLead[];
  },
  // same pattern for listConversations, listMessages, listPipeline, sendMessage, spinGenerate
};
```

Remove all `mock.*` branches. Keep Edge invoke for send/spin.

- [ ] **Step 2: Hook + UI empty/setup states**

In `useEros`: expose `needsSetup = !isSupabaseConfigured` instead of `useMock`.  
UI: if `needsSetup` → banner “Configure `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY`”.  
If configured and arrays empty → “Nenhum lead / conversa”.

- [ ] **Step 3: Delete `erosMocks.ts` and fix imports**

Run: `npm run build`  
Expected: exit 0; no reference to `erosMocks`.

- [ ] **Step 4: Commit**

```bash
git add src/services/erosService.ts src/hooks/useEros.ts src/components/eros src/constants/erosMocks.ts
git commit -m "refactor: remove Eros mock data; show setup and empty states"
```

---

### Task 6: LLM toggle UI + Edge resolve wiring

**Files:**
- Modify: `supabase/functions/eros-spin-generate/index.ts`
- Modify: `src/components/eros/ErosLayout.tsx` (or Settings panel in Eros)
- Modify: `src/services/erosService.ts` (optional `setLlmProvider` / `getLlmProvider`)
- Modify: `.env.example`

**Interfaces:**
- Consumes: `resolveLlmProvider`, `callLlm` from `_shared/llm.ts`
- Produces: UI writes `{ provider }` to `eros_config` key `llm_provider` + `localStorage.gymsite_llm_provider`

- [ ] **Step 1: Wire spin-generate to shared resolve**

```ts
import { callLlm, resolveLlmProvider } from '../_shared/llm.ts';
import { getServiceSupabase } from '../_shared/supabase.ts';

const supabase = getServiceSupabase();
const provider = await resolveLlmProvider(supabase);
const result = await callLlm(prompt, provider);
```

Ignore any client-sent `provider` field in v1.

Update system prompt copy: “assistente GymSite / Vectra fitness…”.

- [ ] **Step 2: UI toggle (admin / access_eros)**

Options: `sakana | ollama | gemini | openai`.  
On change:

```ts
localStorage.setItem('gymsite_llm_provider', provider);
await supabase.from('eros_config').upsert(
  { key: 'llm_provider', value_json: { provider }, company_id: null },
  { onConflict: 'key' }, // works with eros_config_global_key_uniq
);
```

On load: fetch `eros_config` first; fallback localStorage; fallback `sakana`.

- [ ] **Step 3: Document secrets in `.env.example`**

```
# Edge secrets (set in Supabase Dashboard — never VITE_)
# CHANNEL_PROVIDER=evolution
# LLM_PROVIDER=sakana
# SAKANA_API_KEY=
# EVOLUTION_URL=
# EVOLUTION_INSTANCE=
# EVOLUTION_API_KEY=
```

- [ ] **Step 4: Build + commit**

```bash
npm run build
git add supabase/functions/eros-spin-generate src/components/eros src/services/erosService.ts .env.example
git commit -m "feat: LLM provider toggle via eros_config with sakana default"
```

---

### Task 7: CHANNEL_PROVIDER guards + Meta no-op

**Files:**
- Modify: `supabase/functions/eros-meta-webhook/index.ts`
- Create/adjust imports to `_shared/channel.ts`, `_shared/cors.ts`, `_shared/supabase.ts`

**Interfaces:**
- Consumes: `getChannelProvider`, `ignoredProviderResponse`

- [ ] **Step 1: Guard at top of Meta webhook POST/GET handlers that mutate**

```ts
import { getChannelProvider, ignoredProviderResponse } from '../_shared/channel.ts';

if (getChannelProvider() !== 'meta') {
  return json(ignoredProviderResponse('meta'), 200);
}
```

Keep verification GET behavior: if not meta, still return 200 ignored (do not leak challenge). Optionally only answer challenge when meta.

- [ ] **Step 2: Commit**

```bash
git add supabase/functions/eros-meta-webhook
git commit -m "fix: no-op Meta webhook unless CHANNEL_PROVIDER=meta"
```

---

### Task 8: `eros-evolution-webhook` inbound

**Files:**
- Create: `supabase/functions/eros-evolution-webhook/index.ts`
- Uses: `_shared/*`

**Interfaces:**
- Consumes: normalize, ensurePipelineRow, getServiceSupabase, channel guard
- Produces: lead + conversation + message + pipeline; optional `EdgeRuntime.waitUntil` → `eros-ai-reply`

- [ ] **Step 1: Implement webhook**

Sketch:

```ts
import { json } from '../_shared/cors.ts';
import { getChannelProvider, ignoredProviderResponse } from '../_shared/channel.ts';
import { getServiceSupabase } from '../_shared/supabase.ts';
import { normalizeWhatsAppJid } from '../_shared/whatsappNormalize.ts';
import { ensurePipelineRow } from '../_shared/stage.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return json({ ok: true }, 200);
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  if (getChannelProvider() !== 'evolution') {
    return json(ignoredProviderResponse('evolution'), 200);
  }

  const secret = Deno.env.get('EVOLUTION_WEBHOOK_SECRET') || Deno.env.get('EVOLUTION_API_KEY');
  const headerKey = req.headers.get('apikey') || req.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
  if (!secret || headerKey !== secret) return json({ error: 'unauthorized' }, 401);

  const payload = await req.json().catch(() => null);
  // Parse Evolution MESSAGES_UPSERT: remoteJid, fromMe, message text/audio, key.id
  // Skip fromMe === true
  // Skip non-text for auto-reply path later; still store audio with message_type=audio

  const supabase = getServiceSupabase();
  const { external_id, phone } = normalizeWhatsAppJid(remoteJid);

  // upsert lead on (channel, phone)
  // upsert conversation
  // insert message with provider_message_id = key.id; ignore duplicate (unique violation → 200 ok)
  // await ensurePipelineRow(supabase, leadId)

  const auto =
    (await readAutoReplyFlag(supabase)) === true; // eros_config → env → false
  if (auto && messageType === 'text' && text) {
    // @ts-ignore EdgeRuntime
    EdgeRuntime.waitUntil(
      supabase.functions.invoke('eros-ai-reply', {
        body: { lead_id, conversation_id, trigger_message_id },
      }),
    );
  }

  return json({ ok: true }, 200);
});
```

Implement `readAutoReplyFlag` inline: read `eros_config` key `eros_auto_reply` `{enabled:boolean}` else `Deno.env.get('EROS_AUTO_REPLY') === 'true'`.

- [ ] **Step 2: Deploy function with `verify_jwt=false`**

Document in guide: Evolution webhook URL  
`https://<project>.supabase.co/functions/v1/eros-evolution-webhook`

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/eros-evolution-webhook
git commit -m "feat: Evolution WhatsApp webhook into eros_* with pipeline ensure"
```

---

### Task 9: Extend `eros-send-message` for Evolution

**Files:**
- Modify: `supabase/functions/eros-send-message/index.ts`

**Interfaces:**
- Consumes: `getChannelProvider`, `sendEvolutionText`
- Produces: same JSON `{ ok, message }` for UI

- [ ] **Step 1: Branch send path**

```ts
const provider = getChannelProvider();

// persist outgoing message first (existing)

if (provider === 'evolution') {
  if (lead.channel !== 'whatsapp') return json({ error: 'unsupported_channel' }, 400);
  const number = lead.phone || digitsOnly(lead.external_id || '');
  if (!number) return json({ error: 'missing_phone' }, 400);
  const result = await sendEvolutionText({ number, text: body.text });
  // update status delivered/failed; update conversation preview
  return json({ ok: result.ok, message: messageRow, evolution: result.raw }, result.ok ? 200 : 502);
}

// existing Meta Graph path when provider === 'meta'
if (!Deno.env.get('META_ACCESS_TOKEN')) return json({ error: 'META_ACCESS_TOKEN not set' }, 503);
// ...
```

When `provider === 'evolution'` and Evolution secrets missing → **503** with clear error.

- [ ] **Step 2: Commit**

```bash
git add supabase/functions/eros-send-message
git commit -m "feat: route eros-send-message through Evolution when CHANNEL_PROVIDER=evolution"
```

---

### Task 10: `eros-ai-reply` + optional stage bump

**Files:**
- Create: `supabase/functions/eros-ai-reply/index.ts`

**Interfaces:**
- Consumes: `resolveLlmProvider`, `callLlm`, `sendEvolutionText`, `setLeadStage` (optional)
- Produces: outgoing message persisted + Evolution send

- [ ] **Step 1: Implement AI reply**

```ts
// load lead + last messages
// if last inbound not text → return { skipped: 'non_text' }
// resolveLlmProvider + callLlm with GymSite SPIN system prompt
// sendEvolutionText
// insert eros_messages outgoing
// optional: if classification hot / score>=80 → setLeadStage(..., 'qualifying')  // keep rules simple; document in code comment
```

- [ ] **Step 2: Commit**

```bash
git add supabase/functions/eros-ai-reply
git commit -m "feat: optional eros-ai-reply via Evolution and shared LLM resolve"
```

---

### Task 11: Settings UI (non-secrets only) + guide

**Files:**
- Modify: `src/components/Settings.tsx` and/or Eros settings section
- Modify: `Plan/EROS_INTEGRATION_GUIDE.md`
- Modify: `.env.example` (already touched; ensure complete)

**Interfaces:**
- Produces: toggles for `llm_provider`, `eros_auto_reply`; read-only checklist for Dashboard secrets

- [ ] **Step 1: Settings panel**

Show:
- LLM select (writes `eros_config`)
- Auto-reply checkbox → `eros_config.eros_auto_reply = { enabled: boolean }`
- Static help: set `EVOLUTION_*`, `CHANNEL_PROVIDER`, LLM keys in Supabase Dashboard Edge Secrets — **no key inputs in UI**

- [ ] **Step 2: Patch integration guide**

Top callout + rewrite webhook/send sections:

```markdown
> **GymSite channel layer:** Evolution-first. See
> `docs/superpowers/specs/2026-07-24-gymsite-pipeline-design.md`
> and `docs/superpowers/plans/2026-07-24-gymsite-pipeline.md`.
> Meta webhooks no-op unless `CHANNEL_PROVIDER=meta`. Mocks removed from Eros UI.
```

Replace Meta-only send instructions with Evolution `sendText` + shared guards.

- [ ] **Step 3: Commit**

```bash
git add src/components/Settings.tsx src/components/eros Plan/EROS_INTEGRATION_GUIDE.md .env.example
git commit -m "docs: Evolution-first GymSite guide; settings for non-secret prefs only"
```

---

### Task 12: Safe Sakana Fugu `/playground` (Edge-only)

**Prompt source (canonical):** `docs/superpowers/prompts/2026-07-24-fugu-playground-safe.md`

**Files:**
- Create: `supabase/functions/_shared/sakanaResponses.ts`
- Create: `supabase/functions/eros-fugu-playground/index.ts`
- Create: `src/services/fuguPlaygroundService.ts`
- Create: `src/hooks/useFuguPlayground.ts`
- Create: `src/components/playground/FuguPlayground.tsx`
- Modify: `src/App.tsx` (add route)
- Modify: `src/components/Sidebar.tsx` (nav link)
- Modify: `.env.example` (Sakana Edge secrets only — reinforce no `VITE_SAKANA_*`)

**Interfaces:**
- Consumes: `_shared/cors.ts`, `_shared/supabase.ts`, Sakana Edge secrets
- Produces:
  - Edge `POST eros-fugu-playground` body `{ messages, model?, reasoning_effort?, web_search?, stream? }`
  - Client hook `useFuguPlayground()` with `send`, `setModel`, `setReasoningEffort`, `toggleWebSearch`, `clear`, `stop`

**Forbidden:**
- `VITE_SAKANA_API_KEY`
- `dangerouslyAllowBrowser: true`
- npm `openai` browser client aimed at Sakana
- Any Sakana wiring inside `src/components/ChatInterface.tsx`

- [ ] **Step 1: Shared Sakana Responses helper**

Create `supabase/functions/_shared/sakanaResponses.ts`:

```ts
export type FuguModel = 'fugu' | 'fugu-ultra' | 'fugu-cyber';
export type ReasoningEffort = 'high' | 'xhigh' | 'max';

export function normalizeFuguModel(raw?: string): FuguModel {
  const v = (raw || 'fugu').toLowerCase();
  if (v === 'fugu-ultra-v1.1' || v === 'fugu-ultra') return 'fugu-ultra';
  if (v === 'fugu-cyber') return 'fugu-cyber';
  return 'fugu';
}

export function assertReasoning(model: FuguModel, effort?: ReasoningEffort): ReasoningEffort {
  const e = effort || 'high';
  if (e === 'max' && model !== 'fugu-ultra') {
    throw new Error('reasoning_effort max requires fugu-ultra');
  }
  return e;
}

export async function sakanaResponses(input: {
  messages: Array<{ role: string; content: string }>;
  model: FuguModel;
  reasoning_effort: ReasoningEffort;
  web_search?: boolean;
  stream?: boolean;
}): Promise<Response> {
  const apiKey = Deno.env.get('SAKANA_API_KEY');
  if (!apiKey) throw new Error('SAKANA_API_KEY not set');
  const base = (Deno.env.get('SAKANA_BASE_URL') || 'https://api.sakana.ai/v1').replace(/\/$/, '');
  const timeoutMs = Number(Deno.env.get('SAKANA_TIMEOUT_MS') || 120_000);
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);

  const body: Record<string, unknown> = {
    model: input.model,
    input: input.messages.map((m) => ({ role: m.role, content: m.content })),
    reasoning: { effort: input.reasoning_effort },
    stream: !!input.stream,
  };
  if (input.web_search) body.tools = [{ type: 'web_search' }];

  try {
    return await fetch(`${base}/responses`, {
      method: 'POST',
      signal: ctrl.signal,
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    });
  } finally {
    clearTimeout(t);
  }
}
```

If Responses payload shape differs from Sakana docs at implement time, adjust field names once — keep timeout/auth/model rules.

- [ ] **Step 2: Edge function `eros-fugu-playground`**

```ts
import { json } from '../_shared/cors.ts';
import { getServiceSupabase } from '../_shared/supabase.ts';
import {
  assertReasoning,
  normalizeFuguModel,
  sakanaResponses,
} from '../_shared/sakanaResponses.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return json({ ok: true }, 200);
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  const body = await req.json().catch(() => null);
  if (!body?.messages?.length) return json({ error: 'invalid_body' }, 400);

  let model;
  let effort;
  try {
    model = normalizeFuguModel(body.model);
    effort = assertReasoning(model, body.reasoning_effort);
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 400);
  }

  // v1 non-stream first (ship stream in same PR if time; otherwise follow-up commit)
  const upstream = await sakanaResponses({
    messages: body.messages,
    model,
    reasoning_effort: effort,
    web_search: !!body.web_search,
    stream: false,
  });
  const raw = await upstream.json().catch(() => ({}));
  if (!upstream.ok) return json({ error: 'sakana_failed', details: raw }, 502);

  const text =
    raw.output_text ||
    raw?.choices?.[0]?.message?.content ||
    JSON.stringify(raw);

  const usage = {
    input_tokens: raw?.usage?.input_tokens ?? null,
    output_tokens: raw?.usage?.output_tokens ?? null,
    orchestration_input_tokens: raw?.usage?.orchestration_input_tokens ?? null,
    orchestration_output_tokens: raw?.usage?.orchestration_output_tokens ?? null,
  };

  try {
    const supabase = getServiceSupabase();
    await supabase.from('eros_activity_log').insert({
      actor: 'eros-fugu-playground',
      action: 'playground_completion',
      entity_type: 'playground',
      entity_id: null,
      meta_json: { model, effort, usage },
    });
  } catch {
    /* ignore */
  }

  return json({ ok: true, text: String(text), model, usage });
});
```

Optional same-task stretch: if `body.stream === true`, pipe SSE; else keep JSON.

- [ ] **Step 3: Client service + hook + UI**

`fuguPlaygroundService.ts` — only `supabase.functions.invoke('eros-fugu-playground', { body })`.

`useFuguPlayground.ts` — messages/loading/error/model/effort/webSearch/usage; clamp `max` when model ≠ ultra.

`FuguPlayground.tsx` — selectors + bubbles + loading copy “Fugu está orquestrando e pensando…” + token footer + auto-scroll. Theme: slate-950/900 + cyan accents (match AppLayout).

Gate: if `currentRole !== 'admin'`, show restricted panel.

- [ ] **Step 4: Route + Sidebar (do not touch ChatInterface LLM)**

In `src/App.tsx` inside `AppLayout` routes:

```tsx
<Route path="/playground" element={<FuguPlayground />} />
```

Sidebar: link label `Playground` → `/playground`.

Leave `/chat` → `ChatInterface` unchanged.

- [ ] **Step 5: Verify**

Run: `npm run build`  
Expected: exit 0  

Manual: Network tab on send must hit `.../functions/v1/eros-fugu-playground` only — never `api.sakana.ai` from browser.

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/_shared/sakanaResponses.ts \
  supabase/functions/eros-fugu-playground \
  src/services/fuguPlaygroundService.ts \
  src/hooks/useFuguPlayground.ts \
  src/components/playground \
  src/App.tsx src/components/Sidebar.tsx .env.example \
  docs/superpowers/prompts/2026-07-24-fugu-playground-safe.md
git commit -m "feat: add Edge-backed Sakana Fugu playground at /playground"
```

---

### Task 13: Knowledge Base `/knowledge` (safe, no fake train)

**Prompt source (canonical):** `docs/superpowers/prompts/2026-07-24-knowledge-base-safe.md`  
**UI inspiration:** pasted KnowledgeBase + Sidebar `knowledge` item — layout keep; behavior rewrite.

**Files:**
- Create: `supabase/migrations/20260724_eros_knowledge.sql` (or append to gymsite migration)
- Modify: `supabase/schema.sql`
- Create: `src/services/knowledgeService.ts`
- Create: `src/components/knowledge/KnowledgeBase.tsx`
- Create (optional v1): `supabase/functions/eros-knowledge-query/index.ts`
- Modify: `src/App.tsx` — `<Route path="/knowledge" element={<KnowledgeBase />} />`
- Modify: `src/components/Sidebar.tsx` — menu item `{ id: 'knowledge', label: 'Base de Conhecimento', icon: Database, permission: 'interact_chat' }`
- Modify: `src/context/RoleContext.tsx` — only if new permission needed (prefer reuse `manage_settings` for mutate)

**Interfaces:**
- Consumes: Supabase client; optional Edge query
- Produces: persisted URL groups; honest `pending|synced|error` statuses; test chat without keyword scripts

**Forbidden:**
- `MOCK_FILES` / fake “100% synced” defaults as production truth
- `setInterval` training console that claims embeddings/Gemini success
- Hardcoded commercial replies (`plano`, `viver de ia`, fake pricing)
- `viverdeia.com` URLs as default GymSite knowledge
- Wiring Knowledge into `/chat` or merging with `/playground`

- [ ] **Step 1: Migration for knowledge tables**

```sql
create table if not exists public.eros_knowledge_groups (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  company_id uuid null,
  name text not null
);

create table if not exists public.eros_knowledge_urls (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  group_id uuid not null references public.eros_knowledge_groups(id) on delete cascade,
  url text not null,
  status text not null default 'pending'
    check (status in ('pending', 'synced', 'error')),
  unique (group_id, url)
);

create table if not exists public.eros_knowledge_files (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  company_id uuid null,
  name text not null,
  size_bytes bigint not null default 0,
  mime text null,
  storage_path text null,
  status text not null default 'pending'
    check (status in ('pending', 'syncing', 'synced', 'error'))
);
```

Mirror into `schema.sql`. Apply when project ACTIVE.

- [ ] **Step 2: `knowledgeService.ts`**

```ts
export const knowledgeService = {
  async listGroups() { /* from eros_knowledge_groups + urls */ },
  async createGroup(name: string) { /* insert */ },
  async deleteGroup(id: string) { /* delete; forbid last group optional */ },
  async addUrl(groupId: string, url: string) {
    if (!/^https?:\/\//i.test(url)) throw new Error('invalid_url');
    /* insert status pending */
  },
  async removeUrl(id: string) { /* delete */ },
  async listFiles() { /* eros_knowledge_files */ },
  async ask(input: { groupId: string; messages: Array<{ role: string; content: string }> }) {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase.functions.invoke('eros-knowledge-query', { body: input });
    if (error) throw error;
    return data as { text: string; provider?: string };
  },
};
```

If Supabase not configured → throw `SUPABASE_NOT_CONFIGURED` (same pattern as Eros).

- [ ] **Step 3: Port UI without mocks**

Create `KnowledgeBase.tsx` from paste:

- Keep two-column layout (ingest | train+chat)
- Default groups: seed **once** optional GymSite docs placeholders (`https://gymsite.com.br/...`) or **empty** — prefer empty + “Nenhum grupo”
- File tab: list from DB; drag-drop may insert metadata-only rows `status=pending` (no fake progress to 100 synced)
- Train button: `disabled` or onClick toast: “Indexação automática v1 ainda não disponível”
- Test chat: call `knowledgeService.ask`; show typing; render Edge text; if Edge missing, show error — **no** if/else pricing scripts
- Copy: GymSite - Pipeline; agents names without “Viver de IA”
- Permissions: mutate only if `hasPermission('manage_settings')`; view/chat if `interact_chat`

- [ ] **Step 4: Edge `eros-knowledge-query` (minimal)**

```ts
// Load URLs for groupId; build system prompt with URL list
// resolveLlmProvider + callLlm (shared)
// Return { text, provider }
// Do not fetch+embed pages in v1 unless timeboxed crawl added — honest: "contexto = lista de URLs cadastradas"
```

- [ ] **Step 5: Route + Sidebar**

`src/App.tsx`:

```tsx
import { KnowledgeBase } from './components/knowledge/KnowledgeBase';
// ...
<Route path="/knowledge" element={<KnowledgeBase />} />
```

Sidebar `menuItems` add after functions (or before settings):

```ts
{ id: 'knowledge', label: 'Base de Conhecimento', icon: Database, permission: 'interact_chat' },
```

Import `Database` from `lucide-react`. Fix active state for nested paths already using `startsWith`.

- [ ] **Step 6: Verify + commit**

Run: `npm run build`  
Expected: exit 0; `/knowledge` loads; add URL survives refresh; train does not lie; chat hits Edge or clear error.

```bash
git add supabase/migrations supabase/schema.sql \
  src/services/knowledgeService.ts \
  src/components/knowledge \
  supabase/functions/eros-knowledge-query \
  src/App.tsx src/components/Sidebar.tsx \
  docs/superpowers/prompts/2026-07-24-knowledge-base-safe.md
git commit -m "feat: add /knowledge base with persisted sources and honest statuses"
```

---

### Task 14: Deploy checklist + end-to-end verify

**Files:** none new (ops)

- [ ] **Step 1: Restore Supabase project if INACTIVE; apply migrations** (pipeline + knowledge)

- [ ] **Step 2: Set Edge Secrets**

`CHANNEL_PROVIDER=evolution`  
`EVOLUTION_URL`  
`EVOLUTION_INSTANCE`  
`EVOLUTION_API_KEY`  
`EROS_AUTO_REPLY=false`  
`LLM_PROVIDER=sakana` (+ provider key)  
`SAKANA_API_KEY` / `SAKANA_BASE_URL` / `SAKANA_TIMEOUT_MS=120000`  
`SUPABASE_SERVICE_ROLE_KEY` / `SUPABASE_URL` (usually auto)

- [ ] **Step 3: Deploy functions**

```bash
supabase functions deploy eros-evolution-webhook --no-verify-jwt
supabase functions deploy eros-send-message
supabase functions deploy eros-spin-generate
supabase functions deploy eros-ai-reply
supabase functions deploy eros-meta-webhook --no-verify-jwt
supabase functions deploy eros-fugu-playground
supabase functions deploy eros-knowledge-query
```

- [ ] **Step 4: Point Evolution webhook; verify WA + playground + knowledge**

Expected:
- Row in `eros_leads` (`channel=whatsapp`, phone digits)
- Conversation + message
- `eros_pipeline` stage `new`
- Appears in `/eros/chat` and Kanban
- Manual send from UI delivers via Evolution
- With `CHANNEL_PROVIDER=evolution`, Meta POST returns `{ignored:true}`
- `/playground` returns Fugu text; browser never calls `api.sakana.ai`
- `/knowledge` persists URLs; no fake train success; ask uses Edge

- [ ] **Step 5: Final commit only if checklist docs updated**

```bash
git add docs/superpowers/plans/2026-07-24-gymsite-pipeline.md
git commit -m "docs: mark GymSite pipeline deploy checklist complete"
```

(Only after real verify; otherwise leave checkboxes open.)

---

## Spec coverage checklist

| Spec item | Task |
|-----------|------|
| Theme oklch/hsl | 1 |
| Schema uniques + config global key | 2 |
| Pipeline ensure / lead unique | 2, 8 |
| Secrets not in eros_config | 3, 11, 12 + Global Constraints |
| Rebrand + Marcelo | 4 |
| Remove mocks | 5 |
| LLM toggle + sakana default | 3, 6 |
| CHANNEL_PROVIDER Meta/Evolution guards | 7, 8, 9 |
| Evolution webhook + Realtime UI | 8, 14 |
| sendText outbound | 9 |
| eros-ai-reply optional | 10 |
| Guide aligned | 11 |
| Safe Fugu `/playground` (no VITE keys) | 12 |
| Safe Knowledge `/knowledge` (no fake train) | 13 |
| Deploy | 14 |
| Message idempotency / webhook auth / text-only auto | 2, 8, 10 (locked here) |

## Placeholder / consistency self-review

- No TBD steps; residual decisions locked in Global Constraints
- Shared module paths consistently `../_shared/...`
- Default LLM `sakana` everywhere
- `setLeadStage` / `ensurePipelineRow` names stable across tasks 3, 8, 10
- Upsert conflict: prefer select/insert when PostgREST partial unique `onConflict` is awkward — documented in Task 3
- Fugu playground never touches `ChatInterface`; secrets never `VITE_*`
- Knowledge never fakes sync/train; never keyword CRM bot; deploy is last task (14)