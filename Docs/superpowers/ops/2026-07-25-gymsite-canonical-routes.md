# GymSite — rotas canônicas (repo próprio)

**Produto UI:** GymSite Pipeline (`assistent-control`) — control plane (chat, CRM, knowledge, WA).  
**Produto domínio:** `C:\Users\marce\gymsite` (GymSite Intelligence) — pipeline multi-agente de **viabilidade comercial de pontos para academias** no Brasil (A0→A6: mercado, geo, demografia, concorrência, financeiro, relatório; site: Mercado / Técnico / Arquiteto / Engenheiro / Regulatório).

Não é frete, atendimento logístico genérico nem “onboarding de unidade” solto. Personas e knowledge batem com **expansão / ponto / obra / regulatório / mercado fitness**.

**Não** depende de outro produto/repo comercial. “Remix” aqui = shell UI legado **neste** repo (`/chat`, `/kanban`, …) vs módulo Eros (`/eros/*`).

## Problema

Duas árvores de rota no mesmo app:

| Legado (mock `constants.ts` / `api.ts`) | Eros (Supabase `eros_*` + Edge) |
|----------------------------------------|----------------------------------|
| `/dashboard` | `/eros` |
| `/chat` | `/eros/chat` |
| `/kanban` | `/eros/kanban` |
| `/contacts` | `/eros/contacts` |
| — | `/eros/prospection` |
| — | `/eros/content` |

Sidebar mostra as duas. Produção confunde mock com CRM real.

## Decisão (canônica GymSite)

**Uma árvore só.** Paths sem prefixo `/eros`. Dados = `eros_*` + Edge Evolution/Sakana. Shell legado vira redirect ou some.

| Canônico | Componente fonte | Dados |
|----------|------------------|-------|
| `/` | redirect → `/dashboard` ou `/chat` | — |
| `/dashboard` | lógica de `ErosDashboard` | `eros_leads` / conversations |
| `/chat` | lógica de `ErosChat` | messages + `eros-send-message` / SPIN |
| `/kanban` | `ErosKanban` (drag + select → `setLeadStage`) | `eros_pipeline` |
| `/contacts` | `ErosContacts` (create/update/delete) | `eros_leads` |
| `/prospection` | `ErosProspection` (UI “em breve”) | `eros_prospects` |
| `/content` | `ErosContentQueue` (UI “em breve”) | `eros_content` |
| `/knowledge` | KnowledgeBase GymSite | knowledge tables + Edge |
| `/playground` | FuguPlayground | Edge |
| `/functions` | Functions (trocar mock → persistência real) | TBD table / Edge |
| `/scheduling` | Scheduling (+ Google Agenda) | appointments reais |
| `/settings` | Settings | Edge status / config |
| `/team` | Team | real ou hide |

Redirects temporários: `/eros` → `/dashboard`, `/eros/chat` → `/chat`, etc. Depois remover `ErosLayout` tabs duplicadas.

## Fases (só este repo)

| # | Fase | Status |
|---|------|--------|
| 1 | **Sidebar canônica** — links só paths acima; tirar item “Eros” separado | **feito** (2026-07-25) |
| 2 | **Wire componentes** — `/chat`→ErosChat, `/dashboard`→ErosDashboard, etc. | **feito** |
| 3 | **Matar mocks runtime** — legado fora da nav; mocks só teste | pendente (arquivos ainda no repo, sem rota) |
| 4 | **Aliases** — `Navigate` de `/eros/*` → canônico | **feito** |
| 5 | **CRUD / botões** — kanban move, contacts CUD, prospection/content | **feito** (2026-07-26): move+CRUD; prospection/content = em breve |
| 6 | **Knowledge / Functions / Scheduling** | Knowledge train multi-domínio **feito**; Functions/Scheduling mock |
| 7 | **RLS + Auth** | pendente |

Redirects ativos: `/eros`→`/dashboard`, `/eros/chat`→`/chat`, … LLM bar global em `PipelineLlmBar` (saiu do `ErosLayout`).

## Fases (histórico — texto original)

1. **Sidebar canônica** — links só paths acima; tirar item “Eros” separado.
2. **Wire componentes** — `App.tsx`: `/chat` → `ErosChat` (ou rename sem pasta `eros/`), idem kanban/contacts/dashboard.
3. **Matar mocks runtime** — `ChatInterface`/`Kanban`/`Contacts`/`Dashboard` legado fora da nav; `constants.ts` mocks só em testes ou apagar uso em `api.ts` nas rotas canônicas.
4. **Aliases** — `Navigate` de `/eros/*` → canônico.
5. **CRUD / botões** — kanban move, contacts CUD, prospection/content: implementar ou desabilitar com label “em breve”.
6. **Knowledge / Functions / Scheduling** — evoluir **neste** repo (RAG próprio, blueprints próprios, Google OAuth próprio); sem importar código de outro produto.
7. **RLS + Auth** — antes de multi-tenant público.

## Fora de escopo

- Qualquer referência, port, ou dependência de produto externo.
- Manter `/eros/*` como produto paralelo permanente.

---

## Criador de Conteúdo (papel `creator`)

Papel da matriz em [`src/context/RoleContext.tsx`](../../src/context/RoleContext.tsx): **Criador de Conteúdo**.  
Foco: treinar/operar agentes e conteúdo do **domínio viabilidade de academias** — **sem** mexer em secrets Evolution/Edge nem blueprints de sistema.

### Permissões hoje (matriz)

| Action | Criador | Rota canônica |
|--------|---------|---------------|
| `read_dashboard` | sim | `/dashboard` |
| `interact_chat` | sim | `/chat` |
| `manage_pipeline` | sim | `/kanban` |
| `manage_appointments` | sim | `/scheduling` |
| `access_eros` | sim | (some com canônico) |
| `edit_functions` | **não** | `/functions` — só admin |
| `manage_settings` | **não** | `/settings`, `/playground` admin |
| `manage_team` | **não** | `/team` — só admin |

**Alvo de permissão Knowledge/Content** (ainda não na matriz — adicionar na Fase Auth):

| Action (proposta) | Criador | Admin | Rota |
|-------------------|---------|-------|------|
| `manage_knowledge` | sim | sim | `/knowledge` |
| `manage_content` | sim | sim | `/content` |
| `use_playground` | sim | sim | playground embutido em `/knowledge` ou `/playground` |
| `manage_settings` / secrets | não | sim | `/settings` |

### Como o Criador cria o agente (GymSite)

1. **Perfil / persona** — `/knowledge`: escolhe ou define perfil do domínio GymSite Intelligence (ex. Especialista de Mercado / Viabilidade de Ponto, Responsável Técnico, Arquiteto de Layout, Engenheiro de Obra, Regulatório / Alvarás — alinhados aos agentes site A0–A6 do pipeline).
2. **Contexto** — cadastra grupos + URLs + arquivos (PDF/XLSX/TXT) vinculados ao `selectedAgentId` / perfil.
3. **Capacidades** — se precisa ação externa (WA já via Evolution Edge; outras automações = blueprints em `/functions`). Criador **consulta** o que admin publicou; **não** edita secrets nem cria webhook de infra.
4. **Publicação** — botão **Treinar & Publicar Agente**: ingestão → embeddings → índice RAG → agente “published” (estado em `eros_config` / tabela agente — a implementar).

### Como treina

| Passo | Rota | Comportamento alvo |
|-------|------|--------------------|
| Ingestão URL | `/knowledge` | crawl/fetch → chunks → embeddings |
| Upload arquivo | `/knowledge` | Storage + parse → embeddings |
| Compilar | `/knowledge` | job Edge `eros-knowledge-train` (nome TBD) |
| Calibrar LLM | config não-secreta | `llm_provider` (Sakana default); secrets só admin/`/settings` |

**Hoje:** train = stub toast; query = lista de nomes de URL no prompt. **Fase 6** fecha o gap.

### Como executa

| Modo | Rota | Quem |
|------|------|------|
| Simulação | `/knowledge` playground (ou `/playground`) | Criador testa RAG antes de publicar |
| Produção WA | inbound Evolution → `eros-ai-reply` + base publicada | automático se auto-reply on |
| Humano + SPIN | `/chat` | Criador atende; SPIN usa LLM + contexto |
| Conteúdo social | `/content` | fila aprovar/publicar (Criador) |

### Rotas consumidoras do agente (Criador)

| Rota canônica | Uso do Criador |
|---------------|----------------|
| `/knowledge` | cria, treina, publica, testa |
| `/chat` | atendimento; vê histórico gerado pelo agente |
| `/kanban` | leads qualificados pelo agente / humano |
| `/scheduling` | reuniões que o fluxo de vendas agendou (+ Google Agenda depois) |
| `/content` | fila de posts/criativos do agente de conteúdo |
| `/prospection` | (se habilitado) leads sociais → pipeline |
| `/functions` | **read-only** blueprints publicados pelo admin |
| `/settings` | **bloqueado** — secrets Evolution/Sakana |

### Cadastro / auditoria (alvo)

- URLs, arquivos, parâmetros do agente → DB (`eros_knowledge_*` + perfil agente).
- Toda create/update/delete de knowledge/content → `eros_activity_log` (quem, quando, o quê) — substituir `localStorage` fake de `/functions`.
- Blueprints novos = **só admin** em `/functions`; Criador só consome.

### Gap vs produção agora

| Item | Status |
|------|--------|
| Papel `creator` no simulador | existe |
| Bloqueio settings/functions | parcial (UI) |
| Knowledge CRUD grupos/URL | parcial |
| Treinar & Publicar / RAG | **parcial** — train multi-domínio (GP/TP/regulatório) + teste local; embeddings Embeddings ainda não |
| Matriz `manage_knowledge` | **feito** (admin+creator) |
| Matriz `manage_content` / `use_playground` | **faltando** (content usa `access_eros` por ora) |

### Fases extras (Criador)

8. Matriz: `manage_knowledge`, `manage_content`, `use_playground`; Sidebar filtra por papel.
9. `/content` CUD + Edge gen/publish **ou** hide até pronto.
10. Train pipeline real + playground RAG no mesmo repo.
11. Audit → `eros_activity_log`; limpar audit mock de Functions.
12. Google Agenda em `/scheduling` com `manage_appointments` (Criador pode vincular agenda da conta, não secrets Edge).
