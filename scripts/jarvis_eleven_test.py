"""Testes do cliente ElevenLabs.

Divididos entre os que rodam offline (config, MIME, limites, classificação de
erro) e os que tocam a API de verdade. Os de rede pulam sem chave, para um
clone limpo ou um CI sem segredo não ficarem vermelhos.
"""
from pathlib import Path
import importlib.util
import sys
import urllib.error

import pytest

ROOT = Path(__file__).resolve().parents[1]


def _load():
    p = Path(__file__).resolve().parent / "jarvis_eleven.py"
    spec = importlib.util.spec_from_file_location("jarvis_eleven", p)
    mod = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    sys.modules[spec.name] = mod
    spec.loader.exec_module(mod)
    return mod


def _com_chave_ou_skip():
    el = _load()
    if not el.disponivel():
        pytest.skip("ELEVENLABS_API_KEY ausente")
    return el


# ------------------------------------------------------------------ offline
def test_voz_padrao_e_brasileira():
    """O default do quickstart ("George") é voz inglesa e sotaca o português."""
    el = _load()
    assert el.VOZ_PADRAO in el.VOZES_PT_BR
    assert "JBFqnCBsd6RMkjVDRZzb" not in el.VOZES_PT_BR.values()


def test_apelido_de_voz_resolve_para_id(monkeypatch):
    el = _load()
    monkeypatch.setenv("ELEVENLABS_VOICE_ID", "nelton")
    assert el.ElevenConfig.from_env().voice_id == el.VOZES_PT_BR["nelton"]
    # id cru continua valendo
    monkeypatch.setenv("ELEVENLABS_VOICE_ID", "abc123XYZ")
    assert el.ElevenConfig.from_env().voice_id == "abc123XYZ"


def test_voz_vazia_cai_no_padrao(monkeypatch):
    el = _load()
    monkeypatch.setenv("ELEVENLABS_VOICE_ID", "")
    assert el.ElevenConfig.from_env().voice_id == el.VOZES_PT_BR[el.VOZ_PADRAO]


def test_modelo_deprecado_fora_do_catalogo():
    """`eleven_turbo_v2_5` é deprecado (equivale ao flash, porém mais lento)."""
    el = _load()
    assert "eleven_turbo_v2_5" not in el.MODELOS
    assert "eleven_flash_v2_5" in el.MODELOS
    assert "eleven_multilingual_v2" in el.MODELOS


def test_mime_segue_o_formato():
    """Anunciar audio/wav para MP3 quebra o player do HUD."""
    el = _load()
    assert el.mime_de("mp3_44100_128") == "audio/mpeg"
    assert el.mime_de("pcm_24000") == "audio/wav"
    assert el.mime_de("opus_48000_128") == "audio/ogg"
    assert el.mime_de("ulaw_8000") == "audio/basic"


def test_settings_do_ambiente(monkeypatch):
    el = _load()
    monkeypatch.setenv("ELEVENLABS_STABILITY", "0.9")
    monkeypatch.setenv("ELEVENLABS_SPEED", "0.85")
    monkeypatch.setenv("ELEVENLABS_SEED", "42")
    cfg = el.ElevenConfig.from_env()
    assert cfg.settings.stability == 0.9
    assert cfg.settings.speed == 0.85
    assert cfg.seed == 42
    # Valor inválido não pode derrubar o boot — cai no default.
    monkeypatch.setenv("ELEVENLABS_STABILITY", "muito")
    monkeypatch.setenv("ELEVENLABS_SEED", "xyz")
    cfg2 = el.ElevenConfig.from_env()
    assert cfg2.settings.stability == 0.55
    assert cfg2.seed is None


def test_texto_vazio_e_erro():
    el = _load()
    with pytest.raises(ValueError):
        el.sintetizar("   ")


def test_limite_de_caracteres_por_modelo(monkeypatch):
    """Estourar o limite tem de falhar aqui, não gastar crédito na API."""
    el = _load()
    monkeypatch.setenv("ELEVENLABS_API_KEY", "fake-para-passar-da-checagem")
    monkeypatch.setenv("ELEVENLABS_MODEL_ID", "eleven_v3")  # limite 5.000
    with pytest.raises(el.ElevenErro) as exc:
        el.sintetizar("a" * 5001)
    assert "excede o limite" in str(exc.value)


def test_erro_classifica_status():
    """O cascade decide pelo status: cota, chave e concorrência diferem."""
    el = _load()
    assert el.ElevenErro("x", status=402).sem_creditos
    assert el.ElevenErro("x", status=401).chave_invalida
    assert el.ElevenErro("x", status=403).chave_invalida
    assert el.ElevenErro("x", status=429).concorrencia
    # quota também chega como texto no corpo
    assert el.ElevenErro("x", status=400, corpo="quota_exceeded").sem_creditos
    assert not el.ElevenErro("x", status=500).sem_creditos


def test_sem_chave_erro_tipado(monkeypatch):
    el = _load()
    monkeypatch.delenv("ELEVENLABS_API_KEY", raising=False)
    assert el.disponivel() is False
    with pytest.raises(el.ElevenErro):
        el.sintetizar("teste")


# -------------------------------------------------------------------- rede
def test_assinatura_traz_cota():
    el = _com_chave_ou_skip()
    info = el.assinatura()
    assert info["limite"] > 0
    assert info["restantes"] <= info["limite"]
    assert info["tier"]


def test_sintetiza_mp3_real():
    el = _com_chave_ou_skip()
    audio, mime = el.sintetizar("Pronto, senhor.")
    assert mime == "audio/mpeg"
    assert audio[:3] == b"ID3" or audio[0] == 0xFF, "não parece MP3"
    assert len(audio) > 1000


def test_previous_text_nao_quebra():
    """Continuidade prosódica: o parâmetro é aceito e o áudio continua válido."""
    el = _com_chave_ou_skip()
    audio, _ = el.sintetizar(
        "Cruzo com aluguel ou renda?",
        previous_text="Savassi sustenta a tese, senhor.",
    )
    assert len(audio) > 1000
