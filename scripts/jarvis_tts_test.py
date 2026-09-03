"""Testes da voz do JARVIS-Q.

O modulo virou um cascade (edge-tts -> Piper -> SAPI), entao os testes checam
o CONTRATO — devolve audio util, com o MIME certo para o backend que atendeu —
e nao um formato fixo. Assumir WAV quebrava assim que o edge (MP3) entrava na
frente.

Nada aqui exige rede ou modelo baixado: quando nenhum backend esta disponivel
os testes pulam, para um clone limpo nao ficar vermelho por asset opcional.
"""
from pathlib import Path
import importlib.util
import io
import sys
import wave

import pytest

ROOT = Path(__file__).resolve().parents[1]

MIMES_VALIDOS = {"audio/wav", "audio/mpeg"}


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
        pytest.skip("nenhum backend de voz — pip install edge-tts ou setup_tts.py")
    return jt


def test_disponivel_nao_explode():
    """`disponivel()` roda no /health a cada boot: nunca pode levantar."""
    jt = _load()
    assert isinstance(jt.disponivel(), bool)


def test_desliga_por_env(monkeypatch):
    jt = _load()
    monkeypatch.setenv("JARVIS_TTS", "0")
    assert jt.disponivel() is False


def test_sintetiza_audio_com_mime_coerente():
    """Contrato: bytes não-vazios + MIME que corresponde ao backend que atendeu."""
    jt = _tts_ou_skip()
    out = jt.sintetizar_audio("Savassi sustenta a tese, senhor.")
    assert out.data, "áudio vazio"
    assert out.content_type in MIMES_VALIDOS, out.content_type
    assert out.backend in {"eleven", "edge", "piper", "sapi"}, out.backend

    if out.content_type == "audio/wav":
        # WAV tem header inspecionável: confere que não é silêncio.
        assert out.data[:4] == b"RIFF"
        with wave.open(io.BytesIO(out.data)) as w:
            dur = w.getnframes() / w.getframerate()
        assert 0.3 < dur < 30, f"duração suspeita: {dur:.2f}s"
    else:
        # MP3 do edge-tts: sem header padrão para medir, checa volume mínimo.
        assert len(out.data) > 1000, len(out.data)


def test_sintetizar_devolve_bytes_compat():
    """A porta antiga (só bytes) segue existindo — o server pode ser mais velho."""
    jt = _tts_ou_skip()
    data = jt.sintetizar("Pronto, senhor.")
    assert isinstance(data, (bytes, bytearray)) and len(data) > 1000


def test_texto_vazio_e_erro_explicito():
    jt = _tts_ou_skip()
    for ruim in ("", "   "):
        with pytest.raises(ValueError):
            jt.sintetizar_audio(ruim)


def test_backend_forcado_respeitado(monkeypatch):
    """`JARVIS_TTS_BACKEND` fixa o backend — é como se diagnostica qual falhou."""
    jt = _load()
    for bk in ("eleven", "edge", "piper", "sapi"):
        monkeypatch.setenv("JARVIS_TTS_BACKEND", bk)
        # Reload env-sensitive checks: disponivel() lê os.environ live
        if not jt.disponivel():
            continue
        out = jt.sintetizar_audio("teste")
        assert out.backend == bk, f"pediu {bk}, veio {out.backend}"
        assert out.content_type in MIMES_VALIDOS


def test_cascade_cai_para_o_proximo(monkeypatch):
    """Backend indisponível não pode emudecer: o cascade tenta o seguinte."""
    jt = _tts_ou_skip()
    monkeypatch.setenv("JARVIS_TTS_BACKEND", "auto")
    monkeypatch.setattr(jt, "_eleven_ok", lambda: False)
    monkeypatch.setattr(jt, "_edge_ok", lambda: False)
    out = jt.sintetizar_audio("teste de queda")
    assert out.backend in {"piper", "sapi"}, out.backend
    assert out.data


def test_vozes_disponiveis_sao_qualificadas():
    """Cada voz vem prefixada pelo backend — "faber" sozinho seria ambíguo."""
    jt = _load()
    for v in jt.vozes_disponiveis():
        assert v == "sapi" or v.startswith(("eleven:", "edge:", "piper:")), v


def test_eleven_sem_chave_nao_quebra(monkeypatch):
    jt = _load()
    monkeypatch.delenv("ELEVENLABS_API_KEY", raising=False)
    monkeypatch.setenv("JARVIS_TTS_BACKEND", "eleven")
    assert jt.disponivel() is False
