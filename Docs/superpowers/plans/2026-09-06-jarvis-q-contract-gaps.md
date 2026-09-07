# JARVIS-Q — Fechamento de gaps do contrato (Implementation Plan)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fechar apenas os gaps remanescentes do contrato JARVIS-Q (híbrido engolido pelo playbook, `tf_ok` incompleto, boot preguiçoso do toy, smokes 8–9, `contexto.oferta=cruzar`, regressão do matcher, constantes e lista de abas) sem reimplementar RAG passo 0, matcher core nem smokes 1–7 que já passam.

**Architecture:** Ajustes pontuais em `scripts/jarvis_qa.py` (ordem de `_ask_raw`, gate factual-puro, definição de `tf_ok`, lazy toy, contexto pós-penetração) e em `scripts/jarvis_qa_test.py` (novos smokes). Constantes de limiar exportadas do neurônio. Body grounding verdadeiro e lista f1–f15 ficam como tarefas opcionais/curtas. Sem novo subsistema; sem reabrir RAG-first nem o parser do playbook.

**Tech Stack:** Python 3.11+, TensorFlow/Keras (`tensorflow>=2.17`), pytest, fixture `data/jarvis/kg-toy.json`, `scripts/jarvis_rag.py` (fake em testes), Windows via `.venv`.

**Spec:** `Docs/superpowers/specs/2026-09-03-jarvis-q-tf-design.md` (contrato corrigido 2026-09-06)  
**Checkout:** `C:\Users\marce\jarvis-eleven` branch `feat/jarvis-eleven`  
**Já feito (NÃO reimplementar):** fixture KG, playbook parse/matcher core, `ask()`/`AskResult`/`fala`, smokes 1–7 (Projector regra, viabilidade rede, híbrido sem Projector, `sem_match`, TF-off fallback, penetração RAG-first, ambiguidade geo), follow-up de contexto, voz.

## Global Constraints

- Campos exatos: `resposta` (PT-BR), `fala`, `modo`, `porque`, `fontes` (`list[str]`), `contexto` (`{entidade, oferta}`)
- Um `modo` por turno; enum: `regra | rede | hibrido | regra_fallback | rag`
- `regra_fallback` **só** quando `not tf_ok` **e** playbook factual casa
- `tf_ok` = import Keras/TF **e** `data/jarvis/kg-toy.json` carrega **e** `ViabilityReasoner` instancia
- Fixture ausente/corrupto em intent de grafo → `porque=kg_toy_indisponivel`, `modo=regra`, `fontes=[]` (não playbook genérico)
- Passo 0 penetração **independe** de `tf_ok` e **não** chama `_default_toy()` / reasoner
- Playbook factual puro (passo 3) **perde** para Rule com grounding (passo 4) → `hibrido`
- Matcher: NFKC + casefold; proibido match por primeiro token (`PR` ↛ `Projector`)
- Recusa: `modo=regra`, `fontes=[]`, `porque=sem_match` (ou `kg_toy_indisponivel`); sem pitch demo toy
- Constantes: `VIAB_ALTA=0.66`, `VIAB_MEDIA=0.40`, `INFER_THRESHOLD=0.7`
- Segredos: nunca gravar PAT / service role em git ou logs; `.env.local` gitignored
- Commit só se o humano pedir; PowerShell one-liners (sem `\` bash)

---

## File map (somente gaps)

| Path | Responsabilidade nesta onda |
|------|-----------------------------|
| `scripts/jarvis_qa.py` | Gate factual-puro; ordem híbrido vs playbook; `tf_ok` completo; lazy toy; `contexto.oferta` pós-RAG; lista abas; export/uso de limiares |
| `scripts/jarvis_qa_test.py` | Smokes 8–9; regressão Projector+híbrido; `kg_toy_indisponivel`; lazy boot; `match_playbook("o que é PR?")`; oferta cruzar |
| `notebooks/reasoning_neuron_viabilidade.py` | Exportar `VIAB_ALTA` / `VIAB_MEDIA` / `INFER_THRESHOLD` (Task 7) |
| `scripts/jarvis_rag.py` | Sem mudança estrutural (narrativa % já existe); só consumida pelos smokes 8–9 |

---

### Task 1: Híbrido não engolido pelo playbook (P0)

**Files:**
- Modify: `scripts/jarvis_qa.py` (`_ask_raw` — bloco intent/`playbook_aba` e passo 3 vs 4)
- Modify: `scripts/jarvis_qa_test.py`

**Interfaces:**
- Consumes: `match_playbook`, `toy["rules"]`, heurística atual `herda`+`renda` / `rule.name in q`
- Produces:
  - `is_playbook_factual_puro(q: str, toy: dict) -> bool` — `True` só se **não** pede grounding de Rule (`herda`+`renda`, nome de regra em `toy["rules"]`, ou caminho body→head explícito)
  - Com query `bairro:savassi herda renda no Projector?` → `modo=hibrido`, `fontes` contém `rule:bairro_bh_herda_renda` (playbook `#f13` **não** vence)

- [ ] **Step 1: Write the failing test**

```python
def test_ask_hibrido_vence_playbook_projector():
    """Spec empate 3 vs 4: Rule grounding vence playbook factual (Projector)."""
    import pytest

    pytest.importorskip("tensorflow")
    jq = _load_jarvis_qa()
    r = jq.ask("bairro:savassi herda renda no Projector?", tf_ok=True)
    assert r["modo"] == "hibrido", r
    assert any(f == "rule:bairro_bh_herda_renda" for f in r["fontes"]), r["fontes"]
    assert not any(f.startswith("playbook:") for f in r["fontes"]), r["fontes"]


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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest scripts/jarvis_qa_test.py::test_ask_hibrido_vence_playbook_projector scripts/jarvis_qa_test.py::test_is_playbook_factual_puro_gate -v`

Expected: FAIL — hoje `modo=regra` / `playbook:#f13` (passo 3 retorna antes do híbrido); `is_playbook_factual_puro` AttributeError

- [ ] **Step 3: Write minimal implementation**

Em `scripts/jarvis_qa.py`, adicionar:

```python
def is_playbook_factual_puro(q: str, toy: dict) -> bool:
    """Passo 3 do spec: playbook só se a query NÃO pede grounding de Rule."""
    qn = unicodedata.normalize("NFKC", q).casefold()
    if "herda" in qn and "renda" in qn:
        return False
    for r in toy.get("rules", []):
        name = (r.get("name") or "").casefold()
        if name and name in qn:
            return False
    return True
```

Em `_ask_raw`, **depois** de `faq = match_playbook(...)` e **antes** de promover `intent = "playbook_aba"`:

```python
    # Não promover playbook_aba se a query pede Rule (híbrido vence empate).
    if intent == "lixo" and faq is not None and is_playbook_factual_puro(q, toy):
        intent = "playbook_aba"
```

Remover/substituir o bloco antigo que fazia `if intent == "lixo" and faq is not None: intent = "playbook_aba"` sem o gate.

Garantir que o bloco híbrido (passo 4) rode **antes** de qualquer `return` de playbook com TF on, **ou** que o passo 3 só dispare quando `is_playbook_factual_puro` for True:

```python
    if intent == "playbook_aba" and faq is not None and is_playbook_factual_puro(q, toy):
        return {
            "resposta": faq_to_dialogue(faq),
            "modo": "regra",
            "porque": "FAQ deterministica playbook",
            "fontes": [f"playbook:#{faq.section_id}"],
        }
```

Se `faq` casou Projector mas o gate é False, **não** retornar playbook — cair no passo 4 (híbrido).

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest scripts/jarvis_qa_test.py::test_ask_hibrido_vence_playbook_projector scripts/jarvis_qa_test.py::test_is_playbook_factual_puro_gate scripts/jarvis_qa_test.py::test_ask_projector_regra scripts/jarvis_qa_test.py::test_ask_hibrido_regra_toy -v`

Expected: PASS (Projector puro continua `regra`/`#f13`; híbrido com Projector na frase vira `hibrido`)

- [ ] **Step 5: Commit** (só se o humano pedir)

```bash
git add scripts/jarvis_qa.py scripts/jarvis_qa_test.py
git commit -m "fix(jarvis-q): hybrid Rule grounding beats playbook factual puro"
```

---

### Task 2: `tf_ok` completo + `kg_toy_indisponivel` (P0)

**Files:**
- Modify: `scripts/jarvis_qa.py` (`tf_available`, `_ask_raw` / boot reasoner)
- Modify: `scripts/jarvis_qa_test.py`

**Interfaces:**
- Consumes: `TOY_PATH`, `build_reasoner` / `ViabilityReasoner`
- Produces:
  - `tf_available() -> bool` — True só se TF+keras importam **e** `kg-toy.json` parseia **e** um probe leve confirma que o reasoner pode subir (sem treinar de novo a cada chamada; cache ok)
  - Em intent `viabilidade` / `relacao_kg` / híbrido com TF import ok mas fixture morto: `modo=regra`, `porque=kg_toy_indisponivel`, `fontes=[]`

- [ ] **Step 1: Write the failing test**

```python
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest scripts/jarvis_qa_test.py::test_tf_ok_false_when_toy_missing scripts/jarvis_qa_test.py::test_ask_kg_toy_indisponivel_em_viabilidade -v`

Expected: FAIL — `tf_available()` hoje só checa import; ask pode estourar JSONDecodeError ou cair em playbook/recusa genérica

- [ ] **Step 3: Write minimal implementation**

```python
def tf_available() -> bool:
    if os.environ.get("JARVIS_QA_NO_TF") == "1":
        return False
    try:
        import tensorflow  # noqa: F401
        import keras  # noqa: F401
    except ImportError:
        return False
    try:
        raw = TOY_PATH.read_text(encoding="utf-8")
        data = json.loads(raw)
        if not data.get("entity2id") or not data.get("relation2id"):
            return False
    except (OSError, json.JSONDecodeError, TypeError):
        return False
    # Probe: neurônio importável (instanciação pesada fica no build_reasoner)
    try:
        _import_neuron()
    except Exception:
        return False
    return True
```

Em `_ask_raw`, quando o caminho de grafo precisa do toy e o load falha (ou `tf_ok` calculado False por fixture), **antes** de playbook genérico em intents de grafo:

```python
def _kg_indisponivel() -> AskResult:
    return {
        "resposta": (
            "O grafo toy está indisponível, {sr}. "
            "Não consigo fechar viabilidade nem relação agora."
        ),
        "fala": "",
        "modo": "regra",
        "porque": "kg_toy_indisponivel",
        "fontes": [],
        "contexto": {},
    }
```

Usar `_kg_indisponivel()` quando: intent ∈ {`viabilidade`, `relacao_kg`} ou híbrido pedido, e (`not tf_ok` por fixture **ou** `json.loads`/`build_reasoner` falha). **Não** usar para penetração (passo 0).

Carregar toy de forma segura:

```python
def _try_load_toy() -> dict | None:
    try:
        return _default_toy()
    except (OSError, json.JSONDecodeError, KeyError):
        return None
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest scripts/jarvis_qa_test.py::test_tf_ok_false_when_toy_missing scripts/jarvis_qa_test.py::test_ask_kg_toy_indisponivel_em_viabilidade scripts/jarvis_qa_test.py::test_ask_tf_off_projector_fallback -v`

Expected: PASS — Projector com TF off continua `regra_fallback`; grafo sem fixture → `kg_toy_indisponivel`

- [ ] **Step 5: Commit** (só se o humano pedir)

```bash
git add scripts/jarvis_qa.py scripts/jarvis_qa_test.py
git commit -m "fix(jarvis-q): tf_ok requires toy fixture and controlled kg_toy_indisponivel"
```

---

### Task 3: Lazy toy boot — penetração independente do fixture (P0)

**Files:**
- Modify: `scripts/jarvis_qa.py` (`_ask_raw` início)
- Modify: `scripts/jarvis_qa_test.py`

**Interfaces:**
- Consumes: `looks_like_penetracao`, `_try_rag_penetracao`
- Produces: passo 0 sem chamar `_default_toy()` / `parse_intent` com `entity2id` do toy; penetração funciona mesmo se `TOY_PATH` sumir

- [ ] **Step 1: Write the failing test**

```python
def test_penetracao_nao_depende_do_toy(tmp_path, monkeypatch):
    jq = _load_jarvis_qa()
    monkeypatch.setattr(jq, "TOY_PATH", tmp_path / "ausente.json")
    with jq._CACHE_LOCK:
        jq._CACHE.clear()

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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest scripts/jarvis_qa_test.py::test_penetracao_nao_depende_do_toy -v`

Expected: FAIL — `_ask_raw` chama `_default_toy()` antes do passo 0 → FileNotFoundError / JSON error

- [ ] **Step 3: Write minimal implementation**

Reordenar o início de `_ask_raw`:

```python
    faqs = faqs if faqs is not None else _default_faqs()
    q = unicodedata.normalize("NFKC", texto).casefold()
    ctx_in = ctx_in if ctx_in is not None else contexto_vazio()
    ctx_out = ctx_out if ctx_out is not None else {}

    # Passo 0: penetração ANTES de toy / parse_intent KG
    if looks_like_penetracao(texto):
        pen = _try_rag_penetracao(texto)
        if pen is not None:
            # Task 5 pode enriquecer ctx_out aqui
            return pen

    toy = toy if toy is not None else _try_load_toy()
    if toy is None:
        # intents de grafo tratados depois; playbook ainda pode responder
        names = []
        if tf_ok is None:
            tf_ok = False
    else:
        names = list(toy["entity2id"].keys())
        if tf_ok is None:
            tf_ok = tf_available()

    intent, ents = parse_intent(texto, names)
    faq = match_playbook(texto, faqs)
    # ... resto (sem segundo looks_like_penetracao)
```

Remover a chamada antecipada `toy = toy if toy is not None else _default_toy()` que hoje roda antes do RAG.

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest scripts/jarvis_qa_test.py::test_penetracao_nao_depende_do_toy scripts/jarvis_qa_test.py::test_ask_penetracao_rag_first scripts/jarvis_qa_test.py::test_ask_penetracao_ambiguidade_pede_cidade -v`

Expected: PASS

- [ ] **Step 5: Commit** (só se o humano pedir)

```bash
git add scripts/jarvis_qa.py scripts/jarvis_qa_test.py
git commit -m "fix(jarvis-q): delay toy boot until after penetracao step 0"
```

---

### Task 4: Ask smokes 8–9 (P1)

**Files:**
- Modify: `scripts/jarvis_qa_test.py`
- Touch only if prosa falhar: `scripts/jarvis_rag.py` (`narrar_penetracao` — já implementa a policy; não reescrever se os asserts passarem)

**Interfaces:**
- Consumes: `_try_rag_penetracao` / `ask` + fake `contar_penetracao`
- Produces: smoke 8 — `mesmo_escopo` e `max(TP,WH,GP) > Receita` → prosa **sem** `%` de mercado; smoke 9 — `Receita >= max` e `WH>0` → pode narrar `%` WH; `tf_ok=False` **não** desliga penetração

- [ ] **Step 1: Write the failing test**

```python
def _fake_rag_counts(counts, *, mesmo_escopo=True, cidade="São Paulo"):
    class _FakeRag:
        RagIndisponivel = RuntimeError

        @staticmethod
        def penetracao_disponivel():
            return True

        @staticmethod
        def normalize_bairro_slug(b):
            return "pinheiros"

        @staticmethod
        def bairro_ambiguo(b):
            return False

        @staticmethod
        def contar_penetracao(bairro, cidade=None):
            return {
                "bairro": bairro,
                "bairro_slug": "pinheiros",
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
            import jarvis_rag as real

            # Usa a prosa real se o módulo existir; senão reimport via path do jq
            return real.narrar_penetracao(agg)

        @staticmethod
        def disponivel():
            return False

        @staticmethod
        def buscar(q):
            raise AssertionError("buscar semantico nao deve rodar")

    return _FakeRag


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
```

Nota: se o Fake substituir o módulo `jarvis_rag` inteiro, o `import jarvis_rag as jr` **antes** do `setitem` captura a prosa real — manter essa ordem.

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest scripts/jarvis_qa_test.py::test_ask_penetracao_smoke8_sem_pct_quando_cobertura_gt_receita scripts/jarvis_qa_test.py::test_ask_penetracao_smoke9_pct_wh_e_tf_off -v`

Expected: FAIL se smokes ausentes; ou ajustar asserts se a prosa real já passa (nesse caso o Step 3 é no-op de produção e só adiciona os testes)

- [ ] **Step 3: Write minimal implementation**

Se smoke 8/9 falharem na prosa: em `narrar_penetracao`, manter a policy já documentada:

```python
    if mesmo_escopo and rec > 0 and max_cob > rec:
        # sem alegar market share / sem "%" de penetração afirmativa
        ...
    elif mesmo_escopo and rec > 0 and wh > 0:
        pct = 100.0 * wh / rec
        partes.append(
            f"Wellhub cobre cerca de {pct:.0f}% do universo Receita no bairro."
        )
```

Não alterar o roteador além do necessário para `tf_ok=False` ainda entrar no passo 0 (já deve, após Task 3).

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest scripts/jarvis_qa_test.py::test_ask_penetracao_smoke8_sem_pct_quando_cobertura_gt_receita scripts/jarvis_qa_test.py::test_ask_penetracao_smoke9_pct_wh_e_tf_off scripts/jarvis_qa_test.py::test_ask_penetracao_rag_first -v`

Expected: PASS

- [ ] **Step 5: Commit** (só se o humano pedir)

```bash
git add scripts/jarvis_qa_test.py scripts/jarvis_rag.py
git commit -m "test(jarvis-q): add penetracao smokes 8-9 for denom % policy"
```

---

### Task 5: `contexto.oferta="cruzar"` após penetração com counts > 0 (P1)

**Files:**
- Modify: `scripts/jarvis_qa.py` (`_try_rag_penetracao` e/ou `_ask_raw` ao retornar `pen`)
- Modify: `scripts/jarvis_qa_test.py`

**Interfaces:**
- Consumes: `AskResult.contexto` via `ctx_out` em `ask()`
- Produces: quando counts de cobertura > 0, `ask(...).contexto["oferta"] == "cruzar"` (entidade pode ficar `None` se não houver entidade KG)

- [ ] **Step 1: Write the failing test**

```python
def test_penetracao_counts_positivos_oferece_cruzar(monkeypatch):
    jq = _load_jarvis_qa()
    # Reusar o FakeRag de test_ask_penetracao_rag_first (counts > 0)
    # ... mesmo Fake com counts totalpass=4, wellhub=10 ...
    # (copiar o FakeRag do teste existente; não importar fixture compartilhada TBD)

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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest scripts/jarvis_qa_test.py::test_penetracao_counts_positivos_oferece_cruzar -v`

Expected: FAIL — hoje `_try_rag_penetracao` devolve `"contexto": {}` e `ask()` sobrescreve com `ctx_out` vazio (`oferta=None`)

- [ ] **Step 3: Write minimal implementation**

Opção mínima (preferida): em `_ask_raw`, ao receber `pen`:

```python
    if looks_like_penetracao(texto):
        pen = _try_rag_penetracao(texto)
        if pen is not None:
            fontes = pen.get("fontes") or []
            counts_pos = any(
                f.startswith(p) and f.split(":", 1)[-1] not in ("0", "")
                for f in fontes
                for p in ("tp:", "wh:", "gp:")
            )
            if counts_pos:
                ctx_out.update({"oferta": "cruzar"})
            # pen["contexto"] é descartado por ask(); ctx_out manda
            return pen
```

E em `_try_rag_penetracao`, a prosa de oferta ("Quer cruzar com renda ou aluguel no grafo?") já existe quando há cobertura — alinhar só o campo estruturado.

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest scripts/jarvis_qa_test.py::test_penetracao_counts_positivos_oferece_cruzar scripts/jarvis_qa_test.py::test_followup_cumpre_a_oferta -v`

Expected: PASS

- [ ] **Step 5: Commit** (só se o humano pedir)

```bash
git add scripts/jarvis_qa.py scripts/jarvis_qa_test.py
git commit -m "feat(jarvis-q): set contexto.oferta=cruzar after penetracao counts>0"
```

---

### Task 6: Regressão matcher — `match_playbook("o que é PR?") is None` (P1)

**Files:**
- Modify: `scripts/jarvis_qa_test.py`
- Modify only if falhar: `scripts/jarvis_qa.py` (`match_playbook`)

**Interfaces:**
- Consumes: `load_playbook` / `match_playbook` (regra locked: sem first-token; títulos `len < 4` ignorados no substring genérico)
- Produces: garantia de regressão — `PR` não casa `Projector`

- [ ] **Step 1: Write the failing test**

```python
def test_match_playbook_pr_nao_casa_projector():
    jq = _load_jarvis_qa()
    faqs = jq._default_faqs()
    assert jq.match_playbook("o que é PR?", faqs) is None
    assert jq.match_playbook("o que é Projector?", faqs) is not None
    hit = jq.match_playbook("o que é Projector?", faqs)
    assert hit.section_id == "f13"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest scripts/jarvis_qa_test.py::test_match_playbook_pr_nao_casa_projector -v`

Expected: PASS imediato se o matcher atual já está correto; se FAIL, ir ao Step 3

- [ ] **Step 3: Write minimal implementation** (só se necessário)

Manter a lógica locked:

```python
def match_playbook(text: str, faqs: list[PlaybookFaq]) -> PlaybookFaq | None:
    q = unicodedata.normalize("NFKC", text).casefold()
    if "projector" in q:
        for faq in faqs:
            if faq.title.casefold() == "projector":
                return faq
    for faq in faqs:
        t = faq.title.casefold()
        if len(t) < 4:
            continue  # evita "pr" / siglas curtas
        if t in q or (len(q) >= 4 and q in t):
            return faq
    return None
```

**Proibido** reintroduzir `title.split()[0] in query`.

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest scripts/jarvis_qa_test.py::test_match_playbook_pr_nao_casa_projector scripts/jarvis_qa_test.py::test_playbook_projector_is_f13 -v`

Expected: PASS

- [ ] **Step 5: Commit** (só se o humano pedir)

```bash
git add scripts/jarvis_qa_test.py scripts/jarvis_qa.py
git commit -m "test(jarvis-q): regress match_playbook so PR does not hit Projector"
```

---

### Task 7 (P2 opcional): Exportar `VIAB_ALTA` / `VIAB_MEDIA` / `INFER_THRESHOLD`

**Files:**
- Modify: `notebooks/reasoning_neuron_viabilidade.py`
- Modify: `scripts/jarvis_qa.py` (usar constantes no path `relacao_kg` / prosa se ainda houver literais `0.7` / `0.66`)
- Modify: `scripts/jarvis_qa_test.py`

**Interfaces:**
- Produces: `VIAB_ALTA = 0.66`, `VIAB_MEDIA = 0.40`, `INFER_THRESHOLD = 0.7` no módulo do neurônio; `report()` e `TripleScorer` paths consomem esses nomes

- [ ] **Step 1: Write the failing test**

```python
def test_constantes_viabilidade_exportadas():
    import sys
    from pathlib import Path

    nb = Path(__file__).resolve().parents[1] / "notebooks"
    sys.path.insert(0, str(nb))
    import reasoning_neuron_viabilidade as rn

    assert rn.VIAB_ALTA == 0.66
    assert rn.VIAB_MEDIA == 0.40
    assert rn.INFER_THRESHOLD == 0.7
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest scripts/jarvis_qa_test.py::test_constantes_viabilidade_exportadas -v`

Expected: FAIL AttributeError

- [ ] **Step 3: Write minimal implementation**

No topo de `reasoning_neuron_viabilidade.py` (após imports):

```python
VIAB_ALTA = 0.66
VIAB_MEDIA = 0.40
INFER_THRESHOLD = 0.7
```

Substituir literais em `report()`:

```python
rotulo = (
    "alta" if score >= VIAB_ALTA else "media" if score >= VIAB_MEDIA else "baixa"
)
```

E default de `infer_threshold: float = INFER_THRESHOLD`. Em `jarvis_qa.py` path `relacao_kg`, trocar `prob < 0.7` por `prob < rn.INFER_THRESHOLD` (ou importar a constante).

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest scripts/jarvis_qa_test.py::test_constantes_viabilidade_exportadas scripts/jarvis_qa_test.py::test_ask_viabilidade_savassi -v`

Expected: PASS

- [ ] **Step 5: Commit** (só se o humano pedir)

```bash
git add notebooks/reasoning_neuron_viabilidade.py scripts/jarvis_qa.py scripts/jarvis_qa_test.py
git commit -m "refactor(jarvis-q): export VIAB_ALTA/MEDIA and INFER_THRESHOLD"
```

---

### Task 8 (P2 opcional / later): True Rule body grounding

**Files:**
- Modify: `scripts/jarvis_qa.py` (seleção de `rule_hit`)
- Modify: `scripts/jarvis_qa_test.py`

**Interfaces:**
- Consumes: `Rule.body` (lista de relation ids), triplas do toy, entidades na query
- Produces: além do match por `name` / `herda`+`renda`, uma função `rule_body_grounds(query, toy, ents) -> Rule | None` que verifica se o caminho pedido (sujeito → hops do body → head) está coerente com as entidades citadas

**Nota de escopo:** se a implementação completa exigir refatorar o RuleBank / groundings do treino, **parar após o teste de regressão do nome** e deixar um stub documentado — o contrato v1 já aceita a heurística `herda`+`renda` + nome. Esta tarefa é opcional.

- [ ] **Step 1: Write the failing test**

```python
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest scripts/jarvis_qa_test.py::test_rule_body_grounds_savassi_renda -v`

Expected: FAIL AttributeError **ou** skip se a equipe marcar a task como later

- [ ] **Step 3: Write minimal implementation** (ou defer)

Mínimo aceitável nesta onda — wrapper explícito da heurística atual, nome estável para o próximo spec:

```python
def rule_body_grounds(texto: str, toy: dict, ents: list[str]) -> dict | None:
    """v1: heurística name / herda+renda. Body walk real = spec depois."""
    q = unicodedata.normalize("NFKC", texto).casefold()
    for r in toy.get("rules", []):
        name = r.get("name", "")
        if name and name.casefold() in q:
            return r
    if "herda" in q and "renda" in q and ents:
        return next(
            (r for r in toy.get("rules", []) if "herda" in r.get("name", "")),
            toy["rules"][0] if toy.get("rules") else None,
        )
    return None
```

Usar `rule_body_grounds` no passo 4 no lugar do loop duplicado. **Não** expandir para walk de embeddings nesta onda.

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest scripts/jarvis_qa_test.py::test_rule_body_grounds_savassi_renda scripts/jarvis_qa_test.py::test_ask_hibrido_vence_playbook_projector -v`

Expected: PASS

- [ ] **Step 5: Commit** (só se o humano pedir)

```bash
git add scripts/jarvis_qa.py scripts/jarvis_qa_test.py
git commit -m "refactor(jarvis-q): centralize rule_body_grounds heuristic for hybrid"
```

---

### Task 9 (P2 opcional): Unknown-aba lista f1–f15

**Files:**
- Modify: `scripts/jarvis_qa.py` (bloco `_looks_like_unknown_aba`)
- Modify: `scripts/jarvis_qa_test.py`

**Interfaces:**
- Consumes: `faqs: list[PlaybookFaq]` com `section_id` `f1`…`f15`
- Produces: recusa lista **todos** os títulos (ou `fN: Título`) das 15 abas, não só `faqs[:5]`

- [ ] **Step 1: Write the failing test**

```python
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest scripts/jarvis_qa_test.py::test_unknown_aba_lista_f1_a_f15 -v`

Expected: FAIL — hoje `sample = ", ".join(f.title for f in faqs[:5])`

- [ ] **Step 3: Write minimal implementation**

```python
    if faq is None and _looks_like_unknown_aba(q):
        sample = ", ".join(f"{f.section_id}:{f.title}" for f in faqs)
        return _recusa(
            f"Essa aba não consta, {{sr}}. Conheço estas: {sample}. Qual prefere?"
        )
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest scripts/jarvis_qa_test.py::test_unknown_aba_lista_f1_a_f15 -v`

Expected: PASS

- [ ] **Step 5: Commit** (só se o humano pedir)

```bash
git add scripts/jarvis_qa.py scripts/jarvis_qa_test.py
git commit -m "fix(jarvis-q): list all playbook tabs f1-f15 on unknown-aba"
```

---

## Ordem de execução recomendada

1. Task 3 (lazy toy) → desbloqueia penetração sem fixture  
2. Task 2 (`tf_ok` / `kg_toy_indisponivel`)  
3. Task 1 (híbrido vs playbook)  
4. Task 5 (`oferta=cruzar`)  
5. Task 4 (smokes 8–9)  
6. Task 6 (regressão PR)  
7. Tasks 7–9 sob demanda (P2)

## Self-review (cobertura dos gaps anunciados)

| Gap | Task |
|-----|------|
| P0 híbrido engolido por playbook | Task 1 |
| P0 `tf_ok` incompleto / `kg_toy_indisponivel` | Task 2 |
| P0 lazy toy vs penetração | Task 3 |
| P1 smokes 8–9 | Task 4 |
| P1 `contexto.oferta=cruzar` | Task 5 |
| P1 matcher `PR?` → None | Task 6 |
| P2 export limiares | Task 7 |
| P2 true body grounding | Task 8 (heurística nomeada; walk real = later) |
| P2 lista f1–f15 | Task 9 |

**Fora deste plano (já feito):** RAG passo 0 core, matcher Projector, smokes 1–7, voz/fala, follow-up anafora.

## Suite de regressão final

```powershell
python -m pytest scripts/jarvis_qa_test.py -v --tb=short
```

Expected: PASS em todos os testes existentes + novos das Tasks 1–6 (7–9 se executadas).
