# Regulatório CONFEF/CREF Refresh Loop

Date: 2026-08-03  
Status: approved (2026-08-03)  
Scope: loop de inteligência contínua só no grupo Regulatório CONFEF/CREF

## Problem

Base Regulatório no Eros (~93 chunks) envelhece: anuidades, resoluções, inscrição PJ/PF e mapa UF→CREF mudam no site CONFEF/CREFs, enquanto ingest hoje é manual (`data/raw/Regulatorio/` + `npm run ingest:regulatorio-curado` / `ingest:law-9696` / `embed:regulatorio`).

Humano não escala “ficar de olho” diário. Consultor GymSite/`knowledge-ask` responde com norma velha → risco operacional e perda de confiança.

## Goals

1. Ciclo automatizado **descobrir → triar → (opcional) raw + ingest + embed → verificar ask**.
2. Ingerir **somente** delta com efeito operacional (taxa, registro, resolução, mapa CREF).
3. Manter grupo leve (anti-padrão Mercado 58k): rejeitar scrap trivial.
4. Humano só em lote **âmbar** + digest semanal.
5. Idempotência via `content_hash` / `(group_id, content_hash)`.

## Non-goals

- Mercado fitness, benchmark, notícia setorial (outro loop).
- Corrigir bugs determinísticos (timeout `match_chunks`, índice, Edge).
- Re-scrape massivo de todos os `.txt` legacy em `data/raw/Regulatorio/`.
- Taxas municipais / prefeitura (`ingest:regulatorio-taxas`) — **fase 2**.
- Auto-merge PR / deploy sem pedido humano.
- Misturar aggregadores (Wellhub/TotalPass/GuruPass) no `REGULATORIO_GROUP_ID`.

## Approach (chosen)

**Scout diário + gate rígido + ingest só se approved**, reusando pipeline existente.

```
Scout (allowlist CONFEF/CREF)
  → Analyst (drop | raw-only | ingest | human-amber)
  → Curator (inbox → canônico → ingest:regulatorio-curado → embed:regulatorio)
  → Verifier (knowledge-ask queries canônicas)
  → Docs/ops/regulatorio-loop-state.md
```

Cadência: Scout+Analyst **1×/dia**; ingest+embed só com ≥1 approved; digest humano **1×/semana**.

## Architecture

### Group / env

| Campo | Valor |
|-------|--------|
| Group | Regulatório CONFEF/CREF |
| UUID | `b7dad505-2d2a-49a9-bbaf-d4b9c4929dea` |
| Env | `REGULATORIO_GROUP_ID` (nunca Wellhub UUID prefix `553fa8d6`) |
| Edge ask | `knowledge-ask` com esse `groupId` |

### Allowlist v1

| Fonte | Uso |
|-------|-----|
| `https://www.confef.org.br/comunicacao/noticias/` | delta notícias → triagem |
| Páginas resolução / legislação CONFEF | obrigação muda |
| Sites CREF por UF (anuidades, inscrição PF/PJ) | alinhado a curados atuais |
| Curados âncora | `regulatorio_anuidades_processo_2026.txt`, `regulatorio_abertura_academia_ref.txt`, `mapa_uf_cref_registro.txt` |

### Temas (`meta.tema` / chunk_type)

- `anuidades_cref` / `anuidades_cref_2026`
- `abertura_academia`
- `mapa_uf_cref`
- `resolucao_confef`
- `inscricao_pf` / `inscricao_pj`

### Gate de ingest

**Ingest se** muda: anuidade/processo CREF; inscrição PF/PJ academia; resolução/enunciado com efeito operacional; mapa UF→CREF / registro secundário.

**Drop:** notícia institucional sem norma; eleição; evento; missão; duplicata hash; SEO genérico.

**Âmbar (humano):** valor R$ novo; obrigação nova ambígua; conflito com chunk vigente.

### Subagents

| Papel | Função | Modelo |
|-------|--------|--------|
| Scout | Listar URLs/novidades vs state (hash URL+título+data) | rápido |
| Analyst | Classificar + justificativa 1 linha | raciocínio |
| Curator | Escrever raw, promover, rodar ingest/embed | execução |
| Verifier | Ask canônico; pass/fail | **≠ Curator** |

### Verifier queries (fixas no state)

1. Qual anuidade/processo CREF 2026?
2. Academia precisa registro CREF PJ?
3. Qual CREF cobre UF X? (X = UF do delta, senão CE/SP)

Pass: HTTP 200 + resposta coerente com ingest do tick (ou “sem mudança” se 0 ingest). Fail → marcar âmbar; **não** re-ingest automático.

### Estado persistente

Arquivo: `Docs/ops/regulatorio-loop-state.md`

Campos mínimos: `last_tick`, `urls_seen` (hash), `decisions[]`, `ingest_count`, `amber[]`, `last_smoke`, `pass_rate_window`.

**Atualização:** CLI `loop:regulatorio-tick` faz patch automático (`--update-state` default). Agente só edita narrativo de âmbar/digest se preciso.

### Skill

`.agents/skills/regulatorio-confef-loop/SKILL.md` — passos obrigatórios, allowlist, gate, proibições.

### Loop wake

Sentinel: `AGENT_LOOP_TICK_regulatorio`. Intervalo sugerido: `1d` (Cursor `/loop` ou cron externo). Wake **não** acoplado a erro de código Edge.

## ROI

| Sem loop | Com loop |
|----------|----------|
| Norma congelada até alguém lembrar | Delta CONFEF/CREF entra com gate |
| Risco resposta desatualizada | Verifier + âmbar em claim forte |
| Trabalho humano contínuo | Humano só âmbar + digest semanal |

## Out of scope forever (neste design)

Heal timeout Mercado; benchmark pricing; scrape TotalPass nacional.

## Open questions (resolvidos na conversa)

- Foco v1: **só Regulatório** (não Mercado no mesmo tick).
- Taxas prefeitura: fase 2.

## Success criteria

- ≥1 tick/dia com Scout+Analyst registrado no state (mesmo com 0 candidatos).
- 0 ingest de scrap trivial (gate documentado no state).
- Após ingest approved: smoke ask 200 nas queries canônicas **ou** âmbar explícito.
- Grupo Regulatório permanece ordem ~10² chunks (não explode para 10⁴+).
