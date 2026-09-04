# JARVIS-Q — Q&A cognitivo TensorFlow (regras / rede / híbrido)

Date: 2026-09-03  
Status: **aprovado** (2026-09-03)  
Scope: **só Q&A local** (CLI). Desktop (voz/STT) e mobile ficam specs depois.  
Repo: `assistent-control`.

## Problem

Curso [Jarvis! / JARVIS Academy](https://drive.google.com/drive/folders/11lh62OS2aBncITs45DyPhwLgP8JhiA4Z) e o prompt em `Downloads\jarvis` tratam **Claude + AIOS + n8n** como cérebro. O produto que queremos é o contrário: **TensorFlow raciocina** (grafo + regras + hops), texto só entra e sai. Já existe motor em `notebooks/reasoning_neuron_viabilidade.py`. Falta uma porta `ask()` com três modos explícitos e playbook TensorBoard como FAQ determinística.

## Decisions (brainstorm 2026-09-03)

| Tema | Escolha |
|------|---------|
| Nome | **JARVIS-Q** (núcleo). Não clonar `gaahzx/jarvis-app`. |
| Ordem de produto | Q&A → desktop (STT/TTS) → mobile. Este spec = Q&A. |
| Arquitetura | Abordagem **1**: embrulhar neurônio existente + router. Não IBM LNN do zero. Não Leon/LLM como cérebro. |
| Claude/AIOS no v1 | **Não.** Papel do Claude vira router determinístico. Papel do AIOS vira KG + estado JSON. |
| Voz | Fora do v1. Smoke já feito: `pt-BR-AntonioNeural` (net) + `Microsoft Daniel` (offline). Spec desktop depois. |
| Segredo | **Proibido** gravar GitHub PAT / comando do curso em código, git ou logs. |

## Contract

`ask(texto: str) -> AskResult`

```text
AskResult
  resposta: str          # PT-BR, humano
  modo: enum             # regra | rede | hibrido | regra_fallback
  porque: str            # uma frase: por que este modo
  fontes: list[str]      # ids: playbook:#f13, kg:triple, rule:nome
```

Um turno = **um** `modo`. Híbrido pode citar score da rede **e** nome da regra no `porque`/`fontes`. Não mistura três narrativas.

## Components

| Peça | Função | Fonte |
|------|--------|--------|
| Router | intent + entidades; escolhe modo | novo, Python |
| Regras (playbook) | abas TensorBoard 01–15, ELI5, “como abrir” | canônico: `public/playbook-tensorboard.html` (cópia em `data/jarvis/` só se o plano copiar; scratchpad **não** é fonte) |
| Regras (KG) | `KnowledgeGraph.is_known` | `reasoning_neuron_viabilidade.py` |
| Rede (relação) | `ReasoningNeuron.propagate` + `TripleScorer` | mesmo arquivo |
| Rede (viabilidade) | `ViabilityReasoner.report()` (`viab_head`, não o bilinear da tripla) | mesmo arquivo |
| Híbrido | `RuleBank` + t-norm produto | mesmo arquivo |
| CLI | `npx`/`python` uma pergunta | `scripts/jarvis_qa.py` (entrada) |

### Roteamento (ordem fixa, sem LLM)

`tf_ok` = import Keras/TF + `ViabilityReasoner` sobe (sem exigir GPU).

1. Parse: intent ∈ {playbook_aba, viabilidade, relacao_kg, lixo} + entidades (aba TB, nomes do `entity2id` se houver match).
2. **Se `not tf_ok`:** playbook casa (FAQ, sem tripla) → `regra_fallback`. Senão → recusa `modo=regra`, `fontes=[]`, `porque=sem_match` (não há rede/híbrido sem TF).
3. **Se `tf_ok`:** playbook casa **e** não pede inferência de tripla/viabilidade → `regra`.
4. Há `Rule` cujo `body` casa o caminho pedido → `hibrido`.
5. Entidades no KG:
   - intent `viabilidade` → `rede` via `report()`;
   - intent `relacao_kg` → `rede` via `TripleScorer`.
6. Nada → recusa: `modo=regra`, `fontes=[]`, `porque=sem_match`.

`regra_fallback` **só** no passo 2 (`not tf_ok` + playbook). Com TF no ar, playbook = `regra`, nunca fallback.

Empate 4 vs 5: **híbrido ganha** se existe grounding de regra; senão rede.

## Data

- Playbook: seções `f1`–`f15` + nota “como abrir” + TOC. Fonte canônica = `public/playbook-tensorboard.html`. PDF em `output/pdf/` é só export.
- KG v1: fixture versionado `data/jarvis/kg-toy.json` derivado do `_toy_demo` (não KG vazio).
- Viabilidade (`report()`): `viabilidade` = sigmoid(`viab_head`); `rotulo` = `alta` se ≥ 0.66, `media` se ≥ 0.40, senão `baixa`. Afirmar “viável” **só** se `rotulo=alta`. `baixa`/`media` = incerteza no texto. `infer_threshold` default **0.7** só para `fatos_inferidos` (`TripleScorer` em triplas ausentes da KB).
- Relação KG: `TripleScorer.prob`; tripla inferida (não `is_known`) entra na resposta só se ≥ **0.7**. Abaixo disso: incerteza, não afirma o fato.
- Híbrido: se `body > head` (ReLU do consistency) no grounding da pergunta → incluir `conflito` em `porque`; ainda responde com confiança da regra.

## Errors

- Entidade fora do KG: recusa + exemplo com entidade que existe no fixture.
- Aba TensorBoard inexistente: listar nomes 01–15; não inventar aba.
- Sem log de tokens, sem HTTP para GitHub do curso.

## Tests (smoke)

Arquivo: `scripts/lib/jarvisQa.test.ts` **ou** pytest ao lado do script Python — **escolha:** pytest em `scripts/jarvis_qa_test.py` porque o motor é TF/Keras.

Casos:

1. “o que é Projector?” + TF ok → `modo=regra`, fonte `playbook:#f13`
2. Viabilidade de entidade do toy (ex. `bairro:savassi`) → `modo=rede`, `fontes` citam `report`, `porque` tem `rotulo` (`alta`/`media`/`baixa`)
3. Caminho de `Rule` do toy → `modo=hibrido`, nome da regra em `fontes`
4. “asdf qwerty” → recusa, `porque=sem_match`
5. TF off (import fail simulado) + Projector → `modo=regra_fallback`; TF off + viabilidade → recusa `sem_match`

TTS/STT **não** no CI.

## Out of scope (este spec)

- Clone/install JARVIS Academy, Obsidian, n8n, 4 API keys.
- Desktop HUD, Whisper, Antonio/Daniel em produção.
- App mobile.
- Substituir `ReasoningNeuron` por IBM LNN.

## Later (não implementar agora)

- Desktop: mesmo `ask()`; STT Whisper; TTS Antonio com fallback Daniel.
- Mobile: cliente HTTP na frente do mesmo `ask()`.

## Addendum — RAG-first penetração (bairro × agregadores)

Date: 2026-09-03  
Status: **locked** (produto)

### Papéis dos `*_GROUP_ID` (mesmos do GymSite/Eros)

| Grupo | Papel |
|-------|--------|
| `RECEITA_GROUP_ID` | **Universo** de academias abertas (CNAE/RFB). Denominador de mercado no bairro quando disponível. |
| `TOTALPASS` / `WELLHUB` / `GURUPASS` | **Cobertura** do agregador (quem aceita o plano). Numerador de penetração. |
| `MERCADO` | Conteúdo/contexto; **não** entra no censo de penetração. |

Cobertura ≠ universo: contar “academias no bairro X” = Receita (quando há chunks); contar “usam TP/WH/GP” = distinct no grupo do agregador.

### Roteamento

Perguntas de penetração / cobertura por bairro (“quantas usam TP vs WH vs GP no bairro X?”) → **RAG-first** (antes de TF toy / playbook genérico).  
TF é **meio**, não face: após a resposta factual, oferecer cruzamento TF (renda/aluguel/pop) só quando útil.  
Recusa default: sem pitch de demo toy (“Projector / Savassi viável / herda renda”).

### Contagem (não confundir com top-k semântico)

- `match_chunks` top-k = recuperação semântica; **não** é censo.
- Contagem: PostgREST em `eros_knowledge_chunks` filtrado por `group_id` + `meta->>bairro_normalizado` (+ `meta->>cidade` quando houver), distinct por chave de academia (`cnpj` / `gym_id` / `nome_academia` / `source_ref`).
- Normalização **única** (`bairro_filter_variants` / `cidade_filter_variants`): query → slug kebab (`paraiso`) **e** UPPER+espaço (`PARAISO`); cidade → canônico display (`São Paulo`) + variantes sem acento. Probe: metas usam `bairro_normalizado` + `cidade` (não há `cidade_normalizada`).
- **Geo:** sem cidade e bairro ambíguo (`centro`, `paraiso`, …) → pedir cidade; **não** mesclar Brasil. Com cidade → filtrar os quatro grupos no mesmo escopo. `%` WH/Receita só se `mesmo_escopo` (cidade) e Receita ≥ cobertura.
- Embeddings: Ollama **nativo** (`JARVIS_OLLAMA_URL` / `OLLAMA_EMBED_URL` → `http://localhost:11434`), nunca OpenAI-compat `.../v1`.
- **GuruPass meta:** ingest deve gravar `meta.bairro_normalizado` (slug kebab, mesmo `normalizeBairro` do Wellhub / `normalize_bairro_slug` do JARVIS). Chunks antigos: `npx tsx scripts/backfill-gp-bairro-normalizado.ts` (dry-run) e `--apply` para gravar.
- **TotalPass meta:** `ingest-totalpass-sp` **não** grava `bairro`/`bairro_normalizado`. Resolver CEP/Nominatim (`resolve:tp-bairros` → `tp-bairro-index.json`) e aplicar: `npx tsx scripts/backfill-tp-bairro-normalizado.ts` (dry-run) e `--apply`. Sem isso, penetração TP=0 em bairros só resolvidos no índice (ex. Pinheiros SP).
- **Receita meta:** ingest deve gravar `meta.bairro_normalizado` em **UPPER+espaço** (`BELA VISTA`) + `cidade` canônica. Chunks com `bairro_normalizado` null (geo incompleta no RAG) mas CNPJ no parque RFB local: `npx tsx scripts/backfill-receita-meta-by-rfb.ts` (dry-run) e `--apply`. CNPJs ausentes do grupo: `npm run ingest:receita` (`scripts/ingest-receita-cnae.ts`, fonte RFB local; default dry-run + `MISSING_ONLY=1`; `--apply`; filtros `UF`/`MUNICIPIO`/`BAIRRO`; depois `npm run embed:receita`). Ex. Bela Vista SP: `UF=SP MUNICIPIO=7107 BAIRRO="Bela Vista" npm run ingest:receita -- --apply`. Nacional: sem filtros (lento). Não inventa denom: até o universo fechar, se max(TP,WH,GP) > Receita → prosa “universo parcial / cobertura vs censo”, sem % de mercado.

### Narrativa

Distinct counts TP/WH/GP (+ Receita se houver) + prosa curta: maior penetração, plano top se `meta` tiver.

**Denom / % de mercado (locked):**

| Condição | Comportamento |
|----------|----------------|
| `mesmo_escopo` e Receita ≥ max(TP,WH,GP) e WH>0 | Pode narrar WH % do universo Receita. |
| `mesmo_escopo` e max(TP,WH,GP) > Receita | **Não** alegar % de mercado. Reportar counts crus; explicar universo parcial / gap CNPJ-RFB; opcional `cobertura vs censo: max/Receita`. |
| Sem cidade / escopo nacional | % omitida (praças podem misturar). |
| Receita = 0 | % omitida. |

União CNPJ Receita∪agregadores como denom: **só** se `meta.cnpj` confiável nos dois lados; hoje agregadores tipicamente não têm — não implementar.

## Self-review

- Sem TBD. `regra_fallback` só com TF morto + playbook. Playbook canônico = `public/playbook-tensorboard.html`. Viabilidade = `report()` 0.66/0.40; infer tripla 0.7. Recusa = `modo=regra` + `porque=sem_match`. Híbrido vence empate com rede. Fixture KG obrigatório.
- Consistente com seções aprovadas 1–4.
- Um plano de implementação cabe neste spec (Q&A só).
