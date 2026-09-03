"""Testes da voz local (Piper).

Suite separada da jarvis_qa_test porque depende de modelo baixado (~60 MB,
fora do git). Sem o modelo os testes pulam em vez de falhar — um clone novo
nao deve ficar vermelho por causa de um asset opcional.
"""
from pathlib import Path
import importlib.util
import io
import sys
import wave

import pytest

ROOT = Path(__file__).resolve().parents[1]


def _load():
    p = Path(__file__).resolve().parent / "jarvis_tts.py"
    spec = importlib.util.spec_from_file_location("jarvis_tts", p)
    mod = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    sys.modules[spec.name] = mod
    spec.loader.exec_module(mod)
    return mod


def _tts_ou_skip():
    jt = _load()
    if not jt.disponivel():
        pytest.skip("modelo Piper ausente — rode scripts/setup_tts.py")
    return jt


def test_disponivel_nao_explode_sem_modelo():
    """`disponivel()` e chamado pelo /health a cada boot: nunca pode levantar."""
    jt = _load()
    assert isinstance(jt.disponivel(), bool)


def test_desliga_por_env(monkeypatch):
    jt = _load()
    monkeypatch.setenv("JARVIS_TTS", "0")
    assert jt.disponivel() is False


def test_sintetiza_wav_valido():
    jt = _tts_ou_skip()
    data = jt.sintetizar("Savassi sustenta a tese, senhor.")
    assert data[:4] == b"RIFF", "nao e WAV"
    with wave.open(io.BytesIO(data)) as w:
        assert w.getnchannels() == 1
        assert w.getframerate() > 0
        dur = w.getnframes() / w.getframerate()
    # Frase curta: alguns segundos. Zero indica sintese vazia passando batido.
    assert 0.5 < dur < 20, f"duracao suspeita: {dur:.2f}s"


def test_texto_vazio_e_erro_explicito():
    jt = _tts_ou_skip()
    for ruim in ("", "   "):
        with pytest.raises(ValueError):
            jt.sintetizar(ruim)


def test_voz_inexistente_sinaliza_indisponivel():
    """Erro tipado: o server traduz em 503 e o HUD cai para Web Speech."""
    jt = _tts_ou_skip()
    with pytest.raises(jt.TTSIndisponivel):
        jt.sintetizar("teste", voz="nao_existe")


def test_modelo_fica_em_cache():
    """~60 MB e ~1s de load — recarregar por fala inviabilizaria a conversa."""
    jt = _tts_ou_skip()
    jt.sintetizar("um")
    antes = len(jt._CACHE)
    jt.sintetizar("dois")
    assert len(jt._CACHE) == antes


def test_vozes_disponiveis_lista_os_baixados():
    jt = _load()
    vozes = jt.vozes_disponiveis()
    assert isinstance(vozes, list)
    for v in vozes:
        assert jt.voice_path(v).exists()
