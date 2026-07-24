# Guia de Integração — Eros no assistent-control (Supabase Backend)

> **Arquitetura**: Frontend React (assistent-control) → Supabase direto — **SEM VectraClaw**
> 
> **Supabase URL**: `https://gxmaxbjgdrqdcizvdojp.supabase.co`

---

## 1. Visão Geral da Arquitetura

```
┌─────────────────────────────────────────────────────────────┐
│                    FRONTEND                                 │
│            assistent-control (React + Vite)                 │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────────┐   │
│  │ Dashboard│ │   Chat   │ │  Kanban  │ │ Eros (6 telas)│   │
│  └────┬─────┘ └────┬─────┘ └────┬─────┘ └──────┬───────┘   │
│       └─────────────┴────────────┴────────────────┘           │
│                         │                                   │
│                   useEros.ts (hook)                         │
│                    erosService.ts                           │
│                         │                                   │
│              @supabase/supabase-js                          │
└─────────────────────────┬───────────────────────────────────┘
                          │ REST / Realtime / Edge Functions
                          ▼
┌─────────────────────────────────────────────────────────────┐
│                    SUPABASE (Backend)                       │
│  https://gxmaxbjgdrqdcizvdojp.supabase.co                   │
│                                                             │
│  ┌──────────────┐  ┌──────────────┐  ┌─────────────────┐   │
│  │  PostgreSQL  │  │   Realtime   │  │  Edge Functions │   │
│  │  12 tabelas  │  │  WebSocket   │  │   Deno/TS       │   │
│  │  eros_*      │  │  Live subs   │  │   Meta APIs     │   │
│  └──────────────┘  └──────────────┘  └─────────────────┘   │
│                                                             │
│  ┌──────────────┐  ┌──────────────┐  ┌─────────────────┐   │
│  │    Auth      │  │   Storage    │  │  Cron Jobs      │   │
│  │  JWT/RLS     │  │  Imagens     │  │  Follow-ups     │   │
│  └──────────────┘  └──────────────┘  └─────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

**Sem VectraClaw**. O frontend se comunica **diretamente** com o Supabase via:
- **REST API** (CRUD em todas as tabelas)
- **Realtime** (WebSocket para mensagens instantâneas)
- **Edge Functions** (serverless para chamadas às APIs externas: Meta, WhatsApp, LLM)

---

## 2. Variáveis de Ambiente

Crie um arquivo `.env` na raiz do projeto:

```bash
# Supabase (obrigatório para conectar ao backend real)
VITE_SUPABASE_URL=https://gxmaxbjgdrqdcizvdojp.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbG...  # sua anon key do Supabase

# Modo fallback (quando Supabase não está configurado, usa mocks)
# Se VITE_SUPABASE_ANON_KEY estiver vazio, o sistema opera em modo MOCK
```

**Como obter a chave**: Supabase Dashboard → Project Settings → API → `anon public`

---

## 3. Setup do Supabase

### 3.1 Criar as tabelas

1. Acesse o [SQL Editor do Supabase](https://supabase.com/dashboard/project/gxmaxbjgdrqdcizvdojp/sql/new)
2. Cole o conteúdo do arquivo `supabase/schema.sql`
3. Execute

Isso cria **12 tabelas** + **triggers** + **índices** otimizados.

### 3.2 Habilitar Realtime

Supabase Dashboard → Database → Replication → Realtime:

Adicione estas tabelas para escuta em tempo real:
- `eros_leads`
- `eros_messages`
- `eros_conversations`
- `eros_content`
- `eros_pipeline`

Ou execute no SQL Editor:
```sql
alter table public.eros_leads replica identity full;
alter table public.eros_messages replica identity full;
alter table public.eros_conversations replica identity full;
alter table public.eros_content replica identity full;
alter table public.eros_pipeline replica identity full;
```

### 3.3 Criar Edge Functions

As Edge Functions serverless são necessárias para:

| Edge Function | Função | APIs Externas |
|--------------|--------|---------------|
| `eros-send-message` | Envia DM via Meta API | Meta Graph API |
| `eros-engage` | Executa curtidas/comentários | Meta Graph API |
| `eros-prospect` | Busca e analisa perfis IG | Meta Graph API + scraping |
| `eros-analyze-profile` | Análise de sinais de expansão | Meta Graph API |
| `eros-spin-generate` | Gera resposta SPIN via LLM | OpenAI/Gemini/Anthropic |
| `eros-spin-sequence` | Gera sequência SPIN completa | OpenAI/Gemini/Anthropic |
| `eros-content-gen` | Gera conteúdo (reels/caption) | OpenAI/Gemini/Anthropic |
| `eros-publish` | Publica no Instagram | Meta Content Publishing API |
| `eros-compute-metrics` | Computa métricas do dashboard | PostgreSQL |
| `eros-handoff` | Cria cliente/cotação no vectraclip | Supabase RPC |
| `eros-meta-webhook` | Recebe webhooks da Meta | — |
| `eros-evolution-webhook` | Recebe MESSAGES_UPSERT da Evolution (WhatsApp) | Evolution API |

#### Evolution WhatsApp webhook (GymSite primary)

Point Evolution `MESSAGES_UPSERT` to:

`https://<project-ref>.supabase.co/functions/v1/eros-evolution-webhook`

Example for this project:

`https://gxmaxbjgdrqdcizvdojp.supabase.co/functions/v1/eros-evolution-webhook`

Auth: send header `apikey` equal to `EVOLUTION_WEBHOOK_SECRET` (preferred) or `EVOLUTION_API_KEY`.  
Deploy **without JWT verification** so Evolution can POST directly:

```bash
supabase functions deploy eros-evolution-webhook --no-verify-jwt
```

Requires `CHANNEL_PROVIDER=evolution`. Optional auto-reply: `eros_config.eros_auto_reply` `{ "enabled": true }` or env `EROS_AUTO_REPLY=true` (text only → `eros-ai-reply`).

#### Exemplo: Criar Edge Function
```bash
# Instalar Supabase CLI
npm install -g supabase

# Login
supabase login

# Linkar projeto
supabase link --project-ref gxmaxbjgdrqdcizvdojp

# Criar function
supabase functions new eros-send-message

# Deploy
supabase functions deploy eros-send-message
```

Template de Edge Function (`supabase/functions/eros-send-message/index.ts`):
```typescript
import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

serve(async (req) => {
  const { lead_id, message, channel } = await req.json();
  
  // Busca token de acesso da Meta no secrets do Supabase
  const metaToken = Deno.env.get('META_ACCESS_TOKEN');
  
  // Envia mensagem via Meta Graph API
  const response = await fetch(
    `https://graph.facebook.com/v18.0/me/messages?access_token=${metaToken}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        recipient: { id: lead_id },
        message: { text: message },
      }),
    }
  );
  
  return new Response(JSON.stringify(await response.json()), {
    headers: { 'Content-Type': 'application/json' },
  });
});
```

### 3.4 Secrets necessários

Supabase Dashboard → Project Settings → Edge Functions → Secrets:

```
META_ACCESS_TOKEN     = <token da Meta Graph API>
META_APP_ID           = 699996529141137
META_APP_SECRET       = <app secret>
WHATSAPP_TOKEN        = <token do WhatsApp Business API>
OPENAI_API_KEY        = <para geração SPIN/conteúdo>
GEMINI_API_KEY        = <alternativa>
```

---

## 4. Estrutura do Projeto (Frontend)

```
assistent-control-eros/
├── index.html                    # Entry HTML
├── index.tsx                     # Entry React
├── package.json                  # Dependências (+ @supabase/supabase-js)
├── vite.config.ts                # Config Vite
├── tailwind.config.ts            # Config Tailwind
├── tsconfig.json                 # Config TypeScript
├── EROS_INTEGRATION_GUIDE.md     # Este documento
│
├── supabase/
│   └── schema.sql                # Schema completo das 12 tabelas
│
└── src/
    ├── App.tsx                   # Router + Layouts + Rotas Eros
    ├── types.ts                  # Tipos TypeScript (originais + Eros)
    ├── constants.ts              # Dados mock (dev sem backend)
    │
    ├── components/
    │   ├── Sidebar.tsx           # + item Eros destacado
    │   ├── Dashboard.tsx         # Original
    │   ├── ChatInterface.tsx     # Original
    │   ├── Contacts.tsx          # Original
    │   ├── Kanban.tsx            # Original
    │   ├── Scheduling.tsx        # Original
    │   ├── Team.tsx              # Original
    │   ├── Functions.tsx         # Original
    │   ├── Settings.tsx          # Original
    │   ├── MeetingRoom.tsx       # Original
    │   └── eros/
    │       ├── index.ts          # Barrel export
    │       ├── ErosDashboard.tsx
    │       ├── ErosKanban.tsx
    │       ├── ErosChat.tsx
    │       ├── ErosContacts.tsx
    │       ├── ErosProspection.tsx
    │       └── ErosContentQueue.tsx
    │
    ├── hooks/
    │   └── useEros.ts            # Estado + Supabase sync
    │
    └── services/
        ├── api.ts                # API service original
        ├── supabaseClient.ts     # Cliente Supabase
        ├── database.types.ts     # Tipos do schema Supabase
        └── erosService.ts        # CRUD + Realtime + Edge Functions
```

---

## 5. Serviços (supabase/services/)

### 5.1 supabaseClient.ts
Cliente Supabase singleton com Realtime configurado.

### 5.2 erosService.ts
**12 serviços modulares** que cobrem toda a operação do Eros:

| Serviço | Tabela | Operações |
|---------|--------|-----------|
| `leadService` | `eros_leads` | CRUD, qualificar, descartar, score |
| `messageService` | `eros_messages` + `eros_conversations` | Enviar DM, listar, SPIN |
| `engagementService` | `eros_engagement` | Curtidas, comentários, sequência |
| `prospectionService` | `eros_prospects` | Busca, análise de perfis |
| `cadenciaService` | `eros_cadencia` | Agendar, pausar, retomar follow-ups |
| `contentService` | `eros_content` | Gerar, aprovar, rejeitar, publicar |
| `pipelineService` | `eros_pipeline` | Kanban, mover cards |
| `metricsService` | `eros_metrics_cache` | Dashboard metrics |
| `configService` | `eros_config` | Configurações do agente |
| `realtimeService` | — | WebSocket subscriptions |
| `handoffService` | — | Integração vectraclip |
| `activityService` | `eros_activity_log` | Audit log |

### 5.3 Modo Dual: Mock ↔ Supabase
O sistema detecta automaticamente se `VITE_SUPABASE_ANON_KEY` está configurado:

- **Com chave** → opera em modo Supabase real (todas as chamadas vão para o backend)
- **Sem chave** → opera em modo MOCK (dados locais, útil para desenvolvimento)

---

## 6. Componentes Eros (6 telas)

### 6.1 ErosDashboard (`/eros`)
Métricas em tempo real, gráfico de prospecção, leads HOT pendentes, atividade do dia.

### 6.2 ErosKanban (`/eros/kanban`)
Pipeline visual com 6 colunas: Novo → Qualificando → Qualificado → Call → Proposta → Convertido.

### 6.3 ErosChat (`/eros/chat`)
Conversas IG/WA com SPIN Selling, badge de fase em cada mensagem, sugestão de resposta via LLM.

### 6.4 ErosContacts (`/eros/contacts`)
Lista de leads com filtros (HOT/MORNO/FRIO), busca, sidebar de detalhes completo.

### 6.5 ErosProspection (`/eros/prospection`)
Busca de perfis Instagram, análise de expansão, sequência de engajamento em 4 toques.

### 6.6 ErosContentQueue (`/eros/content`)
Fila de aprovação de conteúdo: gerado → aprovado → publicado.

---

## 7. Hook useEros

Gerencia estado local + sincronização com Supabase:

```typescript
const {
  // Estado
  leads, conversations, contents, metrics, pipeline, activity,
  isLoading, isRealtimeConnected, selectedConversation,
  unreadMessages, useMock, error,

  // Derived
  hotLeads, leadsRequiringAction, leadsByChannel, leadsByClassification,

  // Ações
  selectConversation, sendMessage, qualifyLead, discardLead,
  approveContent, rejectContent, publishContent,
  startProspection, sendEngagementTouch, movePipelineItem,
  updateConfig, toggleChannel,
} = useEros();
```

---

## 8. Rotas

| Rota | Componente | Descrição |
|------|------------|-----------|
| `/dashboard` | Dashboard | Original |
| `/kanban` | Kanban | Original |
| `/chat` | ChatInterface | Original |
| `/contacts` | Contacts | Original |
| `/scheduling` | Scheduling | Original |
| `/team` | Team | Original |
| `/functions` | Functions | Original |
| `/settings` | Settings | Original |
| `/eros` | ErosDashboard | Dashboard do Eros |
| `/eros/kanban` | ErosKanban | Pipeline social |
| `/eros/chat` | ErosChat | Conversas IG/WA |
| `/eros/contacts` | ErosContacts | Leads sociais |
| `/eros/prospection` | ErosProspection | Prospecção ativa |
| `/eros/content` | ErosContentQueue | Fila de conteúdo |

---

## 9. Design System — Eros

| Elemento | Valor |
|----------|-------|
| Ícone | Heart (coração) |
| Cor primária | `from-pink-500 to-purple-500` |
| Cor HOT | `#f97316` (laranja) |
| Cor MORNO | `#eab308` (amarelo) |
| Cor FRIO | `#3b82f6` (azul) |
| Instagram | `#e4405f` (rosa) |
| WhatsApp | `#25d366` (verde) |

---

## 10. Checklist de Deploy

### 10.1 Supabase (Backend)
- [ ] Executar `supabase/schema.sql` no SQL Editor
- [ ] Habilitar Realtime nas 5 tabelas principais
- [ ] Criar Edge Functions (lista na seção 3.3)
- [ ] Configurar Secrets (Meta, WhatsApp, LLM)
- [ ] Configurar RLS (Row Level Security) se necessário
- [ ] Configurar Cron jobs para follow-ups automáticos

### 10.2a Evolution (WhatsApp — primary)
- [ ] Secrets: `CHANNEL_PROVIDER=evolution`, `EVOLUTION_URL`, `EVOLUTION_INSTANCE`, `EVOLUTION_API_KEY` (and optional `EVOLUTION_WEBHOOK_SECRET`)
- [ ] Deploy: `supabase functions deploy eros-evolution-webhook --no-verify-jwt`
- [ ] Evolution webhook URL → `https://<project-ref>.supabase.co/functions/v1/eros-evolution-webhook`
- [ ] Header `apikey` = webhook secret / API key

### 10.2 Meta (Instagram/WhatsApp)
- [ ] App aprovado: `699996529141137`
- [ ] `instagram_manage_messages` (Advanced Access)
- [ ] `instagram_content_publish` (Advanced Access)
- [ ] Configurar webhook apontando para `eros-meta-webhook` Edge Function (only when `CHANNEL_PROVIDER=meta`)

### 10.3 Frontend
- [ ] Configurar `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY` no `.env`
- [ ] `npm install` (instala `@supabase/supabase-js`)
- [ ] `npm run build`
- [ ] Deploy no Google AI Studio / Vercel / Cloudflare Pages

---

## 11. Tabelas Supabase

| # | Tabela | Propósito |
|---|--------|-----------|
| 1 | `eros_leads` | Leads sociais capturados |
| 2 | `eros_messages` | Mensagens de conversa (DM) |
| 3 | `eros_conversations` | Threads de conversa |
| 4 | `eros_content` | Peças de conteúdo geradas |
| 5 | `eros_prospects` | Prospects detectados (pré-lead) |
| 6 | `eros_engagement` | Toques de engajamento |
| 7 | `eros_cadencia` | Agendamentos de follow-up |
| 8 | `eros_pipeline` | Itens do Kanban |
| 9 | `eros_config` | Configuração do agente |
| 10 | `eros_metrics_cache` | Cache de métricas |
| 11 | `eros_activity_log` | Log de ações |

---

## 12. Edge Functions (Serverless)

Todas as Edge Functions são **stateless** e rodam no Deno:

```
supabase/functions/
├── eros-send-message/      # Envia DM via Meta API
├── eros-engage/            # Executa curtida/comentário
├── eros-engage-sequence/   # Sequência completa 3 toques
├── eros-prospect/          # Busca e análise de perfis
├── eros-analyze-profile/   # Análise de sinais de expansão
├── eros-spin-generate/     # Gera resposta SPIN via LLM
├── eros-spin-sequence/     # Gera sequência SPIN
├── eros-content-gen/       # Gera conteúdo via LLM
├── eros-publish/           # Publica no Instagram
├── eros-compute-metrics/   # Computa métricas (cron)
├── eros-handoff/           # Cria cliente no vectraclip
├── eros-meta-webhook/      # Recebe webhooks da Meta
└── eros-evolution-webhook/ # Recebe MESSAGES_UPSERT (Evolution WhatsApp)
```

---

**Autor**: Marcelo Rosas — Vectra Cargo  
**Backend**: Supabase (sem VectraClaw)  
**URL**: https://gxmaxbjgdrqdcizvdojp.supabase.co
