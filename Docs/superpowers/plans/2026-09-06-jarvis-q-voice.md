# JARVIS-Q — Addendum de voz (Implementation Plan)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fechar os 7 gaps do addendum de voz (TTS ElevenLabs-first) no HUD local e no cascade, sem reabrir `ask()` / RAG / contrato cognitivo.

**Architecture:** O server já aceita `previous_text` em `/speak` e expõe `eleven` + `tts_aviso` em `/health`; o cascade já é EL→Antonio→Piper→SAPI. Esta onda só fecha UX/robustez: HUD envia prosódia e mostra cota; falha de `/speak` não mata `ttsLocal` na sessão; 1 retry em 429 no cliente EL; warmup sem gastar chars EL; documentar `ELEVENLABS_*` no `.env.example`; confirmar travas `lair` + cascade (só editar se houver drift).

**Tech Stack:** Python 3.11+, `urllib` (cliente EL), `pytest`, HUD vanilla JS em `public/jarvis-q.html`, Windows PowerShell + `.venv`.

**Spec:** `Docs/superpowers/specs/2026-09-06-jarvis-q-voice-design.md`  
**Checkout:** `C:\Users\marce\jarvis-eleven` branch `feat/jarvis-eleven`  
**Fora de escopo (NÃO re-planejar):** `ask()`, modos, RAG, STT/Whisper, mobile, telefonia, pronunciation dictionary EL.

## Global Constraints

- Voz = adorno do HUD; `ask()` continua texto; TTS lê `fala` (fallback `resposta`)
- `VOZ_PADRAO = "lair"` → Voice ID `4r3G9XKliGgVZLKMgjik`
- Cascade locked: ElevenLabs → edge `pt-BR-AntonioNeural` → Piper ONNX → SAPI (`Daniel` preferido)
- Modelo default: `eleven_multilingual_v2` (sem `eleven_turbo_v2_5`)
- Settings EL: stability `0.55` / similarity `0.80` / style `0.0` / speed `0.96` / `use_speaker_boost=true`
- Formato: `mp3_44100_128` → `audio/mpeg`; header `X-Jarvis-TTS-Backend` obrigatório
- `ELEVENLABS_API_KEY` só em `.env.local` (gitignored); nunca chat/git/logs
- 429 → **1 retry** com backoff 400–800 ms; se falhar de novo → próximo backend
- Warmup: **zero** chars EL só para “Pronto.”
- CI sem TTS/STT obrigatório; testes de rede `skip` sem chave
- Commit **só** se o humano pedir; PowerShell one-liners (sem `\` bash)
- Prosa PT-BR; identificadores em inglês

---

## File map

| Path | Responsabilidade nesta onda |
|------|-----------------------------|
| `public/jarvis-q.html` | `previous_text`, rodapé cota/`tts_aviso`, política de falha sem desligar `ttsLocal`, label ElevenLabs-first |
| `scripts/jarvis_eleven.py` | 1× retry em 429 dentro de `sintetizar` |
| `scripts/jarvis_eleven_test.py` | Testes offline do retry 429 + locks de produto |
| `scripts/jarvis_tts.py` | Helper `backend_warmup()` (sem EL); cascade intacto |
| `scripts/jarvis_tts_test.py` | Warmup helper + locks de cascade |
| `scripts/jarvis_qa_server.py` | `_aquecer()` usa warmup sem EL |
| `.env.example` | Bloco `ELEVENLABS_*` + `JARVIS_TTS*` |

**Já ok (não reimplementar):** `/speak` aceita `previous_text`; `/health` devolve `eleven`/`tts_aviso`; `VOZ_PADRAO=lair`; `BACKENDS=("eleven","edge","piper","sapi")`; `ElevenErro.concorrencia`.

---

### Task 1: HUD envia `previous_text` no `/speak`

**Files:**
- Modify: `public/jarvis-q.html` (bloco `speakServer` / `speak`)
- Test: smoke estático em `scripts/jarvis_tts_test.py` (contrato do HTML) **ou** assert manual + Select-String

**Interfaces:**
- Consumes: `POST /speak` body `{ texto, previous_text? }` (server já encaminha a `sintetizar_audio`)
- Produces: variável de sessão `lastSpokenText: string` — último texto **efetivamente falado** (não a pergunta do usuário); enviado como `previous_text` no turno seguinte

- [ ] **Step 1: Write the failing smoke (contrato HTML)**

Em `scripts/jarvis_tts_test.py`, acrescentar:

```python
def test_hud_speak_envia_previous_text():
    """Spec voz § HUD.2: lastSpokenText viaja no body do /speak."""
    html = (ROOT / "public" / "jarvis-q.html").read_text(encoding="utf-8")
    assert "lastSpokenText" in html
    assert "previous_text" in html
    # body do /speak precisa incluir o campo (não só comentário)
    assert "previous_text: lastSpokenText" in html.replace(" ", "") or (
        '"previous_text"' in html and "lastSpokenText" in html
    )
```

- [ ] **Step 2: Run — expect FAIL**

```powershell
cd C:\Users\marce\jarvis-eleven
.\.venv\Scripts\python.exe -m pytest scripts/jarvis_tts_test.py::test_hud_speak_envia_previous_text -v
```

Expected: FAIL (`lastSpokenText` ausente / `previous_text` só no server).

- [ ] **Step 3: Implement no HUD**

Em `public/jarvis-q.html`, junto de `var ttsLocal = false`:

```javascript
var lastSpokenText = "";  /* último texto falado — prosódia EL */
```

Substituir `speakServer` para enviar o turno anterior e atualizar após sucesso:

```javascript
async function speakServer(text) {
  var payload = { texto: text };
  if (lastSpokenText) payload.previous_text = lastSpokenText;
  var res = await fetch(API + "/speak", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error("HTTP " + res.status);
  var blob = await res.blob();
  stopAudio();
  var a = new Audio(URL.createObjectURL(blob));
  audioAtual = a;
  a.playbackRate = 1;
  return new Promise(function (resolve, reject) {
    a.onended = function () {
      stopAudio();
      lastSpokenText = text;
      resolve();
    };
    a.onerror = function () { stopAudio(); reject(new Error("audio")); };
    a.play().catch(reject);
  });
}
```

Em `speakWebSpeech`, ao terminar a última frase (`else setState("ready", "Pronto")`), também fazer `lastSpokenText = text` (o parâmetro de `speakWebSpeech`), para o próximo `/speak` ter contexto mesmo após fallback.

Atualizar o comentário do bloco de voz:

```javascript
/* ── voz neural no server (ElevenLabs-first → Antonio → Piper → SAPI) ──
   Preferido sobre Web Speech. /tts e /speak devolvem MP3/WAV.
   previous_text = último falado (prosódia EL). Falha total → Web Speech. */
```

- [ ] **Step 4: Run — expect PASS**

```powershell
.\.venv\Scripts\python.exe -m pytest scripts/jarvis_tts_test.py::test_hud_speak_envia_previous_text -v
```

Expected: PASS.

- [ ] **Step 5: Commit** (só se o humano pedir)

```powershell
git add public/jarvis-q.html scripts/jarvis_tts_test.py
git commit -m "feat(jarvis-q): HUD envia previous_text no /speak"
```

---

### Task 2: HUD mostra cota / `tts_aviso` a partir de `/health`

**Files:**
- Modify: `public/jarvis-q.html` (CSS `.api-foot.warn`, boot `/health`, opcional refresh)
- Modify: `scripts/jarvis_tts_test.py` (smoke HTML)

**Interfaces:**
- Consumes: `GET /health` → `{ tts, tts_prefer, tts_aviso, eleven: { pct_usado, restantes, tier, erro? } }`
- Produces: rodapé `apiStatus` com aviso acionável se `pct_usado >= 90` ou `restantes` baixo; mostra `tts_aviso` quando presente

- [ ] **Step 1: Write the failing smoke**

```python
def test_hud_mostra_cota_e_tts_aviso():
    html = (ROOT / "public" / "jarvis-q.html").read_text(encoding="utf-8")
    assert "tts_aviso" in html
    assert "pct_usado" in html
    assert "cota baixa" in html.lower() or "ElevenLabs: cota" in html
    assert "applyHealthVoice" in html or "refreshTtsHealth" in html
```

- [ ] **Step 2: Run — expect FAIL**

```powershell
.\.venv\Scripts\python.exe -m pytest scripts/jarvis_tts_test.py::test_hud_mostra_cota_e_tts_aviso -v
```

Expected: FAIL (HUD hoje só usa `d.tts` / `tts_prefer`).

- [ ] **Step 3: Implement**

CSS (após `.api-foot.bad`):

```css
.api-foot.warn { color: var(--warn, #e6a23c); }
```

JS — extrair helper e usar no boot + timer 5 min:

```javascript
function applyHealthVoice(d) {
  if (!d || !d.ok) {
    apiStatus.textContent = "API respondeu sem ok";
    apiStatus.className = "api-foot bad";
    return;
  }
  ttsLocal = !!d.tts;
  var voz = "";
  if (ttsLocal) {
    var pref = String(d.tts_prefer || "");
    if (pref.indexOf("eleven") === 0) voz = " · ElevenLabs";
    else if (pref.indexOf("Antonio") >= 0 ||
      (d.vozes || []).some(function (v) { return String(v).indexOf("Antonio") >= 0; }))
      voz = " · Antonio";
    else voz = " · voz server";
  }
  var extra = "";
  var warn = false;
  if (d.tts_aviso) {
    extra += " · " + String(d.tts_aviso);
    warn = true;
  }
  var el = d.eleven;
  if (el && !el.erro) {
    var pct = el.pct_usado;
    var rest = el.restantes;
    if ((typeof pct === "number" && pct >= 90) ||
        (typeof rest === "number" && rest < 500)) {
      extra += " · ElevenLabs: cota baixa — caindo para Antonio";
      warn = true;
    }
  }
  apiStatus.textContent =
    "API ok · " + (location.host || "127.0.0.1:8765") + voz + extra;
  apiStatus.className = warn ? "api-foot warn" : "api-foot ok";
}

function refreshTtsHealth() {
  return fetch(API + "/health")
    .then(function (r) { return r.json(); })
    .then(applyHealthVoice)
    .catch(function () {
      apiStatus.textContent = "API offline — inicie jarvis_qa_server.py";
      apiStatus.className = "api-foot bad";
    });
}

refreshTtsHealth();
setInterval(refreshTtsHealth, 5 * 60 * 1000);
```

Remover o `fetch(API + "/health")` antigo duplicado.

- [ ] **Step 4: Run — expect PASS**

```powershell
.\.venv\Scripts\python.exe -m pytest scripts/jarvis_tts_test.py::test_hud_mostra_cota_e_tts_aviso -v
```

- [ ] **Step 5: Commit** (só se o humano pedir)

```powershell
git add public/jarvis-q.html scripts/jarvis_tts_test.py
git commit -m "feat(jarvis-q): HUD mostra cota ElevenLabs e tts_aviso"
```

---

### Task 3: Não desligar `ttsLocal` permanente após 1 falha

**Files:**
- Modify: `public/jarvis-q.html` (`speak` catch)
- Modify: `scripts/jarvis_tts_test.py`

**Interfaces:**
- Consumes: falha de `speakServer` (HTTP 4xx/5xx ou play error)
- Produces: Web Speech **só neste turno**; `ttsLocal` permanece `true` se `/health` disse que há TTS; próximo turno tenta server de novo

- [ ] **Step 1: Write the failing smoke**

```python
def test_hud_nao_desliga_ttsLocal_em_falha():
    html = (ROOT / "public" / "jarvis-q.html").read_text(encoding="utf-8")
    # política antiga: ttsLocal = false dentro do catch de speakServer
    assert "ttsLocal = false" not in html.split("speakServer")[0]  # declaração ok no boot
    # no handler de falha de speak NÃO pode haver atribuição permanente
    speak_fn = html.split("function speak(text)")[1].split("function speakWebSpeech")[0]
    assert "ttsLocal = false" not in speak_fn
    assert "speakWebSpeech" in speak_fn
```

- [ ] **Step 2: Run — expect FAIL**

```powershell
.\.venv\Scripts\python.exe -m pytest scripts/jarvis_tts_test.py::test_hud_nao_desliga_ttsLocal_em_falha -v
```

Expected: FAIL (`ttsLocal = false` ainda no catch).

- [ ] **Step 3: Implement**

Em `speak(text)`, trocar o `.catch`:

```javascript
speakServer(text)
  .then(function () { setState("ready", "Pronto"); })
  .catch(function () {
    /* Emergência deste turno apenas — NÃO desligar ttsLocal na sessão.
       Próximo turno tenta o server de novo (cascade pode ter recuperado). */
    speakWebSpeech(text);
  });
```

- [ ] **Step 4: Run — expect PASS**

```powershell
.\.venv\Scripts\python.exe -m pytest scripts/jarvis_tts_test.py::test_hud_nao_desliga_ttsLocal_em_falha -v
```

- [ ] **Step 5: Commit** (só se o humano pedir)

```powershell
git add public/jarvis-q.html scripts/jarvis_tts_test.py
git commit -m "fix(jarvis-q): keep ttsLocal after single /speak failure"
```

---

### Task 4: Retry 1× em 429 (`jarvis_eleven` → usado por `jarvis_tts`)

**Files:**
- Modify: `scripts/jarvis_eleven.py` (`sintetizar`)
- Modify: `scripts/jarvis_eleven_test.py`
- Note: `jarvis_tts._sintetizar_eleven` já chama `sintetizar` — herda o retry; sem lógica duplicada no cascade

**Interfaces:**
- Consumes: `ElevenErro` com `concorrencia` (status 429)
- Produces: no máximo **2** tentativas HTTP; backoff `random.uniform(0.4, 0.8)` entre elas; se 2ª falhar → propaga `ElevenErro` para o cascade cair no próximo backend

- [ ] **Step 1: Write the failing tests**

```python
import io
import time
import urllib.error


def test_sintetizar_retry_uma_vez_em_429(monkeypatch):
    el = _load()
    monkeypatch.setenv("ELEVENLABS_API_KEY", "fake-key")
    calls = {"n": 0}

    class _Ok:
        def read(self):
            return b"\xff\xfb" + b"\x00" * 1200

    def fake_urlopen(req, timeout=90):
        calls["n"] += 1
        if calls["n"] == 1:
            fp = io.BytesIO(b'{"detail":"rate"}')
            raise urllib.error.HTTPError(
                "https://api.elevenlabs.io/v1/x", 429, "Too Many", hdrs=None, fp=fp
            )
        return _Ok()

    sleeps = []
    monkeypatch.setattr(el.urllib.request, "urlopen", fake_urlopen)
    monkeypatch.setattr(el.time, "sleep", lambda s: sleeps.append(s))
    audio, mime = el.sintetizar("oi")
    assert calls["n"] == 2
    assert mime == "audio/mpeg"
    assert len(audio) > 1000
    assert len(sleeps) == 1
    assert 0.4 <= sleeps[0] <= 0.8


def test_sintetizar_429_duas_vezes_propaga(monkeypatch):
    el = _load()
    monkeypatch.setenv("ELEVENLABS_API_KEY", "fake-key")
    calls = {"n": 0}

    def always_429(req, timeout=90):
        calls["n"] += 1
        fp = io.BytesIO(b"{}")
        raise urllib.error.HTTPError(
            "https://api.elevenlabs.io/v1/x", 429, "Too Many", hdrs=None, fp=fp
        )

    monkeypatch.setattr(el.urllib.request, "urlopen", always_429)
    monkeypatch.setattr(el.time, "sleep", lambda s: None)
    with pytest.raises(el.ElevenErro) as exc:
        el.sintetizar("oi")
    assert exc.value.concorrencia
    assert calls["n"] == 2  # não loop infinito
```

- [ ] **Step 2: Run — expect FAIL**

```powershell
.\.venv\Scripts\python.exe -m pytest scripts/jarvis_eleven_test.py::test_sintetizar_retry_uma_vez_em_429 scripts/jarvis_eleven_test.py::test_sintetizar_429_duas_vezes_propaga -v
```

Expected: FAIL (hoje 1ª 429 já propaga; sem `time.sleep`).

- [ ] **Step 3: Implement em `jarvis_eleven.sintetizar`**

No topo do módulo, garantir:

```python
import random
import time
```

Substituir o bloco HTTP de `sintetizar` (após montar `req`) por:

```python
    tentativas = 2
    ultimo: ElevenErro | None = None
    for i in range(tentativas):
        try:
            audio = urllib.request.urlopen(req, timeout=timeout).read()
            break
        except urllib.error.HTTPError as exc:
            err = _erro_http(exc)
            if err.concorrencia and i + 1 < tentativas:
                time.sleep(random.uniform(0.4, 0.8))
                ultimo = err
                continue
            raise err from exc
        except OSError as exc:  # rede fora, DNS, timeout
            raise ElevenErro(f"rede indisponível: {exc}") from exc
    else:
        raise ultimo or ElevenErro("ElevenLabs 429 sem resposta")

    if not audio:
        raise ElevenErro("ElevenLabs devolveu áudio vazio")
    return audio, mime_de(cfg.output_format)
```

(Remover o `try/except` antigo equivalente.)

- [ ] **Step 4: Run — expect PASS**

```powershell
.\.venv\Scripts\python.exe -m pytest scripts/jarvis_eleven_test.py -v -k "not assinatura and not sintetiza_mp3 and not previous_text_nao"
```

Expected: offline suite PASS (rede continua skip sem chave).

- [ ] **Step 5: Commit** (só se o humano pedir)

```powershell
git add scripts/jarvis_eleven.py scripts/jarvis_eleven_test.py
git commit -m "fix(jarvis-eleven): one retry with backoff on HTTP 429"
```

---

### Task 5: Warmup sem gastar chars ElevenLabs

**Files:**
- Modify: `scripts/jarvis_tts.py` — `backend_warmup()`
- Modify: `scripts/jarvis_qa_server.py` — `_aquecer()`
- Modify: `scripts/jarvis_tts_test.py`

**Interfaces:**
- Consumes: `_edge_ok` / `_piper_ok` / `_sapi_ok`
- Produces: `backend_warmup() -> str | None` — `"edge"|"piper"|"sapi"` ou `None` (só EL disponível → skip TTS no boot)
- `_aquecer()` força `JARVIS_TTS_BACKEND` temporário nesse backend; **nunca** chama EL no warmup

- [ ] **Step 1: Write the failing tests**

```python
def test_backend_warmup_nunca_eleven(monkeypatch):
    jt = _load()
    monkeypatch.setattr(jt, "_edge_ok", lambda: True)
    monkeypatch.setattr(jt, "_piper_ok", lambda: True)
    monkeypatch.setattr(jt, "_sapi_ok", lambda: True)
    assert jt.backend_warmup() == "edge"

    monkeypatch.setattr(jt, "_edge_ok", lambda: False)
    assert jt.backend_warmup() == "piper"

    monkeypatch.setattr(jt, "_piper_ok", lambda: False)
    assert jt.backend_warmup() == "sapi"

    monkeypatch.setattr(jt, "_sapi_ok", lambda: False)
    assert jt.backend_warmup() is None  # só EL → skip


def test_backend_warmup_ignora_eleven_ok(monkeypatch):
    jt = _load()
    monkeypatch.setattr(jt, "_eleven_ok", lambda: True)
    monkeypatch.setattr(jt, "_edge_ok", lambda: False)
    monkeypatch.setattr(jt, "_piper_ok", lambda: False)
    monkeypatch.setattr(jt, "_sapi_ok", lambda: False)
    assert jt.backend_warmup() is None
```

- [ ] **Step 2: Run — expect FAIL**

```powershell
.\.venv\Scripts\python.exe -m pytest scripts/jarvis_tts_test.py::test_backend_warmup_nunca_eleven scripts/jarvis_tts_test.py::test_backend_warmup_ignora_eleven_ok -v
```

Expected: FAIL (`backend_warmup` ausente).

- [ ] **Step 3: Implement helper + `_aquecer`**

Em `scripts/jarvis_tts.py`:

```python
def backend_warmup() -> str | None:
    """Backend para boot/warmup sem gastar caracteres ElevenLabs.

    Ordem: edge → piper → sapi. Se só EL estiver ok, devolve None (skip).
    """
    if _edge_ok():
        return "edge"
    if _piper_ok():
        return "piper"
    if _sapi_ok():
        return "sapi"
    return None
```

Em `scripts/jarvis_qa_server.py`, substituir o bloco TTS de `_aquecer`:

```python
    if jarvis_tts is not None and jarvis_tts.disponivel():
        wk = (
            jarvis_tts.backend_warmup()
            if hasattr(jarvis_tts, "backend_warmup")
            else None
        )
        if wk is None:
            print("voz: skip warmup (evita gastar chars ElevenLabs)", flush=True)
        else:
            old = os.environ.get("JARVIS_TTS_BACKEND")
            try:
                os.environ["JARVIS_TTS_BACKEND"] = wk
                jarvis_tts.sintetizar("Pronto.")
                usado = (
                    jarvis_tts.last_backend()
                    if hasattr(jarvis_tts, "last_backend")
                    else wk
                )
                print(f"voz pronta (warmup={usado})", flush=True)
            except Exception as exc:  # noqa: BLE001
                print(f"aviso: voz nao aqueceu ({exc})", flush=True)
            finally:
                if old is None:
                    os.environ.pop("JARVIS_TTS_BACKEND", None)
                else:
                    os.environ["JARVIS_TTS_BACKEND"] = old
```

Reasoner `ask("aquecimento")` **permanece** (custo TF local).

- [ ] **Step 4: Run — expect PASS**

```powershell
.\.venv\Scripts\python.exe -m pytest scripts/jarvis_tts_test.py::test_backend_warmup_nunca_eleven scripts/jarvis_tts_test.py::test_backend_warmup_ignora_eleven_ok -v
```

- [ ] **Step 5: Commit** (só se o humano pedir)

```powershell
git add scripts/jarvis_tts.py scripts/jarvis_qa_server.py scripts/jarvis_tts_test.py
git commit -m "fix(jarvis-q): warmup TTS without spending ElevenLabs chars"
```

---

### Task 6: Bloco `ELEVENLABS_*` em `.env.example`

**Files:**
- Modify: `.env.example`

**Interfaces:**
- Consumes: § Env do spec (valores de exemplo, sem segredo real)
- Produces: bloco comentado no final do arquivo (ou seção JARVIS-Q)

- [ ] **Step 1: Write the failing smoke**

Em `scripts/jarvis_eleven_test.py`:

```python
def test_env_example_documenta_elevenlabs():
    texto = (ROOT / ".env.example").read_text(encoding="utf-8")
    for chave in (
        "ELEVENLABS_API_KEY",
        "ELEVENLABS_VOICE_ID",
        "ELEVENLABS_MODEL_ID",
        "ELEVENLABS_OUTPUT_FORMAT",
        "ELEVENLABS_LANGUAGE",
        "ELEVENLABS_STABILITY",
        "ELEVENLABS_SIMILARITY",
        "ELEVENLABS_STYLE",
        "ELEVENLABS_SPEED",
        "ELEVENLABS_SEED",
        "JARVIS_TTS",
        "JARVIS_TTS_BACKEND",
        "JARVIS_TTS_VOICE",
        "JARVIS_TTS_PIPER_VOICE",
    ):
        assert chave in texto, chave
    assert "eleven_multilingual_v2" in texto
    assert "lair" in texto
```

- [ ] **Step 2: Run — expect FAIL**

```powershell
.\.venv\Scripts\python.exe -m pytest scripts/jarvis_eleven_test.py::test_env_example_documenta_elevenlabs -v
```

Expected: FAIL (`.env.example` atual não tem o bloco).

- [ ] **Step 3: Append ao final de `.env.example`**

```text
# --- JARVIS-Q TTS (addendum voz) ---
# Chave real só em .env.local (gitignored). Nunca commititar segredo.
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

- [ ] **Step 4: Run — expect PASS**

```powershell
.\.venv\Scripts\python.exe -m pytest scripts/jarvis_eleven_test.py::test_env_example_documenta_elevenlabs -v
```

- [ ] **Step 5: Commit** (só se o humano pedir)

```powershell
git add .env.example scripts/jarvis_eleven_test.py
git commit -m "docs(env): document ELEVENLABS_* and JARVIS_TTS for JARVIS-Q"
```

---

### Task 7: Verificar travas de produto (`lair`, cascade) — só editar se drift

**Files:**
- Test: `scripts/jarvis_eleven_test.py`, `scripts/jarvis_tts_test.py`
- Modify: **somente se** assert falhar — `scripts/jarvis_eleven.py` / `scripts/jarvis_tts.py`

**Interfaces:**
- Consumes: código atual
- Produces: confirmação locked: `VOZ_PADRAO=="lair"`, id `4r3G9XKliGgVZLKMgjik`, `BACKENDS==("eleven","edge","piper","sapi")`, `DEFAULT_EDGE_VOICE` contém `AntonioNeural`

- [ ] **Step 1: Write / reinforce asserts**

```python
# jarvis_eleven_test.py
def test_produto_voz_lair_locked():
    el = _load()
    assert el.VOZ_PADRAO == "lair"
    assert el.VOZES_PT_BR["lair"] == "4r3G9XKliGgVZLKMgjik"
    assert el.MODELO_PADRAO == "eleven_multilingual_v2"
    cfg = el.ElevenConfig.from_env()
    # settings default do spec (sem env override)
    assert cfg.settings.stability == 0.55
    assert cfg.settings.similarity_boost == 0.80
    assert cfg.settings.style == 0.0
    assert cfg.settings.speed == 0.96
    assert cfg.settings.use_speaker_boost is True


# jarvis_tts_test.py
def test_produto_cascade_locked():
    jt = _load()
    assert jt.BACKENDS == ("eleven", "edge", "piper", "sapi")
    assert "AntonioNeural" in jt.DEFAULT_EDGE_VOICE
```

(`test_voz_padrao_e_brasileira` já cobre parte — manter; estes fecham o addendum.)

- [ ] **Step 2: Run**

```powershell
.\.venv\Scripts\python.exe -m pytest scripts/jarvis_eleven_test.py::test_produto_voz_lair_locked scripts/jarvis_tts_test.py::test_produto_cascade_locked -v
```

Expected: **PASS** no código atual (sem drift). Se FAIL → corrigir só o default divergente para bater o spec; não inventar feature nova.

- [ ] **Step 3: Se PASS — nenhuma mudança de produto**

Documentar no PR/commit message (se houver): “locks verified, no code change”.

- [ ] **Step 4: Suite regressão voz (offline)**

```powershell
.\.venv\Scripts\python.exe -m pytest scripts/jarvis_eleven_test.py scripts/jarvis_tts_test.py -v -k "not assinatura and not sintetiza_mp3 and not previous_text_nao and not sintetiza_audio_com_mime and not sintetizar_devolve and not backend_forcado and not cascade_cai"
```

(Ajuste o `-k` conforme necessário para pular só testes de rede / backends opcionais no ambiente.)

Alternativa mais simples no Windows com backends instalados:

```powershell
.\.venv\Scripts\python.exe -m pytest scripts/jarvis_eleven_test.py scripts/jarvis_tts_test.py -v --ignore-glob=* 2>$null
.\.venv\Scripts\python.exe -m pytest scripts/jarvis_eleven_test.py scripts/jarvis_tts_test.py -v
```

Expected: offline PASS; rede skip sem `ELEVENLABS_API_KEY`.

- [ ] **Step 5: Commit** (só se o humano pedir — e só se houve arquivo de teste novo)

```powershell
git add scripts/jarvis_eleven_test.py scripts/jarvis_tts_test.py
git commit -m "test(jarvis-q): lock product defaults lair + EL cascade"
```

---

## Self-review (plan vs spec)

| Gap spec | Task |
|----------|------|
| 1 HUD `previous_text` | Task 1 |
| 2 HUD cota / `tts_aviso` | Task 2 |
| 3 não desligar `ttsLocal` | Task 3 |
| 4 retry 429 | Task 4 |
| 5 warmup sem EL chars | Task 5 |
| 6 `.env.example` `ELEVENLABS_*` | Task 6 |
| 7 travas `lair` + cascade | Task 7 |

- Sem re-planejar `ask()` / RAG.
- Sem placeholders TBD.
- Retry vive em `jarvis_eleven.sintetizar` (uma vez); `jarvis_tts` herda.
- Commit gates explícitos (“só se o humano pedir”).
