from pathlib import Path
import importlib.util
import json
import sys

ROOT = Path(__file__).resolve().parents[1]
TOY = ROOT / "data" / "jarvis" / "kg-toy.json"


def _load_jarvis_qa():
    p = Path(__file__).resolve().parent / "jarvis_qa.py"
    spec = importlib.util.spec_from_file_location("jarvis_qa", p)
    mod = importlib.util.module_from_spec(spec)
    # dataclasses + from __future__ import annotations need the module registered
    # before exec_module, otherwise cls.__module__ is missing from sys.modules.
    assert spec.loader is not None
    sys.modules[spec.name] = mod
    spec.loader.exec_module(mod)
    return mod


def test_kg_toy_exists_and_matches_demo():
    data = json.loads(TOY.read_text(encoding="utf-8"))
    assert data["entity2id"]["bairro:savassi"] == 0
    assert data["rules"][0]["name"] == "bairro_bh_herda_renda"
    assert [0, 0, 2] in data["triples"]
    # Supervisao explicita no dado (nao escondida no router) + seed fixa.
    assert data["train"]["viab_labels"] == [1.0, 0.0]
    assert data["train"]["viab_targets"] == [0, 1]
    assert isinstance(data["train"]["seed"], int)

def test_playbook_projector_is_f13():
    jq = _load_jarvis_qa()
    faqs = jq.load_playbook(ROOT / "public" / "playbook-tensorboard.html")
    hit = jq.match_playbook("o que é Projector?", faqs)
    assert hit is not None
    assert hit.section_id == "f13"
    assert "Projector" in hit.title

def test_match_playbook_pr_nao_casa_projector():
    jq = _load_jarvis_qa()
    faqs = jq._default_faqs()
    assert jq.match_playbook("o que é PR?", faqs) is None
    assert jq.match_playbook("o que é Projector?", faqs) is not None
    hit = jq.match_playbook("o que é Projector?", faqs)
    assert hit.section_id == "f13"

def test_parse_intent_viabilidade_savassi():
    jq = _load_jarvis_qa()
    names = ["bairro:savassi", "bairro:centro"]
    intent, ents = jq.parse_intent("bairro:savassi é viável?", names)
    assert intent == "viabilidade"
    assert "bairro:savassi" in ents

def test_parse_intent_lixo():
    jq = _load_jarvis_qa()
    intent, ents = jq.parse_intent("asdf qwerty", ["bairro:savassi"])
    assert intent == "lixo"
    assert ents == []

def test_ask_projector_regra():
    jq = _load_jarvis_qa()
    r = jq.ask("o que é Projector?", tf_ok=True)
    assert r["modo"] == "regra"
    assert "playbook:#f13" in r["fontes"]
    # Conversational: short, spoken tone — not ELI5 dump.
    assert "mapa" in r["resposta"].casefold()
    assert "pinta" in r["resposta"].casefold()
    assert len(r["resposta"]) < 220
    assert "playbook:#" not in r["resposta"].casefold()
    assert r["resposta"].count(".") + r["resposta"].count("?") <= 4

def test_faq_to_dialogue_short():
    jq = _load_jarvis_qa()
    faq = jq.PlaybookFaq(
        "f99",
        "Aba Fake",
        "Primeira frase útil aqui. Segunda frase longa " + ("x" * 400),
    )
    line = jq.faq_to_dialogue(faq)
    assert len(line) < 220
    assert "Aba Fake" in line
    assert "xxx" not in line  # must not dump the wall

def test_constantes_viabilidade_exportadas():
    import sys
    from pathlib import Path

    nb = Path(__file__).resolve().parents[1] / "notebooks"
    sys.path.insert(0, str(nb))
    import reasoning_neuron_viabilidade as rn

    assert rn.VIAB_ALTA == 0.66
    assert rn.VIAB_MEDIA == 0.40
    assert rn.INFER_THRESHOLD == 0.7

def test_ask_viabilidade_savassi():
    import pytest

    pytest.importorskip("tensorflow")
    jq = _load_jarvis_qa()
    r = jq.ask("bairro:savassi é viável?", tf_ok=True)
    assert r["modo"] == "rede"
    assert any("report" in f for f in r["fontes"])
    # Valor do rotulo, nao so a substring "rotulo". A assercao antiga passava
    # com QUALQUER valor, por isso 12/12 ficavam verdes enquanto report()
    # sorteava alta/media/baixa a cada execucao.
    assert "rotulo=alta" in r["porque"], r["porque"]
    # Procedencia declarada: o painel nao pode vender supervisao como evidencia.
    assert "base=toy(supervisionado)" in r["porque"], r["porque"]

def test_viabilidade_e_determinista():
    """Mesma pergunta, dois reasoners independentes -> mesmo score.

    Regressao do bug de origem: sem seed os pesos nasciam aleatorios e o score
    variava 0.1023-0.8310 na MESMA entidade, cruzando o limiar 0.66 (afirmando
    "viavel") em 3 de 12 execucoes. steps baixo de proposito — determinismo
    depende da seed, nao da duracao do treino, e mantem a suite rapida.
    """
    import pytest

    pytest.importorskip("tensorflow")
    jq = _load_jarvis_qa()
    toy = json.loads(TOY.read_text(encoding="utf-8"))
    toy["train"] = {**toy["train"], "steps": 15}

    scores = [
        jq.build_reasoner(toy).report("bairro:savassi")["viabilidade"]
        for _ in range(2)
    ]
    assert scores[0] == scores[1], scores

def test_treino_separa_savassi_de_centro():
    """O treino tem de PRODUZIR contraste, nao so rodar.

    Guarda contra teste vacuo: com pesos crus (seed fixa, sem treino) o modelo
    devolve savassi=0.7267 e centro=0.6837 — ambos "alta", delta 0.043, ou seja
    nao separa nada e ainda assim passaria numa assercao de `rotulo=alta`.
    Treinado o delta vai a 1.0. Exigir o contraste e o que distingue os dois.
    """
    import pytest

    pytest.importorskip("tensorflow")
    jq = _load_jarvis_qa()
    toy = json.loads(TOY.read_text(encoding="utf-8"))
    model = jq.build_reasoner(toy)

    savassi = model.report("bairro:savassi")
    centro = model.report("bairro:centro")
    assert savassi["rotulo"] == "alta", savassi
    assert centro["rotulo"] == "baixa", centro
    assert savassi["viabilidade"] - centro["viabilidade"] >= 0.5

def test_toy_train_ligado_por_padrao(monkeypatch):
    """Treino e opt-OUT. Se virar opt-in, o default volta a ler pesos crus."""
    jq = _load_jarvis_qa()
    monkeypatch.delenv("JARVIS_QA_TOY_TRAIN", raising=False)
    assert jq._toy_train_enabled() is True
    monkeypatch.setenv("JARVIS_QA_TOY_TRAIN", "0")
    assert jq._toy_train_enabled() is False

def test_ask_hibrido_regra_toy():
    import pytest

    pytest.importorskip("tensorflow")
    jq = _load_jarvis_qa()
    r = jq.ask("bairro:savassi herda renda?", tf_ok=True)
    assert r["modo"] == "hibrido"
    assert any("bairro_bh_herda_renda" in f for f in r["fontes"])
    assert any("rule:bairro_bh_herda_renda" in f for f in r["fontes"])

def test_ask_hibrido_vence_playbook_projector():
    """Spec empate 3 vs 4: Rule grounding vence playbook factual (Projector)."""
    import pytest

    pytest.importorskip("tensorflow")
    jq = _load_jarvis_qa()
    r = jq.ask("bairro:savassi herda renda no Projector?", tf_ok=True)
    assert r["modo"] == "hibrido", r
    assert any(f == "rule:bairro_bh_herda_renda" for f in r["fontes"]), r["fontes"]
    assert not any(f.startswith("playbook:") for f in r["fontes"]), r["fontes"]

def test_rule_body_grounds_savassi_renda():
    jq = _load_jarvis_qa()
    toy = jq._default_toy()
    hit = jq.rule_body_grounds(
        "bairro:savassi herda renda?",
        toy,
        ["bairro:savassi"],
    )
    assert hit is not None
    assert hit["name"] == "bairro_bh_herda_renda"

def test_is_playbook_factual_puro_gate():
    jq = _load_jarvis_qa()
    toy = jq._default_toy()
    assert jq.is_playbook_factual_puro("o que é Projector?", toy) is True
    assert jq.is_playbook_factual_puro(
        "bairro:savassi herda renda no Projector?", toy
    ) is False
    assert jq.is_playbook_factual_puro(
        "bairro_bh_herda_renda no Projector", toy
    ) is False

def test_ask_lixo_sem_match(monkeypatch):
    monkeypatch.setenv("JARVIS_RAG", "0")
    jq = _load_jarvis_qa()
    r = jq.ask("asdf qwerty", tf_ok=True)
    assert r["modo"] == "regra"
    assert r["porque"] == "sem_match"
    assert r["fontes"] == []

def test_ask_rag_como_fonte(monkeypatch):
    """Grafo não cobre → RAG responde; modo=rag; fontes chunk+sim."""
    jq = _load_jarvis_qa()

    class _FakeRag:
        RagIndisponivel = RuntimeError

        @staticmethod
        def disponivel():
            return True

        @staticmethod
        def buscar(q):
            return [
                {
                    "chunk_id": "tp-pilates-1",
                    "similarity": 0.84,
                    "score": 0.86,
                    "text": "Studio X pilates",
                    "meta": {"nome_academia": "Studio X", "cidade": "Belo Horizonte"},
                    "_grupo": "totalpass",
                }
            ]

        @staticmethod
        def narrar(chunks):
            return "Achei Studio X, em Belo Horizonte. Quer os detalhes?"

    monkeypatch.setitem(__import__("sys").modules, "jarvis_rag", _FakeRag)
    # reload ask path picks up fake via import inside _try_rag
    r = jq.ask("academias de pilates na Savassi em BH", tf_ok=True)
    assert r["modo"] == "rag", r
    assert "chunk:tp-pilates-1" in r["fontes"]
    assert any(f.startswith("sim:") for f in r["fontes"])
    assert "não é fato do grafo" in r["porque"]
    assert "Studio X" in r["resposta"]

def test_ask_rag_nao_sobrepoe_playbook(monkeypatch):
    """Projector continua regra mesmo com RAG ligado."""
    jq = _load_jarvis_qa()

    class _FakeRag:
        RagIndisponivel = RuntimeError

        @staticmethod
        def disponivel():
            return True

        @staticmethod
        def buscar(q):
            raise AssertionError("RAG não deve rodar quando playbook fecha")

        @staticmethod
        def narrar(chunks):
            return ""

    monkeypatch.setitem(__import__("sys").modules, "jarvis_rag", _FakeRag)
    r = jq.ask("o que é Projector?", tf_ok=True)
    assert r["modo"] == "regra"
    assert "playbook:#f13" in r["fontes"]

def test_tf_ok_false_when_toy_missing(tmp_path, monkeypatch):
    jq = _load_jarvis_qa()
    missing = tmp_path / "no-kg.json"
    monkeypatch.setattr(jq, "TOY_PATH", missing)
    # limpar cache de toy/reasoner/tf
    with jq._CACHE_LOCK:
        jq._CACHE.clear()
    assert jq.tf_available() is False

def test_ask_kg_toy_indisponivel_em_viabilidade(tmp_path, monkeypatch):
    jq = _load_jarvis_qa()
    monkeypatch.setattr(jq, "TOY_PATH", tmp_path / "broken.json")
    (tmp_path / "broken.json").write_text("{not-json", encoding="utf-8")
    with jq._CACHE_LOCK:
        jq._CACHE.clear()
    # Força caminho de grafo sem injetar toy válido
    r = jq.ask("bairro:savassi é viável?", tf_ok=None, toy=None)
    assert r["modo"] == "regra"
    assert r["porque"] == "kg_toy_indisponivel"
    assert r["fontes"] == []

def test_ask_kg_toy_indisponivel_empty_maps(tmp_path, monkeypatch):
    """Empty entity2id/relation2id must count as load failure (same bar as tf_available)."""
    jq = _load_jarvis_qa()
    empty = tmp_path / "empty-maps.json"
    empty.write_text(
        '{"entity2id": {}, "relation2id": {}, "triples": [], "rules": []}',
        encoding="utf-8",
    )
    monkeypatch.setattr(jq, "TOY_PATH", empty)
    with jq._CACHE_LOCK:
        jq._CACHE.clear()
    r = jq.ask("bairro:savassi é viável?", tf_ok=None, toy=None)
    assert r["modo"] == "regra"
    assert r["porque"] == "kg_toy_indisponivel"
    assert r["fontes"] == []

def test_ask_tf_off_projector_fallback():
    jq = _load_jarvis_qa()
    r = jq.ask("o que é Projector?", tf_ok=False)
    assert r["modo"] == "regra_fallback"
    assert "playbook:#f13" in r["fontes"]

def test_ask_tf_off_projector_herda_renda_nao_fallback():
    """Smoke 5c: pede_rule_grounding + TF off → não regra_fallback de Projector."""
    jq = _load_jarvis_qa()
    r = jq.ask("Projector herda renda?", tf_ok=False)
    assert r["modo"] != "regra_fallback", r
    assert "playbook:#f13" not in (r.get("fontes") or [])
    assert r["porque"] in ("sem_match", "kg_toy_indisponivel")

def test_ask_tf_off_viabilidade_recusa():
    jq = _load_jarvis_qa()
    r = jq.ask("bairro:savassi é viável?", tf_ok=False)
    assert r["modo"] == "regra"
    assert r["porque"] == "sem_match"

def test_cli_json_projector(tmp_path):
    import os
    import subprocess

    script = Path(__file__).resolve().parent / "jarvis_qa.py"
    env = {**os.environ, "PYTHONIOENCODING": "utf-8"}
    proc = subprocess.run(
        [sys.executable, str(script), "o que é Projector?"],
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        env=env,
    )
    assert proc.returncode == 0
    data = json.loads(proc.stdout)
    assert data["modo"] in ("regra", "regra_fallback")
    assert "playbook:#f13" in data["fontes"]

# ---------------------------------------------------------------- voz / persona

def test_entidade_inexistente_nao_vira_relatorio(monkeypatch):
    """Entidade fora do grafo tem de ser recusada, nao trocada por outra.

    Regressao: o match era `tail in q` cru, entao o "x" de gym:x casava dentro
    de "bairro:xpto" e o roteador respondia "X sustenta a tese" — relatorio de
    viabilidade sobre entidade que ninguem pediu e que nao existe.
    """
    import pytest

    monkeypatch.setenv("JARVIS_RAG", "0")
    pytest.importorskip("tensorflow")
    jq = _load_jarvis_qa()
    r = jq.ask("viabilidade de bairro:xpto", tf_ok=True)
    assert r["modo"] == "regra"
    assert r["porque"] == "sem_match"
    assert "sustenta" not in r["resposta"].casefold()

def test_relacao_kg_respeita_direcao_da_pergunta():
    """Sujeito e objeto na ordem da frase, nao na ordem do dicionario.

    Regressao: `ents` saia ordenado pelos ids do KG, entao
    "gym:x coberto_por aggr:totalpass" virava "Totalpass coberto_por X" — a
    relacao inversa, que o motor trata como fato distinto (fix A5).
    """
    import pytest

    pytest.importorskip("tensorflow")
    jq = _load_jarvis_qa()
    r = jq.ask("o gym:x é coberto_por aggr:totalpass?", tf_ok=True)
    resp = r["resposta"]
    assert resp.index("X") < resp.index("Totalpass"), resp
    assert "known=True" in r["porque"], r["porque"]

def test_ask_devolve_campo_fala():
    jq = _load_jarvis_qa()
    r = jq.ask("o que é Projector?", tf_ok=True)
    assert r["fala"]
    # Vocativo resolvido: nenhum marcador cru vaza para tela ou fala.
    assert "{sr}" not in r["resposta"]
    assert "{sr}" not in r["fala"]

def test_voz_normaliza_sigla_e_decimal():
    import importlib.util as _il

    spec = _il.spec_from_file_location(
        "jarvis_voice", Path(__file__).resolve().parent / "jarvis_voice.py"
    )
    jv = _il.module_from_spec(spec)
    sys.modules[spec.name] = jv
    spec.loader.exec_module(jv)

    assert "tê-ésse-ené" in jv.to_speech("olhe o t-SNE")
    assert "cépe" in jv.to_speech("resolve o CEP")
    assert "0 vírgula 72" in jv.to_speech("score 0.72")
    # Travessao vira pausa audivel, nao fica como glifo mudo.
    assert "—" not in jv.to_speech("viável — alto")

def test_registro_trata_por_senhor():
    """A persona precisa aparecer, mas sem virar bordao em toda frase."""
    jq = _load_jarvis_qa()
    faqs = jq._default_faqs()
    falas = [jq.faq_to_dialogue(f) for f in faqs]
    com_vocativo = [f for f in falas if "{sr}" in f]
    assert com_vocativo, "persona sumiu das falas do playbook"
    assert len(com_vocativo) < len(falas) / 2, "vocativo em excesso soa bajulador"

# ------------------------------------------------- racional narrado (item 1)

def test_narrar_fatores_usa_o_que_pesou():
    """`fatores_top` vira frase. Antes o router usava 2 de 6 campos do report."""
    jq = _load_jarvis_qa()
    rep = {"fatores_top": [["tem_renda", 7.0], ["tem_aluguel", 5.9], ["coberto_por", 0.0]]}
    frase = jq.narrar_fatores(rep)
    assert "renda" in frase and "aluguel" in frase
    assert "tem_renda" not in frase, "nome de campo vazando na fala: " + frase

def test_narrar_fatores_nao_inventa_contraste():
    """Fator secundario irrelevante nao vira "logo atras"."""
    jq = _load_jarvis_qa()
    dominante = jq.narrar_fatores(
        {"fatores_top": [["tem_renda", 7.0], ["tem_aluguel", 0.1]]}
    )
    assert "sobretudo" in dominante, dominante
    assert "logo atrás" not in dominante
    # Nada acima do minimo -> sem explicacao, em vez de explicacao inventada.
    assert jq.narrar_fatores({"fatores_top": [["coberto_por", 0.0]]}) == ""
    assert jq.narrar_fatores({}) == ""

def test_resposta_de_viabilidade_explica_o_porque():
    import pytest

    pytest.importorskip("tensorflow")
    jq = _load_jarvis_qa()
    r = jq.ask("bairro:savassi é viável?", tf_ok=True)
    assert "Pesou" in r["resposta"], r["resposta"]
    assert len(r["resposta"]) < 220


# ------------------------------------------------- conversa encadeada (item 2)

def test_followup_cumpre_a_oferta():
    """A oferta do turno anterior tem de ser honrada.

    Regressao: o JARVIS dizia "Cruzo com aluguel ou renda?" e respondia
    "essa eu nao fecho" ao "sim" seguinte — 3 de 3 follow-ups falhavam.
    """
    import pytest

    pytest.importorskip("tensorflow")
    jq = _load_jarvis_qa()
    r1 = jq.ask("bairro:savassi é viável?", tf_ok=True)
    assert r1["contexto"]["entidade"] == "bairro:savassi"

    r2 = jq.ask("sim", tf_ok=True, contexto=r1["contexto"])
    assert r2["porque"] != "sem_match", r2
    assert "Savassi" in r2["resposta"]

    r3 = jq.ask("e o aluguel?", tf_ok=True, contexto=r2["contexto"])
    assert "aluguel" in r3["resposta"].casefold()
    # Valor lido do KG, nao inferido pela rede.
    assert "kg:triple" in r3["fontes"]
    assert "tripla" in r3["porque"]

def test_anafora_troca_de_entidade():
    """"e o centro?" herda a leitura em curso e passa a valer para Centro."""
    import pytest

    pytest.importorskip("tensorflow")
    jq = _load_jarvis_qa()
    r1 = jq.ask("bairro:savassi é viável?", tf_ok=True)
    r2 = jq.ask("e o centro?", tf_ok=True, contexto=r1["contexto"])
    assert r2["modo"] == "rede"
    assert "Centro" in r2["resposta"], r2["resposta"]
    assert r2["contexto"]["entidade"] == "bairro:centro"

def test_porque_abre_os_fatores():
    import pytest

    pytest.importorskip("tensorflow")
    jq = _load_jarvis_qa()
    r1 = jq.ask("bairro:savassi é viável?", tf_ok=True)
    r2 = jq.ask("por quê?", tf_ok=True, contexto=r1["contexto"])
    assert r2["modo"] == "rede"
    assert "Pesou" in r2["resposta"], r2["resposta"]
    assert "fatores_top" in r2["porque"]

def test_sem_contexto_nao_inventa_entidade(monkeypatch):
    """Follow-up sem conversa previa continua sendo recusa, nao chute."""
    import pytest

    monkeypatch.setenv("JARVIS_RAG", "0")
    pytest.importorskip("tensorflow")
    jq = _load_jarvis_qa()
    r = jq.ask("sim", tf_ok=True)
    assert r["porque"] == "sem_match", r

def test_aceite_so_vale_em_frase_curta():
    """"sim" dentro de frase longa e diferente nao e aceite da oferta."""
    jq = _load_jarvis_qa()
    assert jq._e_aceite("sim")
    assert jq._e_aceite("pode")
    assert not jq._e_aceite(
        "sim eu queria entender melhor como funciona a aba projector do playbook"
    )

def test_looks_like_penetracao():
    jq = _load_jarvis_qa()
    assert jq.looks_like_penetracao(
        "No bairro Paraíso, quantas usam TP vs WH vs GP?"
    )
    assert jq.looks_like_penetracao("cobertura TotalPass no bairro centro")
    assert not jq.looks_like_penetracao("o que é Projector?")
    assert not jq.looks_like_penetracao("asdf qwerty")

def test_extract_bairro_from_query():
    jq = _load_jarvis_qa()
    b = jq.extract_bairro_from_query("No bairro Paraíso, quantas usam TP vs WH?")
    assert b is not None
    assert "paraíso" in b.casefold() or "paraiso" in b.casefold()
    b2 = jq.extract_bairro_from_query("No bairro Bela Vista, cobertura Wellhub")
    assert b2 is not None
    assert "bela" in b2.casefold()

def test_extract_cidade_e_bairro_com_cidade():
    jq = _load_jarvis_qa()
    assert jq.extract_cidade_from_query("Savassi em Belo Horizonte") == "Belo Horizonte"
    assert jq.extract_cidade_from_query("Paraíso São Paulo TP vs WH") == "São Paulo"
    assert jq.extract_cidade_from_query("cobertura em Sao Paulo") == "São Paulo"
    b = jq.extract_bairro_from_query(
        "No bairro Paraíso São Paulo, quantas usam TP vs WH?"
    )
    assert b is not None
    assert "paraíso" in b.casefold() or "paraiso" in b.casefold()
    assert "paulo" not in b.casefold()
    b2 = jq.extract_bairro_from_query("cobertura TotalPass Savassi em Belo Horizonte")
    assert b2 is not None
    assert "savassi" in b2.casefold()

def test_ask_penetracao_rag_first(monkeypatch):
    """Penetração não passa pelo toy TF — vai direto ao censo RAG."""
    jq = _load_jarvis_qa()

    class _FakeRag:
        RagIndisponivel = RuntimeError

        @staticmethod
        def penetracao_disponivel():
            return True

        @staticmethod
        def normalize_bairro_slug(b):
            return "paraiso"

        @staticmethod
        def bairro_ambiguo(b):
            return False

        @staticmethod
        def contar_penetracao(bairro, cidade=None):
            return {
                "bairro": bairro,
                "bairro_slug": "paraiso",
                "cidade": cidade or "São Paulo",
                "cidade_canon": cidade or "São Paulo",
                "geo_scope": "cidade",
                "mesmo_escopo": True,
                "counts": {
                    "totalpass": 4,
                    "wellhub": 10,
                    "gurupass": 0,
                    "receita": 27,
                },
                "planos_top": {
                    "wellhub": "Wellhub Basic",
                    "totalpass": "TP 1",
                    "gurupass": None,
                    "receita": None,
                },
            }

        @staticmethod
        def narrar_penetracao(agg):
            return (
                "No bairro Paraíso (São Paulo): TotalPass 4, Wellhub 10, GuruPass 0; "
                "universo Receita 27 academia(s) aberta(s). "
                "Maior cobertura: Wellhub (10)."
            )

        @staticmethod
        def disponivel():
            return True

        @staticmethod
        def buscar(q):
            raise AssertionError("buscar semântico não deve rodar no path penetração")

    monkeypatch.setitem(__import__("sys").modules, "jarvis_rag", _FakeRag)
    r = jq.ask(
        "No bairro Paraíso em São Paulo, quantas usam TP vs WH vs GP?",
        tf_ok=True,
    )
    assert r["modo"] == "rag", r
    assert "rag:penetracao" in r["fontes"]
    assert "tp:4" in r["fontes"]
    assert "wh:10" in r["fontes"]
    assert "Wellhub" in r["resposta"]
    assert "renda" in r["resposta"].casefold() or "aluguel" in r["resposta"].casefold()
    assert "penetracao RAG-first" in r["porque"]

def test_penetracao_counts_positivos_oferece_cruzar(monkeypatch):
    jq = _load_jarvis_qa()
    # Reusar o FakeRag de test_ask_penetracao_rag_first (counts > 0)
    # (copiar o FakeRag do teste existente; nao importar fixture compartilhada TBD)

    class _FakeRag:
        RagIndisponivel = RuntimeError

        @staticmethod
        def penetracao_disponivel():
            return True

        @staticmethod
        def normalize_bairro_slug(b):
            return "paraiso"

        @staticmethod
        def bairro_ambiguo(b):
            return False

        @staticmethod
        def contar_penetracao(bairro, cidade=None):
            return {
                "bairro": bairro,
                "bairro_slug": "paraiso",
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
                    "wellhub": "Wellhub Basic",
                    "totalpass": "TP 1",
                    "gurupass": None,
                    "receita": None,
                },
            }

        @staticmethod
        def narrar_penetracao(agg):
            return (
                "No bairro Paraíso (São Paulo): TotalPass 4, Wellhub 10, GuruPass 0; "
                "universo Receita 27 academia(s) aberta(s)."
            )

        @staticmethod
        def disponivel():
            return False

        @staticmethod
        def buscar(q):
            raise AssertionError("no")

    monkeypatch.setitem(__import__("sys").modules, "jarvis_rag", _FakeRag)
    r = jq.ask(
        "No bairro Paraíso em São Paulo, quantas usam TP vs WH vs GP?",
        tf_ok=True,
    )
    assert r["modo"] == "rag"
    assert r["contexto"].get("oferta") == "cruzar"

def test_ask_penetracao_ambiguidade_pede_cidade(monkeypatch):
    jq = _load_jarvis_qa()

    class _FakeRag:
        RagIndisponivel = RuntimeError

        @staticmethod
        def penetracao_disponivel():
            return True

        @staticmethod
        def normalize_bairro_slug(b):
            return "paraiso"

        @staticmethod
        def bairro_ambiguo(b):
            return True

        @staticmethod
        def contar_penetracao(*a, **k):
            raise AssertionError("não deve contar sem cidade quando ambíguo")

        @staticmethod
        def disponivel():
            return True

        @staticmethod
        def buscar(q):
            raise AssertionError("não buscar semântico")

    monkeypatch.setitem(__import__("sys").modules, "jarvis_rag", _FakeRag)
    r = jq.ask(
        "No bairro Paraíso, quantas usam TP vs WH vs GP?",
        tf_ok=True,
    )
    assert r["modo"] == "rag"
    assert "geo:ambiguidade" in r["fontes"]
    assert "cidade" in r["resposta"].casefold()
    assert "pedir_cidade" in r["porque"]

def test_penetracao_nao_depende_do_toy(tmp_path, monkeypatch):
    """Successful RAG penetração (tf_ok=None, toy=None) must never touch toy/TF."""
    jq = _load_jarvis_qa()
    monkeypatch.setattr(jq, "TOY_PATH", tmp_path / "ausente.json")
    with jq._CACHE_LOCK:
        jq._CACHE.clear()

    def _fail_try_load_toy(*a, **k):
        raise AssertionError("_try_load_toy must not run on RAG penetração path")

    def _fail_default_toy(*a, **k):
        raise AssertionError("_default_toy must not run on RAG penetração path")

    def _fail_tf_available(*a, **k):
        raise AssertionError("tf_available must not run on RAG penetração path")

    monkeypatch.setattr(jq, "_try_load_toy", _fail_try_load_toy)
    monkeypatch.setattr(jq, "_default_toy", _fail_default_toy)
    monkeypatch.setattr(jq, "tf_available", _fail_tf_available)

    class _FakeRag:
        RagIndisponivel = RuntimeError

        @staticmethod
        def penetracao_disponivel():
            return True

        @staticmethod
        def normalize_bairro_slug(b):
            return "paraiso"

        @staticmethod
        def bairro_ambiguo(b):
            return False

        @staticmethod
        def contar_penetracao(bairro, cidade=None):
            return {
                "bairro": bairro,
                "bairro_slug": "paraiso",
                "cidade": "São Paulo",
                "cidade_canon": "São Paulo",
                "geo_scope": "cidade",
                "mesmo_escopo": True,
                "counts": {
                    "totalpass": 2,
                    "wellhub": 3,
                    "gurupass": 0,
                    "receita": 10,
                },
                "planos_top": {
                    "wellhub": "Basic",
                    "totalpass": None,
                    "gurupass": None,
                    "receita": None,
                },
            }

        @staticmethod
        def narrar_penetracao(agg):
            return "No bairro Paraíso (São Paulo): TotalPass 2, Wellhub 3, GuruPass 0."

        @staticmethod
        def disponivel():
            return False

        @staticmethod
        def buscar(q):
            raise AssertionError("buscar semantico nao deve rodar")

    monkeypatch.setitem(__import__("sys").modules, "jarvis_rag", _FakeRag)
    r = jq.ask(
        "No bairro Paraíso em São Paulo, quantas usam TP vs WH vs GP?",
        tf_ok=None,
        toy=None,
    )
    assert r["modo"] == "rag", r
    assert "rag:penetracao" in r["fontes"]

def _fake_rag_counts(counts, *, mesmo_escopo=True, cidade="São Paulo", bairro_slug="pinheiros"):
    import jarvis_rag as _real_jr

    _narr_real = _real_jr.narrar_penetracao

    class _FakeRag:
        RagIndisponivel = RuntimeError

        @staticmethod
        def penetracao_disponivel():
            return True

        @staticmethod
        def normalize_bairro_slug(b):
            return bairro_slug

        @staticmethod
        def bairro_ambiguo(b):
            return False

        @staticmethod
        def contar_penetracao(bairro, cidade=None):
            return {
                "bairro": bairro,
                "bairro_slug": bairro_slug,
                "cidade": cidade or "São Paulo",
                "cidade_canon": cidade or "São Paulo",
                "geo_scope": "cidade",
                "mesmo_escopo": mesmo_escopo,
                "counts": counts,
                "planos_top": {
                    "wellhub": "Basic",
                    "totalpass": None,
                    "gurupass": None,
                    "receita": None,
                },
            }

        @staticmethod
        def narrar_penetracao(agg):
            return _narr_real(agg)

        @staticmethod
        def disponivel():
            return False

        @staticmethod
        def buscar(q):
            raise AssertionError("buscar semantico nao deve rodar")

    return _FakeRag


def test_penetracao_contexto_entidade_e_oferta(monkeypatch):
    jq = _load_jarvis_qa()
    monkeypatch.setitem(
        __import__("sys").modules,
        "jarvis_rag",
        _fake_rag_counts(
            {"totalpass": 4, "wellhub": 10, "gurupass": 0, "receita": 27},
            bairro_slug="paraiso",
        ),
    )
    r = jq.ask(
        "No bairro Paraíso em São Paulo, quantas usam TP vs WH vs GP?",
        tf_ok=True,
    )
    assert r["modo"] == "rag"
    assert r["contexto"].get("oferta") == "cruzar"
    assert r["contexto"].get("entidade") == "bairro:paraiso"


def test_ask_penetracao_smoke10_eco_cruzar(monkeypatch):
    """Smoke 10: eco oferta após penetração — sem sem_match genérico."""
    jq = _load_jarvis_qa()
    monkeypatch.setitem(
        __import__("sys").modules,
        "jarvis_rag",
        _fake_rag_counts(
            {"totalpass": 4, "wellhub": 10, "gurupass": 0, "receita": 27},
            bairro_slug="paraiso",
        ),
    )
    r1 = jq.ask(
        "No bairro Paraíso em São Paulo, quantas usam TP vs WH vs GP?",
        tf_ok=True,
    )
    r2 = jq.ask("sim", tf_ok=True, contexto=r1["contexto"])
    assert r2["porque"] != "sem_match", r2
    assert r2["modo"] == "regra"
    assert r2["porque"] == "bairro_fora_do_kg_toy"
    assert "projector" not in r2["resposta"].casefold()
    assert "savassi" not in r2["resposta"].casefold()


def test_ask_penetracao_smoke8_sem_pct_quando_cobertura_gt_receita(monkeypatch):
    """Smoke 8: max(TP,WH,GP) > Receita + mesmo_escopo → sem % de mercado."""
    jq = _load_jarvis_qa()
    # Garante narrar_penetracao real disponível no Fake
    import jarvis_rag as jr

    counts = {"totalpass": 40, "wellhub": 50, "gurupass": 5, "receita": 30}
    fake = _fake_rag_counts(counts)

    def _narr(agg):
        return jr.narrar_penetracao(agg)

    fake.narrar_penetracao = staticmethod(_narr)
    monkeypatch.setitem(__import__("sys").modules, "jarvis_rag", fake)
    r = jq.ask(
        "No bairro Pinheiros em São Paulo, quantas usam TP vs WH vs GP?",
        tf_ok=True,
    )
    assert r["modo"] == "rag"
    assert "rag:penetracao" in r["fontes"]
    assert "%" not in r["resposta"] or "omitida" in r["resposta"].casefold()
    assert "mercado" not in r["resposta"].casefold() or "omitida" in r["resposta"].casefold()
    # Preferir assert explícito da policy:
    assert "omitida" in r["resposta"].casefold() or "universo parcial" in r["resposta"].casefold()

def test_ask_penetracao_smoke9_pct_wh_e_tf_off(monkeypatch):
    """Smoke 9: Receita >= max e WH>0 → pode % WH; TF off não desliga RAG."""
    jq = _load_jarvis_qa()
    import jarvis_rag as jr

    counts = {"totalpass": 4, "wellhub": 10, "gurupass": 0, "receita": 27}
    fake = _fake_rag_counts(counts)
    fake.narrar_penetracao = staticmethod(lambda agg: jr.narrar_penetracao(agg))
    monkeypatch.setitem(__import__("sys").modules, "jarvis_rag", fake)
    r = jq.ask(
        "No bairro Pinheiros em São Paulo, quantas usam TP vs WH vs GP?",
        tf_ok=False,
    )
    assert r["modo"] == "rag", r
    assert "rag:penetracao" in r["fontes"]
    assert "%" in r["resposta"]
    assert "wellhub" in r["resposta"].casefold()

def test_recusa_sem_pitch_toy(monkeypatch):
    """Recusa default não empurra Projector / Savassi / herda renda."""
    monkeypatch.setenv("JARVIS_RAG", "0")
    jq = _load_jarvis_qa()
    r = jq.ask("asdf qwerty xyz", tf_ok=True)
    assert r["porque"] == "sem_match"
    low = r["resposta"].casefold()
    assert "projector" not in low
    assert "savassi" not in low
    assert "herda" not in low

def test_regra_nao_treinada_nao_e_narrada():
    """Confiança no valor de nascimento não é "regra que entrou na conta".

    RuleBank inicializa em sigmoid(1)=0.7311, acima do corte de 0.5 que o
    report() usa — entao toda regra saía como ativada mesmo sem treino. No
    trainer municipal a variavel nem recebe gradiente.
    """
    jq = _load_jarvis_qa()
    assert jq.narrar_regras({"regras_ativadas": [["r", 0.7311]]}) == ""
    assert jq.narrar_regras({"regras_ativadas": [["r", 0.60]]}) != ""
    assert jq.narrar_regras({}) == ""

def test_rulebank_sem_regras_nao_cria_peso_morto():
    """RuleBank vazio nao pode registrar variavel treinavel.

    O `max(len(rules), 1)` antigo criava `rule_confidence` mesmo sem regra
    alguma. Nenhuma loss a tocava, entao o trainer municipal cuspia
    "Gradients do not exist for variables ['rule_bank/rule_confidence']" em
    todo run — alarme legitimo virando ruido de rotina.
    """
    import pytest

    pytest.importorskip("tensorflow")
    jq = _load_jarvis_qa()
    rn = jq._import_neuron()
    rn.set_seed()
    kg = rn.KnowledgeGraph({"a": 0, "b": 1}, {"r": 0}, [(0, 0, 1)])

    vazio = rn.ViabilityReasoner(kg, embedding_dim=8, max_hops=1)
    nomes = [v.name for v in vazio.trainable_variables]
    assert not any("rule_confidence" in n for n in nomes), nomes
    assert vazio.rules.confidence is None
    # report() nao pode quebrar sem a variavel
    assert vazio.report("a")["regras_ativadas"] == []

    com = rn.ViabilityReasoner(
        kg, embedding_dim=8, max_hops=1,
        rules=[rn.Rule(body=[0], head=0, name="x")],
    )
    assert tuple(com.rules.confidence.shape) == (1,)
    assert com.report("a")["regras_ativadas"]

def test_unknown_aba_lista_f1_a_f15(monkeypatch):
    monkeypatch.setenv("JARVIS_RAG", "0")
    jq = _load_jarvis_qa()
    r = jq.ask("qual a aba tensorboard do foobar inexistente?", tf_ok=True)
    assert r["modo"] == "regra"
    assert r["fontes"] == []
    # Deve citar aberturas f1..f15 ou os 15 títulos
    faqs = jq._default_faqs()
    assert len(faqs) >= 15
    mentioned = sum(1 for f in faqs if f.title in r["resposta"] or f.section_id in r["resposta"])
    assert mentioned >= 15, r["resposta"]

