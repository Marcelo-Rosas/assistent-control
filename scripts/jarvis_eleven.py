"""Cliente ElevenLabs do JARVIS-Q — cobertura completa da API de TTS.

Módulo dedicado, separado de `jarvis_tts` (que orquestra o cascade). Aqui mora
tudo que é específico da ElevenLabs: modelos, voice settings, continuidade
prosódica, determinismo e a tradução de erro HTTP em erro tipado.

Chamamos a REST diretamente em vez do SDK. Motivo: o SDK esconde o status
HTTP dentro de exceções genéricas, e aqui a diferença entre 401 (chave),
429 (concorrência) e 402 (créditos) decide coisas distintas — cair para o
próximo backend, esperar, ou avisar o usuário. Sem o status, todo erro vira
"falhou" e o cascade não sabe o que fazer.

Configuração por ambiente (todas opcionais menos a chave):

    ELEVENLABS_API_KEY        obrigatória
    ELEVENLABS_VOICE_ID       voz padrão (ver VOZES_PT_BR)
    ELEVENLABS_MODEL_ID       eleven_multilingual_v2 (default) | eleven_flash_v2_5 | eleven_v3
    ELEVENLABS_OUTPUT_FORMAT  mp3_44100_128 (default)
    ELEVENLABS_STABILITY      0.0–1.0  (default 0.55)
    ELEVENLABS_SIMILARITY     0.0–1.0  (default 0.80)
    ELEVENLABS_STYLE          0.0–1.0  (default 0.0)
    ELEVENLABS_SPEED          0.7–1.2  (default 0.96)
    ELEVENLABS_SEED           inteiro; fixa a saída entre execuções
"""
from __future__ import annotations

import json
import os
import random
import time
import urllib.error
import urllib.request
from dataclasses import dataclass, field

API = "https://api.elevenlabs.io/v1"

# Carrega .env por conta propria: este modulo e usavel sem passar por
# jarvis_tts (testes, scripts, REPL) e depende da chave para qualquer coisa.
try:
    from dotenv import load_dotenv

    _RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    load_dotenv(os.path.join(_RAIZ, ".env"), override=False)
    load_dotenv(os.path.join(_RAIZ, ".env.local"), override=True)
except ImportError:  # pragma: no cover
    pass

# Vozes masculinas pt-BR da Voice Library, com sotaque brasileiro nativo.
# O default do quickstart ("George", JBFqnCBsd6RMkjVDRZzb) é voz INGLESA e
# pronuncia português com sotaque anglófono — não serve a um assistente pt-BR.
VOZES_PT_BR: dict[str, str] = {
    "lair": "4r3G9XKliGgVZLKMgjik",      # elegante, direta
    "nelton": "EIkHVdkuarjkYUyMnoes",    # grave, suave
    "eliel": "y3X5crcIDtFawPx7bcNq",     # grave, rascante
    "rafael": "AxmQsSdsz8MlV0gY8pKp",    # severo, moderno
    "davi": "2CECaLAGTS5NRGxgbcxr",
    "guilherme": "GnDrTQvdzZ7wqAKfLzVQ",
    "flavio": "x6uRgOliu4lpcrqMH3s1",
    "randel": "jkiD8IhCU1i2V7VvmNwi",
}
VOZ_PADRAO = "lair"

# Modelos vigentes. `eleven_turbo_v2_5` está DEPRECADO na doc (equivalente ao
# flash, porém mais lento) e por isso não aparece aqui.
MODELOS = {
    "eleven_multilingual_v2": {"latencia": "padrão", "idiomas": 29, "limite": 10_000},
    "eleven_flash_v2_5": {"latencia": "~75ms", "idiomas": 32, "limite": 40_000},
    "eleven_v3": {"latencia": "padrão", "idiomas": 70, "limite": 5_000},
}
MODELO_PADRAO = "eleven_multilingual_v2"


class ElevenErro(RuntimeError):
    """Falha da API com o status preservado, para o cascade decidir."""

    def __init__(self, msg: str, status: int | None = None, corpo: str = "") -> None:
        super().__init__(msg)
        self.status = status
        self.corpo = corpo

    @property
    def sem_creditos(self) -> bool:
        return self.status == 402 or "quota" in self.corpo.lower()

    @property
    def chave_invalida(self) -> bool:
        return self.status in (401, 403)

    @property
    def concorrencia(self) -> bool:
        """429: plano Creator permite 5 simultâneas em multilingual_v2."""
        return self.status == 429


@dataclass(frozen=True)
class VoiceSettings:
    """Controles de entrega.

    Defaults calibrados para o registro do JARVIS — mordomo contido:
    estabilidade acima do meio (a doc associa estabilidade alta à ancoragem na
    gravação original, e o modo criativo a expressividade imprevisível), estilo
    zero (exagero de estilo destoa de fala formal) e velocidade levemente
    abaixo de 1.0.
    """

    stability: float = 0.55
    similarity_boost: float = 0.80
    style: float = 0.0
    use_speaker_boost: bool = True
    speed: float = 0.96

    def to_payload(self) -> dict:
        return {
            "stability": self.stability,
            "similarity_boost": self.similarity_boost,
            "style": self.style,
            "use_speaker_boost": self.use_speaker_boost,
            "speed": self.speed,
        }


@dataclass
class ElevenConfig:
    voice_id: str = ""
    model_id: str = MODELO_PADRAO
    output_format: str = "mp3_44100_128"
    language_code: str | None = "pt"
    seed: int | None = None
    settings: VoiceSettings = field(default_factory=VoiceSettings)

    @classmethod
    def from_env(cls) -> "ElevenConfig":
        def _f(nome: str, padrao: float) -> float:
            try:
                return float(os.environ[nome])
            except (KeyError, ValueError):
                return padrao

        voz = (os.environ.get("ELEVENLABS_VOICE_ID") or "").strip()
        # Aceita apelido ("nelton") ou id cru — o apelido evita id mágico solto
        # em config e torna óbvio, na leitura, qual voz está no ar.
        voice_id = VOZES_PT_BR.get(voz.lower(), voz) or VOZES_PT_BR[VOZ_PADRAO]

        seed_raw = (os.environ.get("ELEVENLABS_SEED") or "").strip()
        try:
            seed = int(seed_raw) if seed_raw else None
        except ValueError:
            seed = None

        return cls(
            voice_id=voice_id,
            model_id=(os.environ.get("ELEVENLABS_MODEL_ID") or MODELO_PADRAO).strip(),
            output_format=(
                os.environ.get("ELEVENLABS_OUTPUT_FORMAT") or "mp3_44100_128"
            ).strip(),
            language_code=(os.environ.get("ELEVENLABS_LANGUAGE") or "pt").strip() or None,
            seed=seed,
            settings=VoiceSettings(
                stability=_f("ELEVENLABS_STABILITY", 0.55),
                similarity_boost=_f("ELEVENLABS_SIMILARITY", 0.80),
                style=_f("ELEVENLABS_STYLE", 0.0),
                speed=_f("ELEVENLABS_SPEED", 0.96),
            ),
        )


def api_key() -> str | None:
    return (os.environ.get("ELEVENLABS_API_KEY") or "").strip() or None


def disponivel() -> bool:
    return api_key() is not None


def mime_de(output_format: str) -> str:
    """MIME derivado do formato pedido — anunciar WAV para MP3 quebra o player."""
    if output_format.startswith("mp3"):
        return "audio/mpeg"
    if output_format.startswith("opus"):
        return "audio/ogg"
    if output_format.startswith("pcm") or output_format.startswith("wav"):
        return "audio/wav"
    if output_format.startswith(("ulaw", "alaw")):
        return "audio/basic"
    return "application/octet-stream"


def _erro_http(exc: urllib.error.HTTPError) -> ElevenErro:
    try:
        corpo = exc.read().decode("utf-8", "replace")[:400]
    except Exception:  # noqa: BLE001
        corpo = ""
    return ElevenErro(f"ElevenLabs HTTP {exc.code}", status=exc.code, corpo=corpo)


def sintetizar(
    texto: str,
    cfg: ElevenConfig | None = None,
    *,
    previous_text: str | None = None,
    next_text: str | None = None,
    timeout: int = 90,
) -> tuple[bytes, str]:
    """Sintetiza e devolve (áudio, mime).

    `previous_text` é o turno anterior da conversa. A API o usa como contexto
    de prosódia: sem ele cada resposta é entoada como se fosse a primeira
    frase dita, o que soa recortado num diálogo de vários turnos.
    """
    if not texto or not texto.strip():
        raise ValueError("texto vazio")
    key = api_key()
    if not key:
        raise ElevenErro("ELEVENLABS_API_KEY ausente")

    cfg = cfg or ElevenConfig.from_env()
    limite = MODELOS.get(cfg.model_id, {}).get("limite", 5_000)
    if len(texto) > limite:
        raise ElevenErro(
            f"texto com {len(texto)} caracteres excede o limite "
            f"{limite} de {cfg.model_id}"
        )

    payload: dict = {
        "text": texto.strip(),
        "model_id": cfg.model_id,
        "voice_settings": cfg.settings.to_payload(),
    }
    if cfg.language_code:
        payload["language_code"] = cfg.language_code
    if cfg.seed is not None:
        payload["seed"] = cfg.seed
    if previous_text:
        payload["previous_text"] = previous_text[-800:]
    if next_text:
        payload["next_text"] = next_text[:800]

    url = f"{API}/text-to-speech/{cfg.voice_id}?output_format={cfg.output_format}"
    req = urllib.request.Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        headers={"xi-api-key": key, "Content-Type": "application/json"},
    )
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


def assinatura() -> dict:
    """Cota e tier da conta — para o /health mostrar o que resta."""
    key = api_key()
    if not key:
        raise ElevenErro("ELEVENLABS_API_KEY ausente")
    req = urllib.request.Request(
        f"{API}/user/subscription", headers={"xi-api-key": key}
    )
    try:
        d = json.load(urllib.request.urlopen(req, timeout=30))
    except urllib.error.HTTPError as exc:
        raise _erro_http(exc) from exc
    except OSError as exc:
        raise ElevenErro(f"rede indisponível: {exc}") from exc

    usados = d.get("character_count") or 0
    limite = d.get("character_limit") or 0
    return {
        "tier": d.get("tier"),
        "usados": usados,
        "limite": limite,
        "restantes": max(limite - usados, 0),
        "pct_usado": round(100 * usados / limite, 1) if limite else None,
    }
