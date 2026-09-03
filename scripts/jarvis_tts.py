"""Síntese de voz do JARVIS-Q — cascade local/online.

Ordem (auto):
  1. edge-tts ``pt-BR-AntonioNeural`` (grave, net) — voz preferida do smoke
  2. Piper ONNX offline (se modelo em ``data/tts/piper/``)
  3. pyttsx3 / SAPI (Maria ou Daniel no Windows)

``JARVIS_TTS_BACKEND`` força: ``auto`` | ``edge`` | ``piper`` | ``sapi``.
``JARVIS_TTS=0`` desliga tudo (HUD cai na Web Speech).
``JARVIS_TTS_VOICE`` sobrescreve o id da voz (edge name / piper faber / sapi).
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

DEFAULT_EDGE_VOICE = os.environ.get("JARVIS_TTS_VOICE", "pt-BR-AntonioNeural")
DEFAULT_PIPER_VOICE = os.environ.get("JARVIS_TTS_PIPER_VOICE", "faber")
# Cadência mordomo (smoke): rate −12%, pitch −8Hz
EDGE_RATE = os.environ.get("JARVIS_TTS_EDGE_RATE", "-12%")
EDGE_PITCH = os.environ.get("JARVIS_TTS_EDGE_PITCH", "-8Hz")
LENGTH_SCALE = float(os.environ.get("JARVIS_TTS_LENGTH", "1.06"))
SAPI_RATE = int(os.environ.get("JARVIS_TTS_SAPI_RATE", "150"))

_LOCK = threading.Lock()
_CACHE: dict[str, object] = {}
_LAST_BACKEND: str | None = None


class TTSIndisponivel(RuntimeError):
    """Nenhum backend útil — o chamador cai no fallback Web Speech."""


@dataclass(frozen=True)
class AudioOut:
    data: bytes
    content_type: str  # audio/wav | audio/mpeg
    backend: str       # edge | piper | sapi


def voice_path(nome: str) -> Path:
    return VOICES_DIR / f"pt_BR-{nome}-medium.onnx"


def vozes_disponiveis() -> list[str]:
    out: list[str] = []
    if _edge_ok():
        out.append(f"edge:{DEFAULT_EDGE_VOICE}")
    for nome in _piper_names():
        out.append(f"piper:{nome}")
    if _sapi_ok():
        out.append("sapi")
    return out


def _piper_names() -> list[str]:
    if not VOICES_DIR.is_dir():
        return []
    return sorted(
        p.name.removeprefix("pt_BR-").removesuffix("-medium.onnx")
        for p in VOICES_DIR.glob("pt_BR-*-medium.onnx")
    )


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


def disponivel() -> bool:
    if os.environ.get("JARVIS_TTS", "1") == "0":
        return False
    backend = os.environ.get("JARVIS_TTS_BACKEND", "auto").lower()
    if backend == "edge":
        return _edge_ok()
    if backend == "piper":
        return _piper_ok()
    if backend == "sapi":
        return _sapi_ok()
    return _edge_ok() or _piper_ok() or _sapi_ok()


def last_backend() -> str | None:
    return _LAST_BACKEND


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


def _sintetizar_edge(texto: str, voz: str) -> AudioOut:
    import edge_tts

    async def _run() -> bytes:
        communicate = edge_tts.Communicate(
            texto, voz, rate=EDGE_RATE, pitch=EDGE_PITCH
        )
        buf = io.BytesIO()
        async for chunk in communicate.stream():
            if chunk["type"] == "audio":
                buf.write(chunk["data"])
        return buf.getvalue()

    data = asyncio.run(_run())
    if not data:
        raise TTSIndisponivel("edge-tts devolveu áudio vazio")
    return AudioOut(data=data, content_type="audio/mpeg", backend="edge")


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
    # Preferência masculina PT se existir; senão qualquer Brazil/Portuguese.
    ranked: list[tuple[int, object]] = []
    for v in voices:
        n = (getattr(v, "name", "") or "").lower()
        vid = (getattr(v, "id", "") or "").lower()
        blob = n + " " + vid
        if "daniel" in blob:
            ranked.append((0, v))
        elif "brazil" in blob or "portuguese" in blob or "pt-br" in blob or "maria" in blob:
            ranked.append((1, v))
    ranked.sort(key=lambda x: x[0])
    if ranked:
        return ranked[0][1].id  # type: ignore[attr-defined]
    return voices[0].id if voices else None


def _sintetizar_sapi(texto: str) -> AudioOut:
    import pyttsx3

    # SAPI no Windows grava melhor em arquivo do que em buffer puro.
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


def sintetizar(texto: str, voz: str | None = None) -> bytes:
    """Compat: devolve só bytes. Prefer ``sintetizar_audio`` para MIME/backend."""
    return sintetizar_audio(texto, voz).data


def sintetizar_audio(texto: str, voz: str | None = None) -> AudioOut:
    global _LAST_BACKEND
    if not texto or not texto.strip():
        raise ValueError("texto vazio")
    texto = texto.strip()
    backend = os.environ.get("JARVIS_TTS_BACKEND", "auto").lower()

    errors: list[str] = []

    def try_edge() -> AudioOut | None:
        if not _edge_ok():
            return None
        name = voz if (voz and voz.startswith("pt-BR-")) else (voz or DEFAULT_EDGE_VOICE)
        if voz and voz.startswith("piper:"):
            return None
        if voz and voz == "sapi":
            return None
        try:
            return _sintetizar_edge(texto, name if name.startswith("pt-") else DEFAULT_EDGE_VOICE)
        except Exception as exc:  # noqa: BLE001
            errors.append(f"edge:{exc}")
            return None

    def try_piper() -> AudioOut | None:
        nome = DEFAULT_PIPER_VOICE
        if voz and voz.startswith("piper:"):
            nome = voz.split(":", 1)[1]
        elif voz and not voz.startswith("pt-") and voz != "sapi":
            # nome curto estilo faber
            if voice_path(voz).exists():
                nome = voz
        if not _piper_ok(nome):
            return None
        try:
            return _sintetizar_piper(texto, nome)
        except Exception as exc:  # noqa: BLE001
            errors.append(f"piper:{exc}")
            return None

    def try_sapi() -> AudioOut | None:
        if not _sapi_ok():
            return None
        try:
            return _sintetizar_sapi(texto)
        except Exception as exc:  # noqa: BLE001
            errors.append(f"sapi:{exc}")
            return None

    order: list
    if backend == "edge":
        order = [try_edge]
    elif backend == "piper":
        order = [try_piper]
    elif backend == "sapi":
        order = [try_sapi]
    else:
        # auto: Antonio (jarvis-like) → Piper offline → SAPI
        order = [try_edge, try_piper, try_sapi]

    for fn in order:
        out = fn()
        if out is not None:
            _LAST_BACKEND = out.backend
            return out

    if voz and voz not in ("sapi",) and not voz.startswith("pt-") and not voz.startswith("piper:"):
        # voz pedida inexistente (compat testes Piper)
        raise TTSIndisponivel(f"voz indisponível: {voz}")

    raise TTSIndisponivel(
        "nenhum backend TTS disponível: " + ("; ".join(errors) or "instale edge-tts ou pyttsx3")
    )
