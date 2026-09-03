"""Sintese de voz local do JARVIS-Q via Piper (ONNX, offline).

Por que Piper e nao a Web Speech API: as unicas vozes pt-BR desta maquina sao
`Microsoft Daniel` e `Maria`, ambas SAPI5 legadas — nenhum ajuste de pitch ou
cadencia as aproxima do registro que queremos. Piper roda modelo neural local,
sem rede, sem custo por uso e sem mandar o texto para fora, o que mantem o
desenho do JARVIS-Q (local, auditavel) intacto.

Nao clona a voz de nenhuma pessoa real: usa vozes pt-BR publicas do projeto
piper-voices, escolhidas pelo registro (masculina, grave, calma).

O modelo carregado fica em cache no processo — sao ~60 MB e ~1s de load, caro
demais para repetir por fala.
"""
from __future__ import annotations

import io
import os
import threading
import wave
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
VOICES_DIR = ROOT / "data" / "tts" / "piper"

# Voz padrao. `JARVIS_TTS_VOICE` troca sem editar codigo.
DEFAULT_VOICE = os.environ.get("JARVIS_TTS_VOICE", "faber")

# Cadencia do mordomo: um pouco mais lento que o natural do modelo. Acima de
# ~1.15 a fala arrasta e soa artificial; abaixo de 1.0 fica apressada.
LENGTH_SCALE = float(os.environ.get("JARVIS_TTS_LENGTH", "1.06"))

_LOCK = threading.Lock()
_CACHE: dict[str, object] = {}


class TTSIndisponivel(RuntimeError):
    """Piper ausente ou modelo nao baixado — o chamador deve cair no fallback."""


def voice_path(nome: str) -> Path:
    return VOICES_DIR / f"pt_BR-{nome}-medium.onnx"


def vozes_disponiveis() -> list[str]:
    if not VOICES_DIR.is_dir():
        return []
    return sorted(
        p.name.removeprefix("pt_BR-").removesuffix("-medium.onnx")
        for p in VOICES_DIR.glob("pt_BR-*-medium.onnx")
    )


def _load(nome: str):
    with _LOCK:
        if nome not in _CACHE:
            try:
                from piper import PiperVoice
            except ImportError as exc:  # pragma: no cover
                raise TTSIndisponivel("pacote piper-tts nao instalado") from exc
            caminho = voice_path(nome)
            if not caminho.exists():
                raise TTSIndisponivel(f"modelo ausente: {caminho.name}")
            _CACHE[nome] = PiperVoice.load(str(caminho))
        return _CACHE[nome]


def disponivel() -> bool:
    """Checa sem sintetizar — usado pelo /health para o HUD decidir o caminho."""
    if os.environ.get("JARVIS_TTS", "1") == "0":
        return False
    try:
        from piper import PiperVoice  # noqa: F401
    except ImportError:
        return False
    return voice_path(DEFAULT_VOICE).exists()


def sintetizar(texto: str, voz: str | None = None) -> bytes:
    """Devolve um WAV completo (com header) pronto para <audio>.

    Escreve num buffer em memoria: o audio e pequeno (dezenas de KB) e gravar
    em disco a cada fala criaria lixo e uma corrida entre requisicoes.
    """
    if not texto or not texto.strip():
        raise ValueError("texto vazio")
    nome = voz or DEFAULT_VOICE
    modelo = _load(nome)

    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        try:
            from piper import SynthesisConfig

            modelo.synthesize_wav(  # type: ignore[attr-defined]
                texto, w, syn_config=SynthesisConfig(length_scale=LENGTH_SCALE)
            )
        except ImportError:
            # Piper antigo, sem SynthesisConfig: cadencia fica a do modelo.
            modelo.synthesize_wav(texto, w)  # type: ignore[attr-defined]
    return buf.getvalue()
