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

## Self-review

- Sem TBD. `regra_fallback` só com TF morto + playbook. Playbook canônico = `public/playbook-tensorboard.html`. Viabilidade = `report()` 0.66/0.40; infer tripla 0.7. Recusa = `modo=regra` + `porque=sem_match`. Híbrido vence empate com rede. Fixture KG obrigatório.
- Consistente com seções aprovadas 1–4.
- Um plano de implementação cabe neste spec (Q&A só).
