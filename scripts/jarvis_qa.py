from __future__ import annotations

import json
import os
import re
import sys
import threading
import unicodedata
from dataclasses import dataclass
from pathlib import Path
from typing import Any, TypedDict

try:  # execucao como script (python scripts/jarvis_qa.py) vs import de pacote
    from jarvis_voice import to_speech, tratar
except ImportError:  # pragma: no cover
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    from jarvis_voice import to_speech, tratar

ROOT = Path(__file__).resolve().parents[1]
PLAYBOOK = ROOT / "public" / "playbook-tensorboard.html"
TOY_PATH = ROOT / "data" / "jarvis" / "kg-toy.json"

_CACHE: dict[str, Any] = {}
_CACHE_LOCK = threading.Lock()


class AskResult(TypedDict):
    resposta: str
    fala: str
    modo: str
    porque: str
    fontes: list[str]
    contexto: dict


# Contexto de conversa. Vive no payload (o cliente devolve no turno seguinte),
# nao numa sessao global: o server e multi-cliente e stateless por requisicao,
# entao guardar "a entidade corrente" no processo misturaria conversas.
def contexto_vazio() -> dict:
    return {"entidade": None, "oferta": None}


@dataclass
class PlaybookFaq:
    section_id: str
    title: str
    snippet: str


# Respostas curtas, faláveis — tom de mordomo, não dump do playbook.
# fontes (playbook:#fN) ficam no painel; a fala não cita o documento.
_PLAYBOOK_DIALOGUE: dict[str, str] = {
    "f1": (
        "Time Series é o painel único, {sr}: academias, renda e gap lado a lado. "
        "Comparo duas praças quando quiser."
    ),
    "f2": (
        "Scalars conta academias por faixa de renda. "
        "Costuma revelar o popular saturado enquanto o premium ainda respira."
    ),
    "f3": (
        "Custom Scalars empilha as cinco regiões, oferta contra renda. "
        "O Centro-Oeste costuma saltar: renda alta, oferta escassa."
    ),
    "f4": (
        "Images é o mapa de calor renda por plano. "
        "Onde falta cor, falta oferta premium — e aí mora a brecha."
    ),
    "f5": (
        "Essa aba não serve ao nosso caso, {sr}. Academia não gera áudio. "
        "Pode passar direto."
    ),
    "f6": (
        "Distributions mostra como a renda se espalha pela cidade, "
        "do bairro popular ao topo. Tenho São Paulo à mão, se quiser."
    ),
    "f7": (
        "Histograms revela se a cidade tem um mercado ou dois: "
        "volume popular de um lado, premium do outro."
    ),
    "f8": (
        "Text guarda o resumo em português junto dos números. "
        "A conclusão já vem escrita — poupa a leitura do gráfico."
    ),
    "f9": (
        "PR Curves mede se o filtro premium contra popular merece confiança, "
        "antes de o senhor gastar tempo no lead errado."
    ),
    "f10": (
        "HParams é a tabela-ranking de cidades: renda, oferta e gap. "
        "O senhor ordena e a melhor praça sobe sozinha."
    ),
    "f11": (
        "Mesh transforma o mercado numa nuvem 3D que gira com o dedo. "
        "As ilhas popular e premium aparecem sem planilha nenhuma."
    ),
    "f12": (
        "Profile só mede tempo e custo da análise. Hoje roda rápido, {sr} — "
        "não é onde está a oportunidade comercial."
    ),
    "f13": (
        "O Projector é o mapa onde o senhor pinta as academias "
        "por margem, aluguel ou região. Detalho alguma aba?"
    ),
    "f14": (
        "Viabilidade e Aluguel cruza a renda do bairro com o custo do ponto. "
        "Mostra onde a conta fecha para abrir academia."
    ),
    "f15": (
        "t-SNE é uma foto achatada, {sr}: tamanho e distância entre ilhas enganam. "
        "Olhe vários e confie apenas no que se repete."
    ),
}


def _first_sentence(text: str, max_len: int = 160) -> str:
    t = re.sub(r"\s+", " ", (text or "").strip())
    if not t:
        return ""
    for sep in (". ", "! ", "? "):
        i = t.find(sep)
        if 12 <= i <= max_len:
            return t[: i + 1].strip()
    if len(t) <= max_len:
        return t
    cut = t[: max_len - 1].rsplit(" ", 1)[0]
    return (cut or t[: max_len - 1]).rstrip(",;:") + "…"


def faq_to_dialogue(faq: PlaybookFaq) -> str:
    """Turn a playbook FAQ hit into a short spoken line (1–3 sentences)."""
    canned = _PLAYBOOK_DIALOGUE.get(faq.section_id)
    if canned:
        return canned
    gist = _first_sentence(faq.snippet, 140)
    title = (faq.title or "essa aba").strip()
    if gist:
        return f"{title}: {gist} Quer que eu detalhe?"
    return f"{title} está no playbook TensorBoard. Quer que eu resuma o essencial?"


# Relação do KG → substantivo falável. Sem isso a explicação sairia
# "pesou tem_renda", que é nome de campo, não fala.
_REL_PT: dict[str, str] = {
    "tem_renda": "a renda",
    "tem_aluguel": "o aluguel",
    "pertence_a": "a cidade",
    "coberto_por": "a cobertura de aggregator",
    "localizado_em": "a presença de academias",
}


def _rel_label(rel: str) -> str:
    return _REL_PT.get(rel, rel.replace("_", " "))


def narrar_fatores(report: dict, minimo: float = 0.05) -> str:
    """Frase curta dizendo O QUE pesou, a partir de `fatores_top`.

    `fatores_top` é a massa de contribuição por relação que o neurônio acumula
    nos hops (fix A6 do motor) — é a explicação por instância que o `report()`
    já calculava e o router jogava fora, respondendo apenas "a rede veio alta".

    Devolve "" quando não há contraste util para narrar: fator unico, tudo
    zerado, ou diferenca pequena demais para afirmar que um pesou mais. Nesse
    caso o chamador nao inventa explicacao.
    """
    fatores = [
        (rel, float(val))
        for rel, val in (report.get("fatores_top") or [])
        if float(val) > minimo
    ]
    if not fatores:
        return ""
    fatores.sort(key=lambda x: -x[1])
    primeiro = _rel_label(fatores[0][0])
    if len(fatores) == 1:
        return f"Pesou {primeiro}."
    # Segundo fator so entra se for comparavel ao primeiro; abaixo de 40% dele
    # a mencao sugeriria um equilibrio que os numeros nao mostram.
    segundo_val = fatores[1][1]
    if segundo_val < fatores[0][1] * 0.4:
        return f"Pesou sobretudo {primeiro}."
    return f"Pesou {primeiro}, com {_rel_label(fatores[1][0])} logo atrás."


# RuleBank inicializa `rule_confidence` com "ones" -> sigmoid(1) = 0.7311.
# O corte de 0.5 do `report()` fica ABAIXO do valor de nascimento, entao toda
# regra aparece como "ativada" mesmo sem treino nenhum. Medido: no trainer
# municipal a variavel nao recebe gradiente (nao ha regras nem
# consistency_loss, dai o warning do Keras) e fica exatamente em 0.7311; no
# toy ela se move apenas -0.0216. Narrar "a regra entrou na conta" com base
# nesse corte seria afirmacao vazia.
_CONF_INICIAL = 0.7311
_CONF_MOVIMENTO_MIN = 0.02


def narrar_regras(report: dict) -> str:
    """Fala apenas das regras cuja confiança o treino realmente deslocou.

    Distância do valor de inicialização — não o corte de 0.5 — é o que
    distingue regra aprendida de regra recém-nascida.
    """
    ativas = report.get("regras_ativadas") or []
    aprendidas = [
        str(nome).replace("_", " ")
        for nome, conf in ativas
        if abs(float(conf) - _CONF_INICIAL) >= _CONF_MOVIMENTO_MIN
    ]
    if not aprendidas:
        return ""
    if len(aprendidas) == 1:
        return f"A regra de {aprendidas[0]} também entrou na conta."
    return f"Entraram {len(aprendidas)} regras do grafo na conta."


def _entity_label(name: str) -> str:
    """bairro:savassi → Savassi (humano, falável)."""
    tail = name.split(":", 1)[-1].replace("_", " ").strip()
    return tail[:1].upper() + tail[1:] if tail else name


def load_playbook(path: Path) -> list[PlaybookFaq]:
    html = path.read_text(encoding="utf-8")
    faqs: list[PlaybookFaq] = []
    for m in re.finditer(
        r'<section[^>]*id="(f\d+)"[^>]*>(.*?)</section>',
        html,
        flags=re.I | re.S,
    ):
        sid, body = m.group(1), m.group(2)
        tm = re.search(r"<h2>(.*?)</h2>", body, flags=re.I | re.S)
        if not tm:
            continue
        title = unicodedata.normalize(
            "NFKC", re.sub(r"<[^>]+>", "", tm.group(1))
        ).strip()
        em = re.search(r'class="eli5"[^>]*>.*?<p>(.*?)</p>', body, flags=re.I | re.S)
        if em:
            snippet = re.sub(r"<[^>]+>", "", em.group(1)).strip()
        else:
            snippet = re.sub(r"<[^>]+>", " ", body)
            snippet = re.sub(r"\s+", " ", snippet).strip()[:400]
        faqs.append(PlaybookFaq(sid, title, snippet))
    return faqs


def match_playbook(text: str, faqs: list[PlaybookFaq]) -> PlaybookFaq | None:
    """Match FAQ by title substring; prefer Projector when query mentions it.

    Do not use first-token shortcuts like ``title.split()[0] in query`` — that
    false-matches ``PR`` (f9) inside ``Projector``.
    """
    q = unicodedata.normalize("NFKC", text).casefold()
    if "projector" in q:
        for faq in faqs:
            if faq.title.casefold() == "projector":
                return faq
    for faq in faqs:
        t = faq.title.casefold()
        if len(t) < 4:
            continue
        if t in q or (len(q) >= 4 and q in t):
            return faq
    return None


def parse_intent(text: str, entity_names: list[str]) -> tuple[str, list[str]]:
    """Return intent in {viabilidade, relacao_kg, lixo} plus matched entity ids.

    ``playbook_aba`` is assigned later in ``ask()`` when ``match_playbook`` hits
    and intent is still ``lixo``.
    """
    q = unicodedata.normalize("NFKC", text).casefold()
    # (posicao_na_pergunta, nome). A ordem importa: em relacao_kg o primeiro
    # vira sujeito e o segundo objeto. Iterando na ordem do dicionario,
    # "gym:x coberto_por aggr:totalpass" saia como "Totalpass coberto_por X" —
    # relacao afirmada na direcao inversa, que o motor trata como fato distinto
    # (relacao inversa e relacao propria, fix A5).
    hits: list[tuple[int, str]] = []
    for name in entity_names:
        low = name.casefold()
        tail = low.split(":", 1)[-1]
        if low in q:
            hits.append((q.index(low), name))
            continue
        # O tail solto exige fronteira de palavra E tamanho minimo. Com
        # `tail in q` cru, o "x" de gym:x casava dentro de "bairro:xpto" e o
        # roteador emitia relatorio de viabilidade sobre a entidade errada —
        # afirmando "sustenta a tese" para algo que ninguem perguntou e que
        # sequer existe no grafo. Mesmo guard de tamanho que match_playbook usa.
        if len(tail) >= 3:
            m = re.search(rf"\b{re.escape(tail)}\b", q)
            if m:
                hits.append((m.start(), name))
    ents = [name for _, name in sorted(hits)]

    viab = any(k in q for k in ("viavel", "viável", "viabilidade"))
    if viab and ents:
        return "viabilidade", ents

    rel_words = (
        "pertence_a",
        "tem_renda",
        "tem_aluguel",
        "coberto_por",
        "localizado_em",
    )
    if len(ents) >= 2 and any(w in q for w in rel_words):
        return "relacao_kg", ents
    if ents and any(w in q for w in rel_words):
        return "relacao_kg", ents

    # herda + renda → still viabilidade only if viab words; else leave for ask()
    return "lixo", ents


def tf_available() -> bool:
    if os.environ.get("JARVIS_QA_NO_TF") == "1":
        return False
    try:
        import tensorflow  # noqa: F401
        import keras  # noqa: F401

        return True
    except ImportError:
        return False


def _import_neuron():
    nb = ROOT / "notebooks"
    if str(nb) not in sys.path:
        sys.path.insert(0, str(nb))
    import reasoning_neuron_viabilidade as rn  # type: ignore

    return rn


def _toy_train_enabled() -> bool:
    """Treino LIGADO por padrao. `JARVIS_QA_TOY_TRAIN=0` desliga (so p/ teste).

    Opt-out, nao opt-in: sem treino o `report()` le pesos crus e devolve rotulo
    sorteado — o default nunca pode ser esse.
    """
    return os.environ.get("JARVIS_QA_TOY_TRAIN", "1") != "0"


def build_reasoner(toy: dict, *, train: bool | None = None):
    """Constroi o ViabilityReasoner do KG toy — semeado e treinado.

    A ordem importa: `set_seed()` precisa vir ANTES do construtor, porque os
    pesos sao sorteados no build. Sem semear + treinar, `report()` e ruido
    (0.1023-0.8310 na mesma entidade, afirmando "viavel" em 3/12 execucoes).
    """
    rn = _import_neuron()
    cfg = toy.get("train", {})
    rn.set_seed(int(cfg.get("seed", rn.DEFAULT_SEED)))

    kg = rn.KnowledgeGraph(
        toy["entity2id"],
        toy["relation2id"],
        [tuple(t) for t in toy["triples"]],
    )
    rules = [
        rn.Rule(body=r["body"], head=r["head"], name=r["name"]) for r in toy["rules"]
    ]
    model = rn.ViabilityReasoner(kg, embedding_dim=32, max_hops=2, rules=rules)

    if train is None:
        train = _toy_train_enabled()
    if train and cfg.get("viab_targets"):
        import numpy as np

        groundings = [
            (np.array(g["a"]), [np.array(m) for m in g["mids"]], np.array(g["b"]))
            for g in cfg.get("groundings", [])
        ]
        rn.train_reasoner(
            model,
            [tuple(t) for t in toy["triples"]],
            viab_targets=cfg["viab_targets"],
            viab_labels=cfg["viab_labels"],
            groundings=groundings,
            steps=int(cfg.get("steps", 200)),
        )
    return model


def _default_reasoner(toy: dict):
    """Reasoner treinado, memoizado — o treino custa ~2s, nao roda por pergunta."""
    with _CACHE_LOCK:
        if "reasoner" not in _CACHE:
            _CACHE["reasoner"] = build_reasoner(toy)
        return _CACHE["reasoner"]


def _default_faqs() -> list[PlaybookFaq]:
    with _CACHE_LOCK:
        if "faqs" not in _CACHE:
            _CACHE["faqs"] = load_playbook(PLAYBOOK)
        return _CACHE["faqs"]


def _default_toy() -> dict:
    with _CACHE_LOCK:
        if "toy" not in _CACHE:
            _CACHE["toy"] = json.loads(TOY_PATH.read_text(encoding="utf-8"))
        return _CACHE["toy"]


def _base_label(toy: dict) -> str:
    """Rotula a procedencia do score p/ o painel.

    `toy(supervisionado)` avisa que os labels de viabilidade foram DADOS ao
    modelo (savassi=1.0/centro=0.0), entao "alta" reflete a supervisao, nao
    evidencia de mercado. Um KG com labels reais deve trocar este rotulo.
    """
    return "toy(supervisionado)" if toy.get("train", {}).get("viab_labels") else "kg"


def looks_like_penetracao(text: str) -> bool:
    """Cobertura/penetração por bairro × agregador (TP/WH/GP)."""
    q = unicodedata.normalize("NFKC", text).casefold()
    tem_agreg = any(
        k in q
        for k in (
            "totalpass",
            "wellhub",
            "gurupass",
            "guru pass",
            " tp ",
            " wh ",
            " gp ",
            "vs wh",
            "vs tp",
            "vs gp",
            "tp vs",
            "wh vs",
            "cobertura",
            "penetra",
            "aceitam",
            "usam tp",
            "usam wh",
            "usam o total",
            "usam total",
            "usam well",
            "usam guru",
        )
    )
    # "tp vs wh" / "quantas usam" sem espaços laterais
    tem_agreg = tem_agreg or bool(
        re.search(r"\b(tp|wh|gp)\b", q)
    ) or ("total pass" in q)
    tem_bairro = "bairro" in q or bool(
        re.search(r"\bno\s+[a-záàâãéêíóôõúç]{3,}", q)
    )
    tem_contagem = any(
        k in q
        for k in (
            "quanta",
            "quantos",
            "qtd",
            "número",
            "numero",
            "vs",
            "versus",
            "compar",
            "penetra",
            "cobertura",
            "mercado",
        )
    )
    return bool(tem_agreg and (tem_bairro or tem_contagem))


# Cidades conhecidas (fold sem acento → display). Espelha jarvis_rag._CIDADE_CANON.
_CIDADES_QUERY: tuple[tuple[str, str], ...] = (
    ("sao bernardo do campo", "São Bernardo do Campo"),
    ("rio de janeiro", "Rio de Janeiro"),
    ("belo horizonte", "Belo Horizonte"),
    ("porto alegre", "Porto Alegre"),
    ("santo andre", "Santo André"),
    ("sao paulo", "São Paulo"),
    ("florianopolis", "Florianópolis"),
    ("brasilia", "Brasília"),
    ("campinas", "Campinas"),
    ("guarulhos", "Guarulhos"),
    ("curitiba", "Curitiba"),
    ("salvador", "Salvador"),
    ("fortaleza", "Fortaleza"),
    ("recife", "Recife"),
    ("goiania", "Goiânia"),
    ("belem", "Belém"),
    ("manaus", "Manaus"),
    ("vitoria", "Vitória"),
    ("santos", "Santos"),
    ("niteroi", "Niterói"),
)


def _fold_txt(s: str) -> str:
    s = unicodedata.normalize("NFD", s)
    s = "".join(c for c in s if unicodedata.category(c) != "Mn")
    return s.casefold()


def extract_cidade_from_query(text: str) -> str | None:
    """Extrai cidade: 'em Belo Horizonte', 'Paraíso São Paulo', trailing city."""
    q = unicodedata.normalize("NFKC", text)
    q_fold = _fold_txt(q)
    # Preferir match mais longo (São Bernardo antes de Santo …).
    for fold, display in sorted(_CIDADES_QUERY, key=lambda x: -len(x[0])):
        # "em Cidade" / "na Cidade" / "de Cidade" ou cidade colada ao fim do bairro.
        pat = rf"(?:(?:\bem|\bna|\bno)\s+)?\b{re.escape(fold)}\b"
        if re.search(pat, q_fold):
            return display
    return None


def _strip_cidade_do_bairro(cand: str, cidade: str | None) -> str | None:
    """Remove sufixo de cidade/conectores: 'Paraíso São Paulo' → 'Paraíso'."""
    c = cand.strip(" ,.?!:;")
    if not c:
        return None
    if cidade:
        city_fold = _fold_txt(cidade)
        city_n = len(cidade.split())
        words = c.split()
        if len(words) >= city_n and _fold_txt(" ".join(words[-city_n:])) == city_fold:
            words = words[:-city_n]
            while words and words[-1].casefold().strip(",") in (
                "em",
                "na",
                "no",
                "de",
                "da",
                "do",
            ):
                words.pop()
            c = " ".join(words).strip(" ,.?!:;")
    if not c:
        return None
    if c.casefold() in ("brasil", "total", "mercado", "grafo", "bairro"):
        return None
    return c


def extract_bairro_from_query(text: str) -> str | None:
    """Extrai nome do bairro: 'no bairro X', 'bairro X', 'X em Cidade'."""
    q = unicodedata.normalize("NFKC", text)
    cidade = extract_cidade_from_query(q)

    m = re.search(
        r"\bbairro\s+([A-Za-zÀ-ÿ0-9][A-Za-zÀ-ÿ0-9\-']*(?:\s+[A-Za-zÀ-ÿ0-9\-']+){0,4})",
        q,
        flags=re.I,
    )
    if m:
        got = _strip_cidade_do_bairro(m.group(1), cidade)
        if got:
            return got
    m = re.search(
        r"\bno\s+([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ0-9\-']*(?:\s+[A-Za-zÀ-ÿ0-9\-']+){0,3})",
        q,
        flags=re.I,
    )
    if m:
        got = _strip_cidade_do_bairro(m.group(1), cidade)
        if got:
            return got
    # "Savassi em Belo Horizonte" / "cobertura TP Paraíso São Paulo"
    if cidade:
        q_fold = _fold_txt(q)
        city_fold = _fold_txt(cidade)
        idx = q_fold.find(city_fold)
        if idx > 0:
            before = q[:idx].rstrip(" ,.?!:;")
            m2 = re.search(
                r"([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ0-9\-']*(?:\s+[A-Za-zÀ-ÿ0-9\-']+){0,3})\s*$",
                before,
            )
            if m2:
                got = _strip_cidade_do_bairro(m2.group(1), None)
                if got and got.casefold() not in (
                    "no",
                    "na",
                    "em",
                    "do",
                    "da",
                    "de",
                    "cobertura",
                    "quantas",
                    "usam",
                    "totalpass",
                    "wellhub",
                    "gurupass",
                ):
                    return got
    return None


def _try_rag_penetracao(texto: str) -> AskResult | None:
    """RAG-first: censo distinct TP/WH/GP (+ Receita) no bairro."""
    try:
        import jarvis_rag as jr
    except ImportError:
        return None
    if not jr.penetracao_disponivel():
        return None
    bairro = extract_bairro_from_query(texto)
    if not bairro:
        return None
    cidade = extract_cidade_from_query(texto)
    # Ambíguo sem cidade: perguntar — não mesclar Brasil.
    if not cidade and jr.bairro_ambiguo(bairro):
        label = bairro.strip().title()
        return {
            "resposta": (
                f"O bairro {label} existe em várias cidades. "
                f"Qual cidade o senhor quer — por exemplo São Paulo ou Belo Horizonte?"
            ),
            "fala": "",
            "modo": "rag",
            "porque": "penetracao; geo_ambiguidade; pedir_cidade",
            "fontes": [
                "rag:penetracao",
                f"bairro:{jr.normalize_bairro_slug(bairro)}",
                "geo:ambiguidade",
            ],
            "contexto": {},
        }
    try:
        agg = jr.contar_penetracao(bairro, cidade=cidade)
    except jr.RagIndisponivel:
        return None
    except Exception:
        return None
    counts = agg.get("counts") or {}
    if agg.get("geo_scope") == "ambiguidade":
        fala = jr.narrar_penetracao(agg)
        return {
            "resposta": fala,
            "fala": "",
            "modo": "rag",
            "porque": "penetracao; geo_ambiguidade; pedir_cidade",
            "fontes": [
                "rag:penetracao",
                f"bairro:{agg.get('bairro_slug') or bairro}",
                "geo:ambiguidade",
            ],
            "contexto": {},
        }
    if not any(int(counts.get(k) or 0) for k in ("totalpass", "wellhub", "gurupass", "receita")):
        onde = bairro.strip().title()
        if cidade:
            onde = f"{onde} ({cidade})"
        return {
            "resposta": (
                f"Não achei cobertura indexada no bairro {onde}, {{sr}}. "
                f"Posso tentar outro bairro ou cruzar com o grafo depois."
            ),
            "fala": "",
            "modo": "rag",
            "porque": "penetracao; counts=0; bairro sem match",
            "fontes": ["rag:penetracao", f"bairro:{jr.normalize_bairro_slug(bairro)}"],
            "contexto": {},
        }
    fala = jr.narrar_penetracao(agg)
    # TF é meio: oferta leve só quando há sinal de cobertura.
    if any(int(counts.get(k) or 0) for k in ("totalpass", "wellhub", "gurupass")):
        fala = fala.rstrip() + " Quer cruzar com renda ou aluguel no grafo?"
    fontes = [
        "rag:penetracao",
        f"bairro:{agg.get('bairro_slug') or bairro}",
        f"tp:{counts.get('totalpass', 0)}",
        f"wh:{counts.get('wellhub', 0)}",
        f"gp:{counts.get('gurupass', 0)}",
        f"receita:{counts.get('receita', 0)}",
    ]
    if agg.get("cidade"):
        fontes.append(f"cidade:{agg.get('cidade')}")
    if agg.get("geo_scope"):
        fontes.append(f"geo:{agg.get('geo_scope')}")
    return {
        "resposta": fala,
        "fala": "",
        "modo": "rag",
        "porque": (
            f"penetracao RAG-first; distinct por academia; "
            f"tp={counts.get('totalpass')}; wh={counts.get('wellhub')}; "
            f"gp={counts.get('gurupass')}; receita={counts.get('receita')}; "
            f"geo={agg.get('geo_scope')}"
        ),
        "fontes": fontes,
        "contexto": {},
    }


def _try_rag(texto: str) -> AskResult | None:
    """Fonte RAG só quando grafo/playbook não fecharam. Nunca decide no lugar deles.

    Retorna AskResult modo=rag ou None (cai na recusa). Falha de Ollama/Supabase
    não vira erro pro usuário — vira silêncio e sem_match.
    """
    try:
        import jarvis_rag as jr
    except ImportError:
        return None
    if not jr.disponivel():
        return None
    try:
        chunks = jr.buscar(texto)
    except jr.RagIndisponivel:
        return None
    except Exception:
        return None
    if not chunks:
        return None
    fala = jr.narrar(chunks)
    if not fala:
        return None
    top = chunks[0]
    sim = float(top.get("similarity") or top.get("score") or 0)
    cid = top.get("chunk_id") or top.get("id") or "?"
    grupo = top.get("_grupo") or "?"
    fontes = [f"chunk:{cid}", f"sim:{sim:.2f}", f"grupo:{grupo}"]
    for c in chunks[1:]:
        cid2 = c.get("chunk_id") or c.get("id")
        if cid2:
            fontes.append(f"chunk:{cid2}")
    return {
        "resposta": fala,
        "fala": "",
        "modo": "rag",
        "porque": (
            f"RAG (fonte); sim={sim:.3f}; grupo={grupo}; "
            "não é fato do grafo"
        ),
        "fontes": fontes,
        "contexto": {},
    }


def _recusa(resposta: str) -> AskResult:
    return {
        "resposta": resposta,
        "fala": "",  # preenchido por ask()
        "modo": "regra",
        "porque": "sem_match",
        "fontes": [],
        "contexto": {},  # preenchido por ask()
    }


_ACEITES = (
    "sim",
    "pode",
    "claro",
    "vamos",
    "isso",
    "por favor",
    "manda",
    "quero",
    "aceito",
)


def _quer_eixo(q: str) -> str | None:
    """Eixo pedido no follow-up: aluguel ou renda."""
    if "aluguel" in q:
        return "tem_aluguel"
    if "renda" in q:
        return "tem_renda"
    return None


def _quer_porque(q: str) -> bool:
    # "por qu" cobre "por que" / "por quê"; "porqu" cobre "porque" / "porquê".
    # Casar as quatro grafias uma a uma deixava "por quê?" de fora.
    return any(
        k in q for k in ("por qu", "porqu", "detalh", "explic", "como assim", "no que")
    )


def _e_aceite(q: str) -> bool:
    """Aceite curto ("sim", "pode") — so vale em frase curta.

    Exigir frase curta evita que um "sim" solto dentro de uma pergunta longa e
    diferente seja lido como aceite da oferta anterior.
    """
    qs = q.strip().rstrip("?!.")
    if len(qs) > 24:
        return False
    return any(qs == a or qs.startswith(a + " ") for a in _ACEITES)


def _objeto_da_relacao(toy: dict, ent: str, rel: str) -> str | None:
    """Le do GRAFO o objeto de (ent, rel, ?). Fato, nao inferencia.

    O follow-up sobre aluguel/renda tem de sair da KB explicita: inferir isso
    da rede seria afirmar o que o grafo nao diz.
    """
    e2i, r2i = toy["entity2id"], toy["relation2id"]
    if ent not in e2i or rel not in r2i:
        return None
    i2e = {v: k for k, v in e2i.items()}
    s_id, r_id = e2i[ent], r2i[rel]
    for a, r, o in toy["triples"]:
        if a == s_id and r == r_id:
            return i2e.get(o)
    return None


def _valor_label(nome: str) -> str:
    """renda:alta -> "alta"; aluguel:medio -> "médio"."""
    tail = nome.split(":", 1)[-1]
    return {"medio": "médio", "media": "média"}.get(tail, tail)


def _looks_like_viabilidade(q: str) -> bool:
    return any(k in q for k in ("viavel", "viável", "viabilidade"))


def _looks_like_unknown_aba(q: str) -> bool:
    return any(k in q for k in ("aba", "tensorboard", "playbook"))


def _hybrid_conflict(reasoner, toy: dict) -> bool:
    """Optional body>head check on toy grounding (savassi→bh→renda:alta)."""
    try:
        import numpy as np
        import tensorflow as tf

        e2i = toy["entity2id"]
        a = np.array([e2i["bairro:savassi"]], dtype=np.int32)
        mid = np.array([e2i["cidade:bh"]], dtype=np.int32)
        b = np.array([e2i["renda:alta"]], dtype=np.int32)
        H, _ = reasoner.reason()
        rule = reasoner.rules.rules[0]
        chain = [a, mid, b]
        body = tf.ones([1], tf.float32)
        for k, r in enumerate(rule.body):
            r_ids = tf.fill([1], r)
            body *= reasoner.scorer.prob(H, chain[k], r_ids, chain[k + 1])
        head_ids = tf.fill([1], rule.head)
        head = reasoner.scorer.prob(H, a, head_ids, b)
        return bool(float(tf.nn.relu(body - head)[0]) > 0)
    except Exception:
        return False


def ask(
    texto: str,
    *,
    tf_ok: bool | None = None,
    reasoner=None,
    faqs: list[PlaybookFaq] | None = None,
    toy: dict | None = None,
    contexto: dict | None = None,
) -> AskResult:
    """Porta publica: roteia e devolve a resposta ja no registro falado.

    `resposta` e o texto de tela (vocativo aplicado); `fala` e a mesma frase
    normalizada para o sintetizador — sigla e decimal viram grafia pronunciavel.
    Ver jarvis_voice.
    """
    ctx_in = dict(contexto) if contexto else contexto_vazio()
    ctx_out = contexto_vazio()
    out = _ask_raw(
        texto,
        tf_ok=tf_ok,
        reasoner=reasoner,
        faqs=faqs,
        toy=toy,
        ctx_in=ctx_in,
        ctx_out=ctx_out,
    )
    out["resposta"] = tratar(out["resposta"])
    out["fala"] = to_speech(out["resposta"])
    out["contexto"] = ctx_out
    return out


def _ask_raw(
    texto: str,
    *,
    tf_ok: bool | None = None,
    reasoner=None,
    faqs: list[PlaybookFaq] | None = None,
    toy: dict | None = None,
    ctx_in: dict | None = None,
    ctx_out: dict | None = None,
) -> AskResult:
    if tf_ok is None:
        tf_ok = tf_available()

    faqs = faqs if faqs is not None else _default_faqs()
    toy = toy if toy is not None else _default_toy()
    names = list(toy["entity2id"].keys())
    q = unicodedata.normalize("NFKC", texto).casefold()

    ctx_in = ctx_in if ctx_in is not None else contexto_vazio()
    ctx_out = ctx_out if ctx_out is not None else {}

    intent, ents = parse_intent(texto, names)
    faq = match_playbook(texto, faqs)

    # --- RAG-first: penetração bairro × agregadores (antes do toy TF) ---
    if looks_like_penetracao(texto):
        pen = _try_rag_penetracao(texto)
        if pen is not None:
            return pen

    # --- step 1b: follow-up sobre a entidade do turno anterior ---
    # Sem isso o JARVIS oferecia "Cruzo com aluguel ou renda?" e respondia
    # "essa eu nao fecho" ao "sim" seguinte — oferta que o sistema nao honrava.
    corrente = ctx_in.get("entidade")
    if tf_ok and corrente and not ents and faq is None:
        eixo = _quer_eixo(q)
        oferta = ctx_in.get("oferta")
        if eixo is None and _e_aceite(q) and oferta == "cruzar":
            eixo = "tem_renda"  # default da oferta "aluguel ou renda"
        rotulo_ctx = _entity_label(corrente)

        if eixo:
            alvo = _objeto_da_relacao(toy, corrente, eixo)
            ctx_out.update({"entidade": corrente, "oferta": "cruzar"})
            if alvo is None:
                return {
                    "resposta": (
                        f"O grafo não registra esse eixo para {rotulo_ctx}, {{sr}}."
                    ),
                    "fala": "",
                    "modo": "regra",
                    "porque": f"sem tripla ({corrente}, {eixo}, ?)",
                    "fontes": ["kg:triple"],
                    "contexto": {},
                }
            # Artigo vem do eixo; o adjetivo ja vem flexionado do proprio KG
            # (renda:alta / aluguel:alto), entao nao ha concordancia a inferir.
            termo = "o aluguel" if eixo == "tem_aluguel" else "a renda"
            return {
                "resposta": (
                    f"Em {rotulo_ctx} {termo} é {_valor_label(alvo)}. "
                    f"Sigo com outro eixo?"
                ),
                "fala": "",
                "modo": "regra",
                "porque": f"tripla ({corrente}, {eixo}, {alvo}) lida do KG",
                "fontes": ["kg:triple"],
                "contexto": {},
            }

        if _quer_porque(q):
            if reasoner is None:
                reasoner = _default_reasoner(toy)
            rep = reasoner.report(corrente)
            detalhe = narrar_fatores(rep, minimo=0.0) or "Não houve fator dominante."
            regras = narrar_regras(rep)
            ctx_out.update({"entidade": corrente, "oferta": "porque"})
            return {
                "resposta": f"{detalhe} {regras}".strip(),
                "fala": "",
                "modo": "rede",
                "porque": (
                    f"fatores_top={rep.get('fatores_top')}; "
                    f"base={_base_label(toy)}"
                ),
                "fontes": [f"report:{corrente}", "kg:triple"],
                "contexto": {},
            }

    # Anafora: "e o centro?" herda a intencao de viabilidade do turno anterior.
    # Enumerar as ofertas que permitem anafora deixava buracos ("porque" ficou
    # de fora e "e o centro?" caia em recusa). O sinal certo e haver conversa
    # em curso: se ja falamos de uma entidade e o usuario cita outra, ele quer
    # a mesma leitura sobre ela.
    if ents and intent == "lixo" and ctx_in.get("entidade"):
        intent = "viabilidade"
    # Viabilidade+ents wins over playbook (f14 title starts with Viabilidade).
    if intent == "lixo" and faq is not None:
        intent = "playbook_aba"

    # --- step 2: TF off ---
    if not tf_ok:
        if intent == "playbook_aba" and faq is not None:
            return {
                "resposta": faq_to_dialogue(faq),
                "modo": "regra_fallback",
                "porque": "tf indisponivel; FAQ playbook",
                "fontes": [f"playbook:#{faq.section_id}"],
            }
        return _recusa(
            "Estou sem TensorFlow e sem aba do playbook para essa pergunta, {sr}. "
            "Reformule ou peça uma aba pelo nome."
        )

    # --- step 3: playbook + TF (only when intent is playbook_aba) ---
    if intent == "playbook_aba" and faq is not None:
        return {
            "resposta": faq_to_dialogue(faq),
            "modo": "regra",
            "porque": "FAQ deterministica playbook",
            "fontes": [f"playbook:#{faq.section_id}"],
        }

    # Ensure reasoner when hybrid / rede paths need it.
    # NÃO subir TF só porque a frase citou uma entidade do toy — senão
    # "pilates na Savassi" paga 20s de reasoner antes do RAG (fonte).
    if reasoner is None and (
        any(r["name"].casefold() in q for r in toy.get("rules", []))
        or ("herda" in q and "renda" in q and ents)
        or intent in ("viabilidade", "relacao_kg")
    ):
        try:
            reasoner = _default_reasoner(toy)
        except ImportError:
            return _recusa(
                "O motor de rede não subiu, {sr}. As abas do playbook seguem à disposição."
            )

    # --- step 4: hybrid (wins over rede) ---
    rule_hit = None
    for r in toy.get("rules", []):
        name = r.get("name", "")
        if name and name.casefold() in q:
            rule_hit = r
            break
    if rule_hit is None and ("herda" in q and "renda" in q and ents):
        rule_hit = next(
            (r for r in toy.get("rules", []) if "herda" in r.get("name", "")),
            toy["rules"][0] if toy.get("rules") else None,
        )

    if rule_hit is not None:
        rname = rule_hit["name"]
        porque = f"regra {rname} grounding no KG"
        conflito = False
        if reasoner is not None:
            ativ = []
            try:
                conf = reasoner.rules.confidence
                import tensorflow as tf

                conf_np = tf.nn.sigmoid(conf).numpy()
                for i, rr in enumerate(reasoner.rules.rules):
                    if conf_np[i] > 0.5:
                        ativ.append(rr.name or f"regra_{i}")
            except Exception:
                ativ = [rname]
            if ativ:
                porque += f"; regras_ativadas={','.join(ativ)}"
            conflito = _hybrid_conflict(reasoner, toy)
            if conflito:
                porque += "; conflito"
        who = ", ".join(_entity_label(e) for e in ents) if ents else "esse caminho"
        if "herda" in rname or ("herda" in q and "renda" in q):
            resp = (
                f"Pela regra híbrida, {who} herda o sinal de renda pelo grafo. "
                f"Examino a viabilidade também?"
            )
        else:
            resp = (
                f"Cruzei regra e rede, {{sr}}: {who} encaixa na regra {rname}. "
                f"Abro o detalhe técnico?"
            )
        if conflito:
            resp = (
                f"Há um conflito leve no grounding da regra {rname}, {{sr}}. "
                f"O caminho híbrido ainda aponta para {who}, com essa ressalva."
            )
        if ents:
            ctx_out.update({"entidade": ents[0], "oferta": "angulo"})
        return {
            "resposta": resp,
            "modo": "hibrido",
            "porque": porque,
            "fontes": [f"rule:{rname}", "kg:triple"],
            "contexto": {},
        }

    # --- step 5: rede ---
    if ents and intent == "viabilidade":
        if reasoner is None:
            reasoner = _default_reasoner(toy)
        report = reasoner.report(ents[0])
        rotulo = report["rotulo"]
        label = _entity_label(ents[0])
        score = report["viabilidade"]
        # O veredito sozinho ("a rede veio alta") nao e analise. `porquê` diz o
        # que pesou; sai da mesma chamada, sem custo extra.
        porq = narrar_fatores(report)
        # Score fica em porque (painel), não na fala.
        if rotulo == "alta":
            resp = f"{label} sustenta a tese, {{sr}}. "
            resp += f"{porq} " if porq else ""
            resp += "Cruzo com aluguel ou renda?"
        elif rotulo == "media":
            resp = f"Em {label} eu ficaria no meio do caminho. "
            resp += f"{porq} " if porq else ""
            resp += "Busco outro ângulo?"
        else:
            resp = f"O sinal de {label} está baixo, {{sr}}. "
            resp += f"{porq} " if porq else ""
            resp += "Comparo com outro bairro?"
        ctx_out.update(
            {
                "entidade": ents[0],
                "oferta": "cruzar" if rotulo == "alta" else "comparar",
            }
        )
        return {
            "resposta": resp,
            "modo": "rede",
            "porque": (
                f"rotulo={rotulo}; score={score}; via report(); "
                f"base={_base_label(toy)}"
            ),
            "fontes": [f"report:{ents[0]}", "kg:triple"],
            "contexto": {},
        }

    if ents and intent == "relacao_kg":
        if reasoner is None:
            reasoner = _default_reasoner(toy)

        e2i = toy["entity2id"]
        r2i = toy["relation2id"]
        rel_name = next(
            (w for w in r2i if w in q),
            next(iter(r2i)),
        )
        s_name = ents[0]
        o_name = ents[1] if len(ents) >= 2 else None
        if o_name is None:
            for name in names:
                if name != s_name and (
                    name.casefold() in q or name.split(":", 1)[-1].casefold() in q
                ):
                    o_name = name
                    break
        if o_name is None:
            return _recusa(
                f"Entendi a relação, mas falta o outro lado, {{sr}}. "
                f"Assim: {_entity_label(s_name)} {rel_name} cidade:bh."
            )
        s_id, r_id, o_id = e2i[s_name], r2i[rel_name], e2i[o_name]
        H, _ = reasoner.reason()
        prob = float(
            reasoner.scorer.prob(H, [s_id], [r_id], [o_id])[0]
        )
        known = reasoner.kg.is_known(s_id, r_id, o_id)
        sl, ol = _entity_label(s_name), _entity_label(o_name)
        if not known and prob < 0.7:
            resp = (
                f"Não tenho confiança para afirmar que {sl} {rel_name} {ol}, {{sr}}. "
                f"Prefiro não arriscar. Tento outra relação?"
            )
        elif known:
            resp = f"Confirmo: {sl} {rel_name} {ol}. Consta no grafo."
        else:
            resp = (
                f"A rede sugere que {sl} {rel_name} {ol}, "
                f"com confiança suficiente para eu afirmar."
            )
        return {
            "resposta": resp,
            "modo": "rede",
            "porque": f"TripleScorer prob={prob:.3f}; known={known}",
            "fontes": ["kg:triple"],
        }

    # Unknown entity that looks like viabilidade — tenta RAG antes de recusar
    # (ex.: "pilates na Savassi" pode não estar no toy KG).
    if _looks_like_viabilidade(q) and not ents:
        rag = _try_rag(texto)
        if rag is not None:
            return rag
        return _recusa(
            "Não localizei essa entidade no grafo, {sr}. Savassi, por exemplo, eu tenho."
        )

    # Unknown aba / tensorboard tab
    if faq is None and _looks_like_unknown_aba(q):
        sample = ", ".join(f.title for f in faqs[:5])
        return _recusa(
            f"Essa aba não consta, {{sr}}. Conheço estas: {sample}. Qual prefere?"
        )

    # --- step 6: RAG (fonte) → senão recusa ---
    # Ordem: playbook/híbrido/rede já tentaram. RAG não sobrepõe veredito TF.
    rag = _try_rag(texto)
    if rag is not None:
        return rag

    return _recusa(
        "Essa eu não fecho, {sr}. Posso buscar cobertura de agregador por bairro "
        "ou uma aba do playbook pelo nome. O que prefere?"
    )


def main(argv: list[str] | None = None) -> int:
    args = argv if argv is not None else sys.argv[1:]
    if not args:
        print('uso: python scripts/jarvis_qa.py "pergunta"', file=sys.stderr)
        return 2
    texto = args[0]
    # Windows consoles default to a legacy code page; force UTF-8 for JSON.
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    print(json.dumps(ask(texto), ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
