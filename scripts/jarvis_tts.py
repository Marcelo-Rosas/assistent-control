"""Síntese de voz do JARVIS-Q — cascade.

Ordem (auto):
  1. ElevenLabs (se ``ELEVENLABS_API_KEY``) — voz de biblioteca / tua, **não** clone MCU
  2. edge-tts ``pt-BR-AntonioNeural`` (−12% / −8Hz)
  3. Piper ONNX offline (``data/tts/piper/``)
  4. pyttsx3 / SAPI

``JARVIS_TTS_BACKEND``: ``auto`` | ``eleven`` | ``edge`` | ``piper`` | ``sapi``
``JARVIS_TTS=0`` desliga tudo (HUD → Web Speech).
``ELEVENLABS_VOICE_ID`` — id da Voice Library (default George do quickstart).
``JARVIS_TTS_VOICE`` — sobrescreve voz edge (pt-BR-…).
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

DEFAULT_EDGE_VOICE = os.environ.get("JARVIS_TTS_VOICE", "pt-BR-AntonioNeural")
DEFAULT_PIPER_VOICE = os.environ.get("JARVIS_TTS_PIPER_VOICE", "faber")
# Quickstart ElevenLabs: "George". Troca na Voice Library por voz PT-BR se quiser.
DEFAULT_ELEVEN_VOICE = os.environ.get("ELEVENLABS_VOICE_ID", "JBFqnCBsd6RMkjVDRZzb")
ELEVEN_MODEL = os.environ.get("ELEVENLABS_MODEL_ID", "eleven_multilingual_v2")
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
    backend: str       # eleven | edge | piper | sapi


def voice_path(nome: str) -> Path:
    return VOICES_DIR / f"pt_BR-{nome}-medium.onnx"


def vozes_disponiveis() -> list[str]:
    out: list[str] = []
    if _eleven_ok():
        out.append(f"eleven:{DEFAULT_ELEVEN_VOICE}")
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


def _eleven_api_key() -> str | None:
    key = (os.environ.get("ELEVENLABS_API_KEY") or "").strip()
    return key or None


def _eleven_ok() -> bool:
    if not _eleven_api_key():
        return False
    try:
        import elevenlabs  # noqa: F401
    except ImportError:
        return False
    return True


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
    if backend == "eleven":
        return _eleven_ok()
    if backend == "edge":
        return _edge_ok()
    if backend == "piper":
        return _piper_ok()
    if backend == "sapi":
        return _sapi_ok()
    return _eleven_ok() or _edge_ok() or _piper_ok() or _sapi_ok()


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


def _collect_audio_chunks(audio) -> bytes:
    """SDK pode devolver generator/iterator de bytes ou bytes únicos."""
    if isinstance(audio, (bytes, bytearray)):
        return bytes(audio)
    buf = io.BytesIO()
    for chunk in audio:
        if isinstance(chunk, (bytes, bytearray)):
            buf.write(chunk)
    return buf.getvalue()


def _sintetizar_eleven(texto: str, voice_id: str) -> AudioOut:
    from elevenlabs.client import ElevenLabs

    client = ElevenLabs(api_key=_eleven_api_key())
    audio = client.text_to_speech.convert(
        text=texto,
        voice_id=voice_id,
        model_id=ELEVEN_MODEL,
        output_format="mp3_44100_128",
    )
    data = _collect_audio_chunks(audio)
    if not data:
        raise TTSIndisponivel("ElevenLabs devolveu áudio vazio")
    return AudioOut(data=data, content_type="audio/mpeg", backend="eleven")


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

    def try_eleven() -> AudioOut | None:
        if not _eleven_ok():
            return None
        if voz and (
            voz.startswith("pt-BR-")
            or voz.startswith("piper:")
            or voz.startswith("edge:")
            or voz == "sapi"
        ):
            return None
        voice_id = DEFAULT_ELEVEN_VOICE
        if voz and voz.startswith("eleven:"):
            voice_id = voz.split(":", 1)[1]
        elif voz and len(voz) >= 16 and "-" not in voz[:5]:
            # id cru da library
            voice_id = voz
        try:
            return _sintetizar_eleven(texto, voice_id)
        except Exception as exc:  # noqa: BLE001
            errors.append(f"eleven:{exc}")
            return None

    def try_edge() -> AudioOut | None:
        if not _edge_ok():
            return None
        if voz and voz.startswith("piper:"):
            return None
        if voz and voz == "sapi":
            return None
        if voz and voz.startswith("eleven:"):
            return None
        name = voz if (voz and voz.startswith("pt-BR-")) else DEFAULT_EDGE_VOICE
        if voz and voz.startswith("edge:"):
            name = voz.split(":", 1)[1]
        try:
            return _sintetizar_edge(
                texto, name if name.startswith("pt-") else DEFAULT_EDGE_VOICE
            )
        except Exception as exc:  # noqa: BLE001
            errors.append(f"edge:{exc}")
            return None

    def try_piper() -> AudioOut | None:
        nome = DEFAULT_PIPER_VOICE
        if voz and voz.startswith("piper:"):
            nome = voz.split(":", 1)[1]
        elif voz and not voz.startswith("pt-") and voz not in ("sapi",) and not (
            voz.startswith("eleven:") or voz.startswith("edge:")
        ):
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
    if backend == "eleven":
        order = [try_eleven]
    elif backend == "edge":
        order = [try_edge]
    elif backend == "piper":
        order = [try_piper]
    elif backend == "sapi":
        order = [try_sapi]
    else:
        order = [try_eleven, try_edge, try_piper, try_sapi]

    for fn in order:
        out = fn()
        if out is not None:
            _LAST_BACKEND = out.backend
            return out

    if voz and voz not in ("sapi",) and not voz.startswith(
        ("pt-", "piper:", "eleven:", "edge:")
    ):
        raise TTSIndisponivel(f"voz indisponível: {voz}")

    raise TTSIndisponivel(
        "nenhum backend TTS disponível: "
        + ("; ".join(errors) or "defina ELEVENLABS_API_KEY ou use edge-tts")
    )
