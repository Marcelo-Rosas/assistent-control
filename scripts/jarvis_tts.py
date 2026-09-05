"""Síntese de voz do JARVIS-Q — ElevenLabs primeiro, degradação explícita.

Ordem (auto):
  1. ElevenLabs (jarvis_eleven) — voz pt-BR de biblioteca, controles completos
  2. edge-tts ``pt-BR-AntonioNeural``
  3. Piper ONNX offline (``data/tts/piper/``)
  4. pyttsx3 / SAPI

Por que manter fallback num sistema "ElevenLabs-first": a API tem três modos
de falha que não dependem de nós — cota esgotada (402), teto de concorrência
do plano (429, 5 simultâneas no multilingual_v2) e rede fora. Emudecer o
assistente nessas horas seria pior que falar com voz inferior. O cascade é
degradação declarada, não indecisão: ``last_backend()`` e o header
``X-Jarvis-TTS-Backend`` dizem sempre quem atendeu, e ``ultimo_erro()`` diz
por que o preferido não atendeu.

``JARVIS_TTS_BACKEND``: ``auto`` | ``eleven`` | ``edge`` | ``piper`` | ``sapi``
``JARVIS_TTS=0`` desliga tudo (HUD → Web Speech).
Config da ElevenLabs (voz, modelo, settings, seed): ver jarvis_eleven.
"""
from __future__ import annotations

import asyncio
import io
import os
import tempfile
import threading
import wave
from dataclasses import dataclass
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
VOICES_DIR = ROOT / "data" / "tts" / "piper"

# Carrega .env local se existir (chave nunca no git — ver .gitignore).
try:
    from dotenv import load_dotenv

    load_dotenv(ROOT / ".env", override=False)
    load_dotenv(ROOT / ".env.local", override=True)
except ImportError:
    pass

try:
    import jarvis_eleven as _eleven
except ImportError:  # pragma: no cover — execução fora de scripts/
    import sys

    sys.path.insert(0, str(Path(__file__).resolve().parent))
    import jarvis_eleven as _eleven

DEFAULT_EDGE_VOICE = os.environ.get("JARVIS_TTS_VOICE", "pt-BR-AntonioNeural")
DEFAULT_PIPER_VOICE = os.environ.get("JARVIS_TTS_PIPER_VOICE", "faber")
EDGE_RATE = os.environ.get("JARVIS_TTS_EDGE_RATE", "-12%")
EDGE_PITCH = os.environ.get("JARVIS_TTS_EDGE_PITCH", "-8Hz")
LENGTH_SCALE = float(os.environ.get("JARVIS_TTS_LENGTH", "1.06"))
SAPI_RATE = int(os.environ.get("JARVIS_TTS_SAPI_RATE", "150"))

_LOCK = threading.Lock()
_CACHE: dict[str, object] = {}
_LAST_BACKEND: str | None = None
_ULTIMO_ERRO: str | None = None

BACKENDS = ("eleven", "edge", "piper", "sapi")


class TTSIndisponivel(RuntimeError):
    """Nenhum backend útil — o chamador cai no fallback Web Speech."""


@dataclass(frozen=True)
class AudioOut:
    data: bytes
    content_type: str  # audio/wav | audio/mpeg | audio/ogg
    backend: str       # eleven | edge | piper | sapi


# --------------------------------------------------------------- disponibilidade
def voice_path(nome: str) -> Path:
    return VOICES_DIR / f"pt_BR-{nome}-medium.onnx"


def _piper_names() -> list[str]:
    if not VOICES_DIR.is_dir():
        return []
    return sorted(
        p.name.removeprefix("pt_BR-").removesuffix("-medium.onnx")
        for p in VOICES_DIR.glob("pt_BR-*-medium.onnx")
    )


def _eleven_ok() -> bool:
    return _eleven.disponivel()


def _edge_ok() -> bool:
    try:
        import edge_tts  # noqa: F401
    except ImportError:
        return False
    return True


def _piper_ok(nome: str | None = None) -> bool:
    try:
        from piper import PiperVoice  # noqa: F401
    except ImportError:
        return False
    return voice_path(nome or DEFAULT_PIPER_VOICE).exists()


def _sapi_ok() -> bool:
    try:
        import pyttsx3  # noqa: F401
    except ImportError:
        return False
    return True


def _check(backend: str) -> bool:
    """Resolve a checagem NO MOMENTO da chamada.

    Um dict {nome: funcao} congelaria as referencias na importacao, e trocar
    `jarvis_tts._eleven_ok` (em teste ou para simular queda) nao teria efeito
    algum sobre o cascade — que e justamente o comportamento que precisa ser
    verificavel.
    """
    fn = globals().get(f"_{backend}_ok")
    return bool(fn and fn())


def backend_pedido() -> str:
    return (os.environ.get("JARVIS_TTS_BACKEND", "auto") or "auto").lower()


def disponivel() -> bool:
    if os.environ.get("JARVIS_TTS", "1") == "0":
        return False
    alvo = backend_pedido()
    if alvo in BACKENDS:
        return _check(alvo)
    return any(_check(b) for b in BACKENDS)


def last_backend() -> str | None:
    return _LAST_BACKEND


def ultimo_erro() -> str | None:
    """Por que o backend preferido não atendeu — diagnóstico sem ler log."""
    return _ULTIMO_ERRO


def vozes_disponiveis() -> list[str]:
    out: list[str] = []
    if _eleven_ok():
        out += [f"eleven:{a}" for a in _eleven.VOZES_PT_BR]
    if _edge_ok():
        out.append(f"edge:{DEFAULT_EDGE_VOICE}")
    out += [f"piper:{n}" for n in _piper_names()]
    if _sapi_ok():
        out.append("sapi")
    return out


# ----------------------------------------------------------------- sintetizadores
def _sintetizar_eleven(
    texto: str, voz: str | None, previous_text: str | None
) -> AudioOut:
    cfg = _eleven.ElevenConfig.from_env()
    if voz:
        alvo = voz.split(":", 1)[1] if voz.startswith("eleven:") else voz
        cfg.voice_id = _eleven.VOZES_PT_BR.get(alvo.lower(), alvo)
    data, mime = _eleven.sintetizar(texto, cfg, previous_text=previous_text)
    return AudioOut(data=data, content_type=mime, backend="eleven")


def _sintetizar_edge(texto: str, voz: str) -> AudioOut:
    import edge_tts

    async def _run() -> bytes:
        communicate = edge_tts.Communicate(texto, voz, rate=EDGE_RATE, pitch=EDGE_PITCH)
        buf = io.BytesIO()
        async for chunk in communicate.stream():
            if chunk["type"] == "audio":
                buf.write(chunk["data"])
        return buf.getvalue()

    data = asyncio.run(_run())
    if not data:
        raise TTSIndisponivel("edge-tts devolveu áudio vazio")
    return AudioOut(data=data, content_type="audio/mpeg", backend="edge")


def _load_piper(nome: str):
    with _LOCK:
        key = f"piper:{nome}"
        if key not in _CACHE:
            from piper import PiperVoice

            caminho = voice_path(nome)
            if not caminho.exists():
                raise TTSIndisponivel(f"modelo ausente: {caminho.name}")
            _CACHE[key] = PiperVoice.load(str(caminho))
        return _CACHE[key]


def _sintetizar_piper(texto: str, nome: str) -> AudioOut:
    modelo = _load_piper(nome)
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        try:
            from piper import SynthesisConfig

            modelo.synthesize_wav(  # type: ignore[attr-defined]
                texto, w, syn_config=SynthesisConfig(length_scale=LENGTH_SCALE)
            )
        except ImportError:
            modelo.synthesize_wav(texto, w)  # type: ignore[attr-defined]
    return AudioOut(data=buf.getvalue(), content_type="audio/wav", backend="piper")


def _pick_sapi_voice(engine) -> str | None:
    voices = engine.getProperty("voices") or []
    ranked: list[tuple[int, object]] = []
    for v in voices:
        blob = (
            (getattr(v, "name", "") or "") + " " + (getattr(v, "id", "") or "")
        ).lower()
        if "daniel" in blob:
            ranked.append((0, v))
        elif any(t in blob for t in ("brazil", "portuguese", "pt-br", "maria")):
            ranked.append((1, v))
    ranked.sort(key=lambda x: x[0])
    if ranked:
        return ranked[0][1].id  # type: ignore[attr-defined]
    return voices[0].id if voices else None


def _sintetizar_sapi(texto: str) -> AudioOut:
    import pyttsx3

    fd, path = tempfile.mkstemp(suffix=".wav")
    os.close(fd)
    try:
        engine = pyttsx3.init()
        engine.setProperty("rate", SAPI_RATE)
        engine.setProperty("volume", 1.0)
        vid = _pick_sapi_voice(engine)
        if vid:
            engine.setProperty("voice", vid)
        engine.save_to_file(texto, path)
        engine.runAndWait()
        data = Path(path).read_bytes()
        if len(data) < 44:
            raise TTSIndisponivel("pyttsx3 gerou WAV vazio")
        return AudioOut(data=data, content_type="audio/wav", backend="sapi")
    finally:
        try:
            os.unlink(path)
        except OSError:
            pass


# ------------------------------------------------------------------------- porta
def sintetizar(texto: str, voz: str | None = None) -> bytes:
    """Compat: só bytes. Prefira ``sintetizar_audio`` para MIME/backend."""
    return sintetizar_audio(texto, voz).data


def sintetizar_audio(
    texto: str,
    voz: str | None = None,
    *,
    previous_text: str | None = None,
) -> AudioOut:
    """Sintetiza pelo primeiro backend que atender, na ordem do cascade.

    `previous_text` é repassado à ElevenLabs como contexto de prosódia; os
    demais backends o ignoram, por não terem o recurso.
    """
    global _LAST_BACKEND, _ULTIMO_ERRO
    if not texto or not texto.strip():
        raise ValueError("texto vazio")
    texto = texto.strip()

    alvo = backend_pedido()
    ordem = [alvo] if alvo in BACKENDS else list(BACKENDS)
    erros: list[str] = []

    for bk in ordem:
        if not _check(bk):
            continue
        try:
            if bk == "eleven":
                out = _sintetizar_eleven(texto, voz, previous_text)
            elif bk == "edge":
                nome = (
                    voz.split(":", 1)[1]
                    if (voz or "").startswith("edge:")
                    else DEFAULT_EDGE_VOICE
                )
                out = _sintetizar_edge(
                    texto, nome if nome.startswith("pt-") else DEFAULT_EDGE_VOICE
                )
            elif bk == "piper":
                nome = (
                    voz.split(":", 1)[1]
                    if (voz or "").startswith("piper:")
                    else DEFAULT_PIPER_VOICE
                )
                out = _sintetizar_piper(texto, nome)
            else:
                out = _sintetizar_sapi(texto)
        except Exception as exc:  # noqa: BLE001 — falha de um backend não derruba o cascade
            # Erro da ElevenLabs vira mensagem acionável: cota, chave e teto de
            # concorrência pedem providências diferentes.
            detalhe = str(exc)
            if bk == "eleven" and isinstance(exc, _eleven.ElevenErro):
                if exc.sem_creditos:
                    detalhe = "créditos esgotados no plano"
                elif exc.chave_invalida:
                    detalhe = "chave inválida ou sem permissão"
                elif exc.concorrencia:
                    detalhe = "teto de requisições simultâneas do plano"
            erros.append(f"{bk}: {detalhe}")
            continue
        _LAST_BACKEND = out.backend
        _ULTIMO_ERRO = "; ".join(erros) or None
        return out

    _ULTIMO_ERRO = "; ".join(erros) or None
    raise TTSIndisponivel(
        "nenhum backend de voz atendeu" + (f" ({_ULTIMO_ERRO})" if _ULTIMO_ERRO else "")
    )
