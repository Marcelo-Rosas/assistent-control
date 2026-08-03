---
name: regulatorio-confef-loop
description: >-
  Loop de refresh do grupo Regulatório CONFEF/CREF no Eros: scout allowlist,
  triage (drop/raw/ingest/amber), ingest+embed só se approved, verifier ask.
  Use quando rodar /loop regulatório, atualizar anuidades/resoluções CREF,
  ou alimentar REGULATORIO_GROUP_ID com delta do site CONFEF/CREFs.
---

# Regulatório CONFEF/CREF Refresh Loop

## Quando usar

- Tick `/loop` com sentinel `AGENT_LOOP_TICK_regulatorio`
- Humano pede “atualizar regulatório / CREF / anuidade / resolução CONFEF”
- Digest semanal do lote âmbar

## Quando NÃO usar

- Bug timeout/índice/`match_chunks` (refatoração determinística)
- Mercado fitness, benchmark, notícia setorial
- Ingest agregadores (Wellhub/TotalPass/GuruPass)
- Taxas prefeitura (fase 2 — `ingest:regulatorio-taxas`)

## Pré-requisitos

- `REGULATORIO_GROUP_ID` = `b7dad505-2d2a-49a9-bbaf-d4b9c4929dea` (nunca prefixo Wellhub `553fa8d6`)
- Ler `Docs/ops/regulatorio-loop-state.md` **antes** de qualquer ação
- Spec: `Docs/superpowers/specs/2026-08-03-regulatorio-confef-cref-loop-design.md`

## Passos obrigatórios (ordem)

### 1. Observe (state)

Ler state. Se tick < 20h desde `last_tick` e não há pedido humano: só registrar skip e parar.

### 2. Scout

Allowlist v1:

- `https://www.confef.org.br/comunicacao/noticias/`
- Páginas resolução/legislação CONFEF
- Páginas CREF UF (anuidades, inscrição PF/PJ) alinhadas aos curados

**WAF:** `fetch` headless cai em `/challenge`. Usar:

```powershell
npm run scout:regulatorio-browser -- --tick
```

Ou HTML manual + `--scout-html-file`. Não insistir em `--scout-noticias` se reason=`challenge`.

Para cada candidato: `url_hash` = hash(URL + título + data). Pular se já em `urls_seen` sem mudança.

### 3. Analyst (gate)

Classificar **um** de:

| Decisão | Critério |
|---------|----------|
| `drop` | Sem norma; eleição; evento; missão; SEO; duplicata |
| `raw-only` | Sinal fraco; guardar inbox sem embed |
| `ingest` | Muda anuidade/processo, inscrição PF/PJ, resolução operacional, mapa UF→CREF |
| `human-amber` | Valor R$ novo, obrigação ambígua, conflito com chunk vigente |

**Proibido:** acumular scrap trivial no grupo (manter ~10² chunks).

### 4. Curator (só `ingest` / `raw-only`)

1. Escrever `data/raw/Regulatorio/inbox/YYYY-MM-DD/<slug>.txt` com front matter: `source_url`, `fetched_at`, `tema`, `decision`
2. Se `ingest`: promover para arquivo canônico ou estender lista de `ingest-regulatorio-curado.ts` / doc curado existente
3. Dry-run ingest → `--apply` só se dry-run OK
4. `npm run embed:regulatorio`
5. **Não** usar `WELLHUB_GROUP_ID` / group errado

Comandos âncora:

```bash
npm run ingest:regulatorio-curado
npm run embed:regulatorio
```

### 5. Verifier (≠ Curator)

Queries canônicas (ajustar UF se delta regional):

1. Qual anuidade/processo CREF 2026?
2. Academia precisa registro CREF PJ?
3. Qual CREF cobre UF X?

Pass: HTTP 200 + coerência com delta do tick (ou “sem mudança” se 0 ingest).  
Fail: marcar `amber`; **não** re-ingest automático.

### 6. Persist

Preferir CLI com `--update-state` (default) — patch automático de `last_tick` / `decisions` / `urls_seen`.

Agente só edita state à mão para: texto de `amber[]`, digest semanal, `last_smoke` após verifier.

Digest semanal: resumo âmbar + ingestions; não exigir humano se 0 âmbar e 0 ingest.

## Tabela anti-racionalização

| Pensamento | Realidade |
|------------|-----------|
| “Notícia genérica também enriquece RAG” | Drop — sem obrigação operacional |
| “Vou bump ingest de tudo do inbox” | Só `ingest` approved |
| “Verifier falhou, tento de novo o mesmo texto” | Âmbar; para |
| “Timeout Mercado no mesmo loop” | Fora de escopo |
| “Group errado mas tem embedding” | Abort — checar UUID |

## Saída do tick

Mensagem curta: candidatos vistos / decisões / ingest Y/N / smoke / próximo tick.
