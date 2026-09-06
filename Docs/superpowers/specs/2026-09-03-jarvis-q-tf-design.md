# JARVIS-Q — Q&A cognitivo TensorFlow (regras / rede / híbrido / RAG)

Date: 2026-09-03  
Status: **aprovado** (2026-09-03); **contrato corrigido** (2026-09-06)  
Scope: **Q&A local** — CLI Python + playbook HTML + KG toy (TF) + **censo/RAG** via PostgREST + Ollama local quando a pergunta é penetração/cobertura ou fallback semântico. Desktop (voz/STT) e mobile ficam specs depois.  
Repo: `assistent-control` (nome canônico do diretório/git; não “assistant-control”).

## Problem

Curso [Jarvis! / JARVIS Academy](https://drive.google.com/drive/folders/11lh62OS2aBncITs45DyPhwLgP8JhiA4Z) e o prompt em `Downloads\jarvis` tratam **Claude + AIOS + n8n** como cérebro. O produto que queremos é o contrário: **TensorFlow raciocina** (grafo + regras + hops) onde o grafo decide; **RAG/PostgREST** responde censo de mercado por bairro; texto só entra e sai. Já existe motor em `notebooks/reasoning_neuron_viabilidade.py` e porta `ask()` em `scripts/jarvis_qa.py`.

**Segredo (colar aqui):** proibido gravar GitHub PAT / comando do curso / material Drive com token em código, git ou logs. Ver também § Segredos operacionais.

## Decisions (brainstorm 2026-09-03)

| Tema | Escolha |
|------|---------|
| Nome | **JARVIS-Q** (núcleo). Não clonar `gaahzx/jarvis-app`. |
| Ordem de produto | Q&A → desktop (STT/TTS) → mobile. Este spec = Q&A (+ voz opcional no HUD local; addendum voz separado). |
| Arquitetura | Abordagem **1**: embrulhar neurônio existente + router. Não IBM LNN do zero. Não Leon/LLM como cérebro. |
| Claude/AIOS no v1 | **Não.** Papel do Claude vira router determinístico. Papel do AIOS = **contexto por turno** no `AskResult` (stateless server), não sessão global. |
| Voz | Fora do contrato cognitivo v1. Smoke TTS existe (ElevenLabs / Antonio / Daniel) — addendum de voz à parte. |
| Segredo | **Proibido** PAT do curso; env só em `.env` / `.env.local` (gitignored). |

## Contract

`ask(texto: str, *, contexto: dict | None = None) -> AskResult`

```text
AskResult
  resposta: str          # PT-BR, humano
  fala: str              # mesma frase normalizada p/ TTS (pode ser "")
  modo: enum             # regra | rede | hibrido | regra_fallback | rag
  porque: str            # uma frase: por que este modo (+ flags textuais)
  fontes: list[str]      # ids tipados — ver § Fontes
  contexto: dict         # ver § Contexto; cliente devolve no turno seguinte
```

Um turno = **um** `modo`. Híbrido pode citar score da rede **e** nome da regra no `porque`/`fontes`. Não mistura três narrativas TF + RAG no mesmo `modo`.

Campo `conflito` / `confianca` **não** existem no v1: conflito híbrido vai em `porque` (`…; conflito`). API rica = spec depois.

### Fontes (formato locked)

| Prefixo | Significado | Exemplos |
|---------|-------------|----------|
| `playbook:#fN` | seção HTML | `playbook:#f13` |
| `kg:triple` | fato / caminho KG | `kg:triple` |
| `rule:nome` | RuleBank | `rule:bairro_bh_herda_renda` |
| `report:entidade` | `ViabilityReasoner.report()` | `report:bairro:savassi` |
| `rag:penetracao` | censo distinct bairro×grupo | sempre com counts |
| `bairro:slug` | bairro normalizado kebab | `bairro:paraiso` |
| `cidade:Nome` | escopo cidade | `cidade:São Paulo` |
| `geo:…` | escopo geo | `geo:cidade`, `geo:ambiguidade` |
| `tp:N` / `wh:N` / `gp:N` / `receita:N` | counts distinct | `wh:25` |
| `chunk:id` | chunk semântico (fallback RAG) | + `sim:0.84` + `grupo:nome` |

Recusa `sem_match`: `fontes=[]`.

### Contexto (ex-AIOS, v1)

Server **stateless**. Persistência = cliente ecoa `AskResult.contexto` no próximo `ask(..., contexto=…)`.

```text
contexto = { entidade: str | null, oferta: str | null }
# oferta exemplos: "cruzar" (renda/aluguel após penetração ou viabilidade)
```

Sem arquivo de sessão global. Sem misturar clientes.

## Components

| Peça | Função | Fonte |
|------|--------|-------|
| Router | intent + entidades + precedência RAG/TF | `scripts/jarvis_qa.py` |
| Regras (playbook) | abas TensorBoard 01–15 | `public/playbook-tensorboard.html` |
| Regras (KG) | `KnowledgeGraph.is_known` | `reasoning_neuron_viabilidade.py` |
| Rede (relação) | `TripleScorer` | mesmo arquivo |
| Rede (viabilidade) | `ViabilityReasoner.report()` | mesmo arquivo |
| Híbrido | `RuleBank` + t-norm | mesmo arquivo |
| RAG penetração | distinct PostgREST por `group_id` + bairro | `scripts/jarvis_rag.py` |
| RAG semântico | `match_chunks` + Ollama embed (fallback) | mesmo |
| CLI | `python scripts/jarvis_qa.py "…"` (JSON stdout) | sem wrapper `npx` |

### Constantes v1 (centralizado)

| Constante | Valor | Uso |
|-----------|-------|-----|
| `VIAB_ALTA` | 0.66 | `rotulo=alta`; só então afirmar “viável” |
| `VIAB_MEDIA` | 0.40 | `rotulo=media` |
| `INFER_THRESHOLD` | 0.7 | tripla inferida (`TripleScorer`) entra na prosa só se ≥ |
| Embedding RAG | 1024 | `mxbai-embed-large` via Ollama nativo |

### Intent

```text
intent ∈ {
  penetracao,      # cobertura/censo bairro × TP|WH|GP|Receita
  playbook_aba,    # FAQ TensorBoard (após match)
  viabilidade,
  relacao_kg,
  lixo
}
```

`penetracao` quando `looks_like_penetracao(texto)` (agregador/cobertura/quantas + bairro ou contagem) — **antes** de parse KG.

### Playbook matcher (locked)

1. Normalizar NFKC + casefold.
2. Se query contém `projector` → seção cujo título casefold == `projector` (`#f13`).
3. Senão: título da seção (len ≥ 4) é **substring** da query, ou query (len ≥ 4) substring do título.
4. **Proibido:** match por primeiro token (`PR` ⊂ `Projector`).
5. Sem fuzzy edit-distance no v1.

### Roteamento (ordem fixa, sem LLM)

`tf_ok` = import Keras/TF **e** `data/jarvis/kg-toy.json` carrega **e** `ViabilityReasoner` instancia. Se TF importa mas fixture some/corrupto → **não** é `regra_fallback` de playbook genérico: recusa controlada `porque=kg_toy_indisponivel` (`modo=regra`, `fontes=[]`) para intents que precisam do grafo.

0. **Intent `penetracao`** (ou `looks_like_penetracao`) → caminho RAG-first (§ Addendum RAG). **Não** cai no toy Savassi/Projector. `modo=rag`. Independe de `tf_ok`.
1. Parse restante: intent ∈ {playbook_aba, viabilidade, relacao_kg, lixo} + entidades do `entity2id`.
2. **Se `not tf_ok`:** playbook casa (FAQ factual) → `regra_fallback`. Senão → recusa `sem_match` (exceto se passo 0 já respondeu).
3. **Playbook factual puro** → `regra`: matcher hit **e** a query **não** pede grounding de `Rule` (sem `herda`+`renda` / nome de regra / caminho body⇒head) **e** não é `viabilidade`/`relacao_kg` com entidades.
4. Há `Rule` cujo `body` casa o caminho pedido → `hibrido` (**vence** empate com playbook do passo 3 e com rede do passo 5).
5. Entidades no KG: `viabilidade` → `rede` via `report()`; `relacao_kg` → `rede` via `TripleScorer`.
6. Fallback RAG semântico (`match_chunks`) se grafo/playbook falharam → `modo=rag`, fontes `chunk:` / `sim:` / `grupo:`.
7. Nada → recusa: `modo=regra`, `fontes=[]`, `porque=sem_match` — **sem** pitch demo toy (Projector / Savassi viável / herda renda).

`regra_fallback` **só** no passo 2 (`not tf_ok` + playbook factual). Com TF no ar, playbook = `regra`.

**Empates**

| A vs B | Vence |
|--------|-------|
| 0 (penetração) vs qualquer TF | RAG penetração |
| 3 (playbook factual) vs 4 (Rule) | **híbrido (4)** se body grounding |
| 4 vs 5 | **híbrido** se grounding; senão rede |

### Clarificação geo vs recusa KG (um tom)

| Situação | `modo` | Comportamento |
|----------|--------|---------------|
| Bairro ambíguo sem cidade (lista locked: centro, paraíso, …) | `rag` | Pedir cidade; `fontes` incl. `geo:ambiguidade` |
| Entidade pedida fora do KG toy (viabilidade/relação) | `regra` | Recusa + exemplo de entidade **que existe no fixture**; sem misturar pitch de penetração |
| Counts 0 com bairro+cidade válidos | `rag` | Explicar gap / sem cobertura indexada; opcional oferecer outro bairro |

## Data

- Playbook: seções `f1`–`f15`. Canônico = `public/playbook-tensorboard.html`.
- KG v1: `data/jarvis/kg-toy.json` (obrigatório no boot do reasoner).
- Viabilidade / inferência: ver § Constantes v1.
- Híbrido: `body > head` → anexar `conflito` em `porque`; ainda responde.

## Errors

- Aba TensorBoard inexistente: listar nomes 01–15; não inventar.
- Sem log de tokens; sem HTTP para GitHub do curso.

## Segredos operacionais

| Segredo / config | Onde | Git? |
|------------------|------|------|
| GitHub PAT / comando Academy | **nunca** | não |
| `SUPABASE_*` / service role / PostgREST URL | `.env.local` | não |
| `*_GROUP_ID` | `.env.local` | não (UUIDs de workspace) |
| `JARVIS_OLLAMA_URL` / `OLLAMA_EMBED_URL` | `.env.local` (default localhost) | URL local ok documentar; sem credencial |
| `ELEVENLABS_API_KEY` | `.env.local` | não |

## Tests (smoke)

Arquivo: `scripts/jarvis_qa_test.py` (pytest; motor TF/Keras). **Sem** `npx` / TS para o núcleo.

**TF / playbook**

1. “o que é Projector?” + TF ok → `modo=regra`, `playbook:#f13`
2. Viabilidade entidade toy → `modo=rede`, `report:…`, `rotulo` em `porque`
3. Caminho `Rule` toy → `modo=hibrido`, `rule:…`
4. “asdf qwerty” → `porque=sem_match`, sem pitch toy
5. TF off + Projector → `regra_fallback`; TF off + viabilidade → `sem_match`

**Addendum RAG (obrigatório)**

6. Penetração bairro+cidade com counts > 0 → `modo=rag`, `rag:penetracao`, `tp:`/`wh:`/`gp:`/`receita:`
7. Bairro ambíguo sem cidade → `modo=rag`, `geo:ambiguidade`, pede cidade
8. `mesmo_escopo` e max(TP,WH,GP) > Receita → prosa **sem** % de mercado
9. `mesmo_escopo` e Receita ≥ max e WH>0 → pode narrar % WH; TF off **não** desliga penetração RAG

TTS/STT **não** no CI (testes ElevenLabs marcam skip sem chave).

## Out of scope (este spec)

- Clone/install JARVIS Academy, Obsidian, n8n.
- App mobile; Whisper STT produção.
- IBM LNN no lugar do `ReasoningNeuron`.
- União CNPJ Receita∪agregadores como denom (meta agregador tipicamente sem CNPJ).
- Campos estruturados `conflito`/`confianca` no JSON.

## Later

- Desktop: STT Whisper; TTS — addendum voz (ElevenLabs-first).
- Mobile: cliente HTTP no mesmo `ask()`.
- KG real (renda IBGE / bairro vivo) — spec próprio; toy permanece demo determinística.

## Addendum — RAG-first penetração (bairro × agregadores)

Date: 2026-09-03  
Status: **locked** (produto); contrato alinhado em 2026-09-06 (§ Contract / Roteamento passo 0)

### Papéis dos `*_GROUP_ID`

| Grupo | Papel |
|-------|--------|
| `RECEITA_GROUP_ID` | **Universo** academias abertas (CNAE/RFB). Denominador quando disponível. |
| `TOTALPASS` / `WELLHUB` / `GURUPASS` | **Cobertura** do agregador. Numerador. |
| `MERCADO` | Contexto; **não** no censo. |

### Acceptance (v1 — não silenciar gap)

| Cenário | Comportamento aceito |
|---------|----------------------|
| Pinheiros SP **com** `backfill-tp-bairro-normalizado` aplicado | TP count > 0 esperado no smoke de penetração |
| TP/GP/Receita meta ausente / parcial | `modo=rag`, counts podem ser 0; `porque` marca gap; prosa explica “sem cobertura indexada” / “universo parcial” — **não** é bug de router |
| max(agregadores) > Receita no mesmo escopo | counts crus; **proibido** % de mercado |

Ops de backfill (GP/TP/Receita) permanecem na § Contagem abaixo; acceptance acima define o que o produto pode devolver.

### Contagem

- `match_chunks` top-k ≠ censo.
- Censo: PostgREST `eros_knowledge_chunks` por `group_id` + `meta->>bairro_normalizado` (+ cidade), distinct (`cnpj` / `gym_id` / `nome_academia` / `source_ref`).
- Normalização: slug kebab **e** UPPER+espaço; cidade canônica + variantes.
- Geo: ambíguo sem cidade → pedir cidade (passo clarificação).
- Embeddings: Ollama nativo (`JARVIS_OLLAMA_URL`), dim 1024; nunca `.../v1` OpenAI-compat.
- Backfills: GP / TP / Receita como já documentado (scripts `backfill-*-bairro-normalizado`, `ingest:receita`, `embed:receita`).

### Narrativa + denom %

| Condição | Comportamento |
|----------|----------------|
| `mesmo_escopo` e Receita ≥ max(TP,WH,GP) e WH>0 | Pode narrar WH % do universo Receita |
| `mesmo_escopo` e max > Receita | Sem %; prosa universo parcial |
| Sem cidade / nacional | % omitida |
| Receita = 0 | % omitida |

Após counts > 0: oferta leve de cruzar renda/aluguel no grafo (TF como **meio**).

## Addendum — correção de contrato (2026-09-06)

Fecha os furos da revisão:

| # | Furo | Resolução neste doc |
|---|------|---------------------|
| 1 | `modo` sem RAG | enum + `rag`; fontes tipadas |
| 2 | intent sem penetração | `penetracao` + passo 0 |
| 3 | playbook engole híbrido | “factual puro” vs Rule; 4 vence 3 |
| 4 | matcher indefinido | § Playbook matcher |
| 5 | fontes RAG | tabela § Fontes |
| 6 | backfill silencioso | § Acceptance |
| 7 | `tf_ok` raso | fixture obrigatório; `kg_toy_indisponivel` |
| 8 | dois tons de recusa | tabela clarificação geo vs KG |
| 9 | segredos incompletos | § Segredos operacionais |
| 10 | smokes só TF | casos 6–9 |
| 11 | estado JSON sumiu | § Contexto |
| 12 | `npx` orphan | CLI só Python |
| 13 | conflito só prosa | explícito v1 |
| 14 | thresholds | § Constantes v1 |
| 15 | scope mentia | Scope atualizado |
| 16–18 | Drive / typo repo / Slack | nota Problem; repo canônico; Slack irrelevante |

## Self-review

- Enum e ordem cobrem TF **e** RAG; self-review anterior “sem TBD” era falso — corrigido aqui.
- `regra_fallback` só TF morto + playbook factual.
- Fixture KG obrigatório para caminhos rede/híbrido.
- Acceptance de penetração distingue gap de dados vs bug de router.
- Voz/ElevenLabs e KG real de bairro = docs separados (não reabrir este contrato sem addendum).
