"""Unit tests — jarvis_rag penetração (sem rede)."""
from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def _load():
    p = Path(__file__).resolve().parent / "jarvis_rag.py"
    spec = importlib.util.spec_from_file_location("jarvis_rag", p)
    mod = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    sys.modules[spec.name] = mod
    spec.loader.exec_module(mod)
    return mod


def test_normalize_bairro_slug():
    jr = _load()
    assert jr.normalize_bairro_slug("Paraíso") == "paraiso"
    assert jr.normalize_bairro_slug("Bela Vista") == "bela-vista"
    assert jr.normalize_bairro_slug("SÉ / Centro") == "se-centro"


def test_normalize_bairro_receita():
    jr = _load()
    assert jr.normalize_bairro_receita("paraíso") == "PARAISO"
    assert jr.normalize_bairro_receita("bela-vista") == "BELA VISTA"


def test_bairro_filter_variants_unique():
    jr = _load()
    v = jr.bairro_filter_variants("Paraíso")
    assert "paraiso" in v
    assert "PARAISO" in v
    assert len(v) == len(set(v))


def test_cidade_filter_variants_canon():
    jr = _load()
    assert jr.normalize_cidade_canon("sao paulo") == "São Paulo"
    assert jr.normalize_cidade_canon("Belo Horizonte") == "Belo Horizonte"
    v = jr.cidade_filter_variants("Sao Paulo")
    assert "São Paulo" in v
    assert "Sao Paulo" in v or "Sao paulo" in v or any(
        "paulo" in x.casefold() for x in v
    )


def test_bairro_ambiguo():
    jr = _load()
    assert jr.bairro_ambiguo("Paraíso") is True
    assert jr.bairro_ambiguo("centro") is True
    assert jr.bairro_ambiguo("Savassi") is False


def test_academia_key_prefers_cnpj_then_gym_id():
    jr = _load()
    assert (
        jr.academia_key({"meta": {"cnpj": "123", "nome_academia": "X"}, "source_ref": "y"})
        == "123"
    )
    assert (
        jr.academia_key({"meta": {"gym_id": "gid1", "nome_academia": "X"}}) == "gid1"
    )
    assert jr.academia_key({"meta": {"nome_academia": "Studio X"}}) == "studio x"
    assert jr.academia_key({"source_ref": "ref-1", "meta": {}}) == "ref-1"
    assert jr.academia_key({"meta": {}}) is None


def test_narrar_penetracao_lider_e_pct():
    jr = _load()
    texto = jr.narrar_penetracao(
        {
            "bairro": "paraíso",
            "cidade": "São Paulo",
            "cidade_canon": "São Paulo",
            "geo_scope": "cidade",
            "mesmo_escopo": True,
            "counts": {
                "totalpass": 4,
                "wellhub": 10,
                "gurupass": 0,
                "receita": 27,
            },
            "planos_top": {
                "totalpass": "TP 1",
                "wellhub": "Wellhub Basic",
                "gurupass": None,
                "receita": None,
            },
        }
    )
    assert "TotalPass 4" in texto
    assert "Wellhub 10" in texto
    assert "GuruPass 0" in texto
    assert "universo Receita 27" in texto
    assert "Maior cobertura: Wellhub" in texto
    assert "Wellhub Basic" in texto
    assert "%" in texto
    assert "São Paulo" in texto


def test_narrar_penetracao_wh_maior_que_receita():
    jr = _load()
    texto = jr.narrar_penetracao(
        {
            "bairro": "paraíso",
            "cidade": "São Paulo",
            "geo_scope": "cidade",
            "mesmo_escopo": True,
            "counts": {"totalpass": 0, "wellhub": 25, "gurupass": 0, "receita": 17},
            "planos_top": {},
        }
    )
    assert "Universo parcial" in texto
    assert "Cobertura vs censo: 25/17" in texto
    assert "geo incompleta" in texto
    assert "omitida" in texto
    assert "cerca de" not in texto
    assert "%" not in texto or "% de mercado omitida" in texto


def test_narrar_penetracao_tp_maior_que_receita_sem_wh():
    jr = _load()
    texto = jr.narrar_penetracao(
        {
            "bairro": "paraíso",
            "cidade": "São Paulo",
            "geo_scope": "cidade",
            "mesmo_escopo": True,
            "counts": {"totalpass": 4, "wellhub": 0, "gurupass": 0, "receita": 2},
            "planos_top": {},
        }
    )
    assert "Universo parcial" in texto
    assert "Cobertura vs censo: 4/2" in texto
    assert "omitida" in texto
    assert "cerca de" not in texto


def test_narrar_penetracao_sem_receita():
    jr = _load()
    texto = jr.narrar_penetracao(
        {
            "bairro": "savassi",
            "cidade": "Belo Horizonte",
            "geo_scope": "cidade",
            "mesmo_escopo": True,
            "counts": {"totalpass": 2, "wellhub": 0, "gurupass": 0, "receita": 0},
            "planos_top": {},
        }
    )
    assert "Maior cobertura: TotalPass" in texto
    assert "Universo Receita indisponível" in texto


def test_narrar_penetracao_ambiguidade():
    jr = _load()
    texto = jr.narrar_penetracao(
        {
            "bairro": "paraíso",
            "geo_scope": "ambiguidade",
            "mesmo_escopo": False,
            "counts": {"totalpass": 0, "wellhub": 0, "gurupass": 0, "receita": 0},
            "planos_top": {},
        }
    )
    assert "várias cidades" in texto
    assert "%" not in texto


def test_narrar_penetracao_nacional_sem_pct():
    jr = _load()
    texto = jr.narrar_penetracao(
        {
            "bairro": "savassi",
            "geo_scope": "nacional",
            "mesmo_escopo": False,
            "counts": {"totalpass": 2, "wellhub": 1, "gurupass": 0, "receita": 5},
            "planos_top": {},
        }
    )
    assert "escopo nacional" in texto
    assert "omitida" in texto
    assert "cerca de" not in texto


def test_contar_penetracao_mock_distinct(monkeypatch):
    """Censo usa distinct — 3 chunks da mesma academia = 1."""
    jr = _load()
    monkeypatch.setenv("JARVIS_RAG", "1")
    monkeypatch.setenv("SUPABASE_URL", "https://example.supabase.co")
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "fake-key")
    monkeypatch.setenv("TOTALPASS_GROUP_ID", "gid-tp")
    monkeypatch.setenv("WELLHUB_GROUP_ID", "gid-wh")
    monkeypatch.setenv("GURUPASS_GROUP_ID", "gid-gp")
    monkeypatch.setenv("RECEITA_GROUP_ID", "gid-rec")

    def fake_fetch(group_id, bairro_norm, *, cidade=None, only_ativo=False):
        if cidade and cidade != "São Paulo":
            return []
        if group_id == "gid-tp" and bairro_norm == "paraiso":
            return [
                {"meta": {"nome_academia": "A", "plano_minimo": "TP 1"}, "source_ref": "1"},
                {"meta": {"nome_academia": "A", "plano_minimo": "TP 1"}, "source_ref": "1b"},
                {"meta": {"nome_academia": "B", "plano_minimo": "TP 4"}, "source_ref": "2"},
            ]
        if group_id == "gid-wh" and bairro_norm == "paraiso":
            return [
                {
                    "meta": {
                        "nome_academia": "W",
                        "gym_id": "g1",
                        "plano_minimo": "Wellhub Silver",
                    },
                    "source_ref": "g1",
                }
            ]
        if group_id == "gid-rec" and bairro_norm == "PARAISO":
            return [
                {"meta": {"cnpj": "111", "nome_academia": "R1", "is_ativo": True}},
                {"meta": {"cnpj": "222", "nome_academia": "R2", "is_ativo": True}},
            ]
        return []

    monkeypatch.setattr(jr, "_fetch_bairro_rows", fake_fetch)
    agg = jr.contar_penetracao("Paraíso", cidade="São Paulo")
    assert agg["geo_scope"] == "cidade"
    assert agg["mesmo_escopo"] is True
    assert agg["cidade"] == "São Paulo"
    assert agg["counts"]["totalpass"] == 2  # A,B — não 3
    assert agg["counts"]["wellhub"] == 1
    assert agg["counts"]["gurupass"] == 0
    assert agg["counts"]["receita"] == 2
    assert agg["planos_top"]["totalpass"] in ("TP 1", "TP 4")


def test_contar_penetracao_ambiguidade_sem_cidade(monkeypatch):
    jr = _load()
    monkeypatch.setenv("JARVIS_RAG", "1")
    monkeypatch.setenv("SUPABASE_URL", "https://example.supabase.co")
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "fake-key")
    monkeypatch.setenv("TOTALPASS_GROUP_ID", "gid-tp")

    called = {"n": 0}

    def fake_fetch(*a, **k):
        called["n"] += 1
        return [{"meta": {"nome_academia": "X"}}]

    monkeypatch.setattr(jr, "_fetch_bairro_rows", fake_fetch)
    agg = jr.contar_penetracao("Paraíso")  # ambíguo, sem cidade
    assert agg["geo_scope"] == "ambiguidade"
    assert agg["counts"]["totalpass"] == 0
    assert called["n"] == 0  # não mescla Brasil
