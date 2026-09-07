# JARVIS-Q — Addendum de voz (TTS ElevenLabs-first)

Date: 2026-09-06  
Status: **locked** (produto) — aguarda plano de implementação  
Scope: **só TTS** no HUD local (`public/jarvis-q.html` + `scripts/jarvis_qa_server.py`) e cascade em `scripts/jarvis_tts.py` / `scripts/jarvis_eleven.py`. **STT / Whisper / mobile / telefonia = Later.**  
Repo: `assistent-control` (worktree/cópia local `jarvis-eleven`, branch `feat/jarvis-eleven`).  
Pai: `Docs/superpowers/specs/2026-09-03-jarvis-q-tf-design.md` (contrato cognitivo). Este doc **não** altera `ask()` / modos / RAG.

## Problem

O contrato cognitivo está locked e devolve `AskResult.fala` para TTS. Já existe smoke de voz (ElevenLabs + edge Antonio + Piper + SAPI) e HUD que chama `/speak`. Sem addendum, o produto fica inconsistente: código é ElevenLabs-first, o spec cognitivo ainda aponta Later genérico, e há gaps de UX (prosódia, cota, falha de sessão, warmup, env documentado).

## Decisions (locked 2026-09-06)

| Tema | Escolha |
|------|---------|
| Papel da voz | **Adorno do HUD local**, não cérebro. `ask()` continua texto; TTS só lê `fala` (fallback `resposta`). |
| Voz canônica | Apelido **`lair`** → Voice ID `4r3G9XKliGgVZLKMgjik`. Default de produto e de código (`VOZ_PADRAO`). |
| Outras vozes | Catálogo pt-BR permitido: `nelton`, `eliel`, `rafael`, `davi`, `guilherme`, `flavio`, `randel` (mapa em `jarvis_eleven.VOZES_PT_BR`). Troca via `ELEVENLABS_VOICE_ID` (apelido ou id cru) ou body `voz` em `/speak`. |
| Cascade | **Locked:** ElevenLabs → edge `pt-BR-AntonioNeural` → Piper ONNX → SAPI (`Daniel` preferido). Não é “ElevenLabs obrigatório”. |
| Forçar backend | `JARVIS_TTS_BACKEND=auto\|eleven\|edge\|piper\|sapi`. `JARVIS_TTS=0` desliga server TTS (HUD → Web Speech). |
| Onde conta | **HUD local conta** neste addendum (fase desktop/local). CLI `jarvis_qa.py` **não** sintetiza por padrão. |
| Modelo EL | `eleven_multilingual_v2` (default). Alternativas documentadas: `eleven_flash_v2_5`, `eleven_v3`. Sem `eleven_turbo_v2_5` (deprecado). |
| Settings EL | stability `0.55` / similarity `0.80` / style `0.0` / speed `0.96` / `use_speaker_boost=true` (overrides via env). |
| Idioma | `language_code=pt` (env `ELEVENLABS_LANGUAGE`). |
| Formato | `mp3_44100_128` → MIME `audio/mpeg`. Piper/SAPI → `audio/wav`. Header `X-Jarvis-TTS-Backend` obrigatório. |
| Segredo | `ELEVENLABS_API_KEY` só em `.env.local` (gitignored). Nunca chat, git, logs. |

## Contract (HTTP / módulos)

### Superfície

| Método | Path | Papel |
|--------|------|-------|
| `POST` | `/tts` e `/speak` (alias) | Sintetiza `{ texto, voz?, previous_text? }` → bytes de áudio |
| `GET` | `/health` | Inclui `tts`, `vozes`, `tts_prefer`, `tts_backend`, `tts_aviso`, `eleven` |

Payload `/speak` (locked):

```text
{ texto: str,           # obrigatório — preferir AskResult.fala
  voz?: str,            # "lair" | "eleven:lair" | voice_id | "edge:…" | "piper:…"
  previous_text?: str   # turno anterior falado; EL usa como contexto de prosódia
}
```

Resposta ok: body = áudio; `Content-Type` coerente com o backend; `X-Jarvis-TTS-Backend: eleven|edge|piper|sapi`.

### Módulos

| Peça | Função | Fonte |
|------|--------|-------|
| Cliente EL | REST TTS + `assinatura()` + erros tipados | `scripts/jarvis_eleven.py` |
| Cascade | Ordem EL→Antonio→Piper→SAPI; `ultimo_erro()` | `scripts/jarvis_tts.py` |
| Normalização | `to_speech` / vocativo | `scripts/jarvis_voice.py` (já no cognitivo) |
| Server | `/speak`, `/health.eleven` | `scripts/jarvis_qa_server.py` |
| HUD | play + cota + previous_text | `public/jarvis-q.html` |

### Erros tipados (ElevenLabs)

| Status / sinal | Propriedade | Comportamento do cascade |
|----------------|-------------|---------------------------|
| 401 / 403 | `chave_invalida` | Pula EL; próximo backend; `tts_aviso` acionável |
| 402 / corpo com `quota` | `sem_creditos` | Pula EL; próximo backend; HUD mostra cota |
| 429 | `concorrencia` | **1 retry** com backoff curto (ex. 400–800 ms); se falhar de novo → próximo backend |
| Rede / timeout / vazio | — | Próximo backend |
| Texto > limite do modelo | falha antes do HTTP | Não gasta crédito; 4xx JSON no `/speak` |

## HUD (comportamento locked)

1. **Texto falado:** `speak(data.fala || data.resposta)` — já alinhado.
2. **`previous_text`:** o HUD **deve** enviar no `/speak` o último texto efetivamente falado (não a pergunta do usuário). Sem isso, prosódia EL reinicia a cada turno.
3. **Cota / aviso:** ao boot (e opcionalmente a cada N minutos), ler `/health.eleven` e `tts_aviso`. Se `pct_usado ≥ 90` ou `restantes` baixo, mostrar rodapé (ex. “ElevenLabs: cota baixa — caindo para Antonio”). Não esperar o usuário descobrir pelo fallback silencioso.
4. **Falha de `/speak`:** **não** desligar `ttsLocal` permanente na sessão. Política: (a) retry 429 no server; (b) se o server devolveu áudio de outro backend (`X-Jarvis-TTS-Backend` ≠ eleven), continuar com server TTS; (c) só cair em Web Speech se **todos** os backends falharam (503/500 sem áudio). Após Web Speech de emergência, o próximo turno pode tentar server de novo.
5. **Comentário / label:** UI e comentários devem dizer ElevenLabs-first (não “só Antonio→Piper→SAPI”).

## Warmup (server boot)

`_aquecer()` no `jarvis_qa_server`:

| Peça | Locked |
|------|--------|
| Reasoner `ask("aquecimento")` | Mantém (custo TF local). |
| TTS | **Não** sintetizar frase via ElevenLabs no boot. Opções aceitas: (1) `JARVIS_TTS_BACKEND=edge` só no warmup; (2) Piper/SAPI se disponíveis; (3) skip TTS no warmup se o preferido for `eleven`. Objetivo: zero chars EL gastos só para “Pronto.”. |

## Env (documentar em `.env.example`)

Bloco mínimo (valores de exemplo, sem segredo real):

```text
# --- JARVIS-Q TTS (addendum voz) ---
# ELEVENLABS_API_KEY=
# ELEVENLABS_VOICE_ID=lair
# ELEVENLABS_MODEL_ID=eleven_multilingual_v2
# ELEVENLABS_OUTPUT_FORMAT=mp3_44100_128
# ELEVENLABS_LANGUAGE=pt
# ELEVENLABS_STABILITY=0.55
# ELEVENLABS_SIMILARITY=0.80
# ELEVENLABS_STYLE=0.0
# ELEVENLABS_SPEED=0.96
# ELEVENLABS_SEED=
# JARVIS_TTS=1
# JARVIS_TTS_BACKEND=auto
# JARVIS_TTS_VOICE=pt-BR-AntonioNeural
# JARVIS_TTS_PIPER_VOICE=faber
```

Plano ElevenLabs (Free/Starter/Creator…): **documentar no runbook/ops** quando conhecido — só para interpretar 429/402; não bloqueia o addendum.

## Tests

| Tipo | Onde | Nota |
|------|------|------|
| Offline EL | `scripts/jarvis_eleven_test.py` | Config, MIME, limites, classificação de erro |
| Rede EL | mesmos | `skip` sem `ELEVENLABS_API_KEY` |
| Cascade | `scripts/jarvis_tts_test.py` | MIME/backend; queda EL→próximo |
| CI | — | **Sem** TTS/STT obrigatório (igual spec cognitivo) |

## Out of scope (este addendum)

- STT / Whisper / captura de microfone produção.
- App mobile; WebRTC Conversational Agents ElevenLabs.
- Telefonia / WhatsApp PTT (Eros) — outro spec.
- Reabrir modos de `ask()` / RAG.
- Substituir `to_speech` por pronunciation dictionary da API EL (Later opcional).

## Later

- STT Whisper no desktop; mesmo `ask()`.
- Streaming TTS EL (latência em respostas longas).
- Retry com jitter configurável; fila se `concorrencia` persistir.
- Pronunciation dictionary / `apply_text_normalization` além de `jarvis_voice.to_speech`.
- Mobile: cliente HTTP + TTS no device ou server.
- Voice Agents / phone no ecossistema GymSite/Eros.

## Gaps fechados por este doc

| # | Gap (review Eleven Lab Dev) | Resolução |
|---|-----------------------------|-----------|
| 1 | HUD sem `previous_text` | § HUD item 2 |
| 2 | HUD ignora cota/`tts_aviso` | § HUD item 3 |
| 3 | 1 falha desliga `ttsLocal` | § HUD item 4 |
| 4 | Sem retry 429 | § Erros tipados |
| 5 | Warmup gasta chars EL | § Warmup |
| 6 | `.env.example` sem `ELEVENLABS_*` | § Env |
| 7 | Travas de produto | § Decisions (`lair`, cascade, HUD conta) |

## Self-review

- Sem TBD de produto nos locked; plano ElevenLabs (tier comercial) fica em ops, não bloqueia.
- Não contradiz o cognitivo: voz continua fora do contrato `ask()`; este doc é o addendum citado lá.
- Implementação = plano separado (`writing-plans`); este arquivo **não** autoriza código até o plano.
