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


def test_ask_lixo_sem_match():
    jq = _load_jarvis_qa()
    r = jq.ask("asdf qwerty", tf_ok=True)
    assert r["modo"] == "regra"
    assert r["porque"] == "sem_match"
    assert r["fontes"] == []


def test_ask_tf_off_projector_fallback():
    jq = _load_jarvis_qa()
    r = jq.ask("o que é Projector?", tf_ok=False)
    assert r["modo"] == "regra_fallback"
    assert "playbook:#f13" in r["fontes"]


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


def test_entidade_inexistente_nao_vira_relatorio():
    """Entidade fora do grafo tem de ser recusada, nao trocada por outra.

    Regressao: o match era `tail in q` cru, entao o "x" de gym:x casava dentro
    de "bairro:xpto" e o roteador respondia "X sustenta a tese" — relatorio de
    viabilidade sobre entidade que ninguem pediu e que nao existe.
    """
    import pytest

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


def test_sem_contexto_nao_inventa_entidade():
    """Follow-up sem conversa previa continua sendo recusa, nao chute."""
    import pytest

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
