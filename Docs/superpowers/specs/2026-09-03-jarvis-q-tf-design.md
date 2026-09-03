# JARVIS-Q — Q&A cognitivo TensorFlow (regras / rede / híbrido)

Date: 2026-09-03  
Status: **draft — awaiting user review**  
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
| Regras (playbook) | abas TensorBoard 01–15, ELI5, “como abrir” | índice do HTML `playbook-tensorboard.html` (scratchpad Claude ou cópia em `data/jarvis/`) |
| Regras (KG) | `KnowledgeGraph.is_known` | `reasoning_neuron_viabilidade.py` |
| Rede | `ReasoningNeuron.propagate` + `TripleScorer` | mesmo arquivo |
| Híbrido | `RuleBank` + t-norm produto | mesmo arquivo |
| CLI | `npx`/`python` uma pergunta | `scripts/jarvis_qa.py` (entrada) |

### Roteamento (ordem fixa, sem LLM)

1. Parse: intent ∈ {playbook_aba, viabilidade, relacao_kg, lixo} + entidades (aba TB, nomes do `entity2id` se houver match).
2. Playbook casa **e** não pede inferência de tripla → `regra`.
3. Há `Rule` cujo `body` casa o caminho pedido → `hibrido`.
4. Entidades no KG e pergunta é relação/viabilidade → `rede`.
5. Nada → recusa (`modo` omitido ou `regra` com resposta de recusa — **escolha explícita:** recusa usa `modo=regra` só se a mensagem for template fixo de “não sei”; senão campo `modo=regra` + `fontes=[]` e `porque=sem_match`. **Decisão:** recusa = `modo=regra`, `fontes=[]`, `porque=sem_match`.
6. TF indisponível (import/GPU) **e** playbook casaria → `regra_fallback`.

Empate 3 vs 4: **híbrido ganha** se existe grounding de regra; senão rede.

## Data

- Playbook: seções `f1`–`f15` + nota “como abrir” + TOC. **Não** o PDF paginado como fonte (PDF é export). Fonte canônica = HTML do playbook.
- KG v1: toy do `_toy_demo` **ou** dump mínimo de viabilidade já usado no notebook — o plano de implementação escolhe um fixture em `data/jarvis/kg-toy.json`. Spec exige fixture versionado, não KG vazio.
- Limiar rede: `sigmoid(score) < 0.5` → resposta admite incerteza; **não** afirma “viável”.
- Híbrido: se `body > head` (ReLU do consistency) no grounding da pergunta → incluir `conflito` em `porque`; ainda responde com confiança da regra.

## Errors

- Entidade fora do KG: recusa + exemplo com entidade que existe no fixture.
- Aba TensorBoard inexistente: listar nomes 01–15; não inventar aba.
- Sem log de tokens, sem HTTP para GitHub do curso.

## Tests (smoke)

Arquivo: `scripts/lib/jarvisQa.test.ts` **ou** pytest ao lado do script Python — **escolha:** pytest em `scripts/jarvis_qa_test.py` porque o motor é TF/Keras.

Casos:

1. “o que é Projector?” → `modo=regra`, fonte `playbook:#f13`
2. Pergunta alinhada ao toy KG → `modo=rede`, `fontes` contém tripla, score presente em `porque`
3. Caminho de `Rule` do toy → `modo=hibrido`, nome da regra em `fontes`
4. “asdf qwerty” → recusa, `porque=sem_match`
5. (opcional skip se TF off) import fail simulado → `regra_fallback` só se a pergunta for playbook

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

- Sem TBD. Limiar 0.5 explícito. Recusa = `modo=regra` + `porque=sem_match`. Híbrido vence empate com rede. Fixture KG obrigatório no plano.
- Consistente com seções aprovadas 1–4.
- Um plano de implementação cabe neste spec (Q&A só).
