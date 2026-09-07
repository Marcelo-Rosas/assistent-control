# JARVIS-Q — Bugbot leftovers (5c + smoke 10) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fechar os dois leftovers do Bugbot follow-up no contrato corrigido: smoke **5c** (TF off + `pede_rule_grounding` não vira `regra_fallback` de Projector) e smoke **10** (eco de `contexto.oferta=cruzar` após penetração, sem `sem_match` genérico).

**Architecture:** Ajustes mínimos em `scripts/jarvis_qa.py` + testes em `scripts/jarvis_qa_test.py` no worktree `feat/jarvis-eleven`. Não reabre RAG-first, matcher, voz, nem KG real de renda — bairro real fora do toy recebe recusa controlada (`bairro_fora_do_kg_toy`), não pitch Savassi.

**Tech Stack:** Python 3.11+, pytest, TensorFlow opcional nos paths que não são 5c/10, fake `jarvis_rag` nos testes de penetração.

**Spec:** `Docs/superpowers/specs/2026-09-03-jarvis-q-tf-design.md` (Bugbot B2/B6; smokes 5c e 10)  
**Checkout:** `C:\Users\marce\jarvis-eleven` branch `feat/jarvis-eleven`  
**Já feito (NÃO reimplementar):** plano `2026-09-06-jarvis-q-contract-gaps.md` (commit `ae034c2f`); voz `2026-09-06-jarvis-q-voice-design.md` (commit `cf580e21`); `is_playbook_factual_puro`, `kg_toy_indisponivel`, smokes 1–9, `contexto.oferta=cruzar` na penetração.

## Global Constraints

- Enum `modo`: `regra | rede | hibrido | regra_fallback | rag`
- `regra_fallback` **só** se `not tf_ok` **e** `playbook_factual_puro`
- `pede_rule_grounding` ⇒ com `not tf_ok` **nunca** FAQ Projector
- Após penetração com counts > 0: `contexto.oferta == "cruzar"`; preferir também `entidade = bairro:{slug}`
- Follow-up `sim` / eixo com `oferta=cruzar`: se entidade ∈ toy → eixo renda (default); se fora do toy → `modo=regra`, `porque=bairro_fora_do_kg_toy`, **sem** `sem_match` e **sem** pitch Projector/Savassi
- Commit só se o humano pedir; PowerShell one-liners

---

## File map

| Path | Responsabilidade |
|------|------------------|
| `scripts/jarvis_qa.py` | Setar `entidade` na penetração; follow-up sem entidade / fora do toy; garantir gate 5c |
| `scripts/jarvis_qa_test.py` | `test_ask_tf_off_projector_herda_renda_nao_fallback` (5c); `test_ask_penetracao_smoke10_eco_cruzar` (10) |
| `Docs/superpowers/specs/2026-09-03-jarvis-q-tf-design.md` | Só se o `porque=bairro_fora_do_kg_toy` ainda não estiver nomeado — uma linha em Errors |

**Fora desta onda:** merge `feat/jarvis-eleven` → `main`; KG real (renda IBGE); STT; body-walk RuleBank completo.

---

### Task 1: Smoke 5c — TF off + Projector + rule grounding

**Files:**
- Modify: `scripts/jarvis_qa_test.py`
- Modify: `scripts/jarvis_qa.py` (só se o teste falhar)

**Interfaces:**
- Consumes: `ask(texto, tf_ok=False)`, `is_playbook_factual_puro`, passo 2
- Produces: `modo != regra_fallback`; `porque` ∈ {`sem_match`, `kg_toy_indisponivel`} conforme bits; **não** `playbook:#f13` em `fontes`

- [ ] **Step 1: Write the failing test**

```python
def test_ask_tf_off_projector_herda_renda_nao_fallback():
    """Smoke 5c: pede_rule_grounding + TF off → não regra_fallback de Projector."""
    jq = _load_jarvis_qa()
    r = jq.ask("Projector herda renda?", tf_ok=False)
    assert r["modo"] != "regra_fallback", r
    assert "playbook:#f13" not in (r.get("fontes") or [])
    assert r["porque"] in ("sem_match", "kg_toy_indisponivel")
```

- [ ] **Step 2: Run test to verify it fails (or already passes)**

```powershell
cd C:\Users\marce\jarvis-eleven
.\.venv\Scripts\python.exe -m pytest scripts/jarvis_qa_test.py::test_ask_tf_off_projector_herda_renda_nao_fallback -v
```

Expected: FAIL se o passo 2 ainda promove FAQ sem gate; PASS se `is_playbook_factual_puro` já bloqueia (aí só documentar e ir ao Step 4).

- [ ] **Step 3: Minimal fix se FAIL**

No bloco `if not tf_ok:`: só `regra_fallback` quando `intent == "playbook_aba"` **e** `is_playbook_factual_puro(q, toy)` (toy pode ser `{}` se missing — gate ainda rejeita `herda`+`renda`).

Não promover `playbook_aba` a partir de `lixo` se `not is_playbook_factual_puro`.

- [ ] **Step 4: Run test — expect PASS**

```powershell
.\.venv\Scripts\python.exe -m pytest scripts/jarvis_qa_test.py::test_ask_tf_off_projector_herda_renda_nao_fallback scripts/jarvis_qa_test.py::test_ask_tf_off_projector_fallback -v
```

Expected: ambos PASS (factual puro ainda faz fallback; herda+renda não).

- [ ] **Step 5: Commit** (só se humano pedir)

```bash
git add scripts/jarvis_qa.py scripts/jarvis_qa_test.py
git commit -m "test(jarvis-q): smoke 5c — TF off + rule grounding nao vira playbook fallback"
```

---

### Task 2: Penetração grava `entidade` + smoke 10 eco `cruzar`

**Files:**
- Modify: `scripts/jarvis_qa.py` (`_try_rag_penetracao` / retorno do passo 0; follow-up 1b)
- Modify: `scripts/jarvis_qa_test.py`
- Modify (se preciso): `Docs/superpowers/specs/2026-09-03-jarvis-q-tf-design.md` — Errors: `bairro_fora_do_kg_toy`

**Interfaces:**
- Consumes: counts > 0 na penetração; `normalize_bairro_slug`; `ctx_in.oferta` / `ctx_in.entidade`
- Produces:
  - pós-penetração: `contexto == {entidade: "bairro:{slug}", oferta: "cruzar"}`
  - `ask("sim", contexto=eco)` ou `ask("e a renda?", contexto=eco)`:
    - se `entidade` ∈ `toy.entity2id` e `tf_ok` → eixo `tem_renda` (comportamento atual)
    - se `entidade` ∉ toy → `modo=regra`, `porque=bairro_fora_do_kg_toy`, `fontes=["rag:penetracao"]` (ou `kg:triple` vazio), prosa sem pitch toy
    - se `oferta=cruzar` e aceite e `entidade is None` → pedir bairro / `porque=cruzar_sem_entidade` (não `sem_match`)

- [ ] **Step 1: Write failing tests**

```python
def test_penetracao_contexto_entidade_e_oferta(monkeypatch):
    jq = _load_jarvis_qa()
    # Reutilizar FakeRag de counts > 0 (Paraíso / SP) — igual smoke 6
    monkeypatch.setitem(__import__("sys").modules, "jarvis_rag", _fake_rag_counts({
        "totalpass": 4, "wellhub": 10, "gurupass": 0, "receita": 27
    }))
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
    monkeypatch.setitem(__import__("sys").modules, "jarvis_rag", _fake_rag_counts({
        "totalpass": 4, "wellhub": 10, "gurupass": 0, "receita": 27
    }))
    r1 = jq.ask(
        "No bairro Paraíso em São Paulo, quantas usam TP vs WH vs GP?",
        tf_ok=True,
    )
    r2 = jq.ask("sim", tf_ok=True, contexto=r1["contexto"])
    assert r2["porque"] != "sem_match", r2
    # Paraíso não está no kg-toy → caminho honesto:
    assert r2["modo"] == "regra"
    assert r2["porque"] == "bairro_fora_do_kg_toy"
    assert "projector" not in r2["resposta"].casefold()
    assert "savassi" not in r2["resposta"].casefold()
```

- [ ] **Step 2: Run tests — expect FAIL**

```powershell
.\.venv\Scripts\python.exe -m pytest scripts/jarvis_qa_test.py::test_penetracao_contexto_entidade_e_oferta scripts/jarvis_qa_test.py::test_ask_penetracao_smoke10_eco_cruzar -v
```

Expected: FAIL (`entidade` ausente e/ou `sem_match` no segundo turno).

- [ ] **Step 3: Implement**

1. No passo 0 (após counts > 0), além de `oferta=cruzar`:

```python
slug = agg.get("bairro_slug") or jr.normalize_bairro_slug(bairro)
ctx_out.update({"oferta": "cruzar", "entidade": f"bairro:{slug}"})
# Merge into returned AskResult["contexto"] — ask() already applies ctx_out
```

Garantir que o `return pen` **não** zere `contexto` depois (hoje `pen["contexto"]={}` é descartado por `ask()` via `ctx_out` — manter esse contrato: popular `ctx_out`, não `pen["contexto"]`).

2. No follow-up 1b, **antes** de exigir tripla no toy:

```python
if (_e_aceite(q) or _quer_eixo(q)) and ctx_in.get("oferta") == "cruzar":
    corrente = ctx_in.get("entidade")
    if not corrente:
        return {
            "resposta": "Qual bairro o senhor quer cruzar com renda ou aluguel, {sr}?",
            "fala": "",
            "modo": "regra",
            "porque": "cruzar_sem_entidade",
            "fontes": ["rag:penetracao"],
            "contexto": {},
        }
    if corrente not in (toy.get("entity2id") or {}):
        label = _entity_label(corrente)
        ctx_out.update({"entidade": corrente, "oferta": "cruzar"})
        return {
            "resposta": (
                f"O grafo toy ainda não cobre {label}, {{sr}}. "
                f"A penetração ficou registrada; renda/aluguel desse bairro vem no KG real."
            ),
            "fala": "",
            "modo": "regra",
            "porque": "bairro_fora_do_kg_toy",
            "fontes": ["rag:penetracao", f"bairro:{corrente.split(':',1)[-1]}"],
            "contexto": {},
        }
    # else: caminho atual (eixo tem_renda / tem_aluguel)
```

Permitir follow-up mesmo com `not ents` e `faq is None`; **não** exigir `tf_ok` para o ramo `bairro_fora_do_kg_toy` (é regra, não rede).

3. Spec Errors (uma linha): `bairro_fora_do_kg_toy` = oferta cruzar após RAG quando slug ∉ toy.

- [ ] **Step 4: Run tests — expect PASS**

```powershell
.\.venv\Scripts\python.exe -m pytest scripts/jarvis_qa_test.py::test_penetracao_contexto_entidade_e_oferta scripts/jarvis_qa_test.py::test_ask_penetracao_smoke10_eco_cruzar scripts/jarvis_qa_test.py::test_penetracao_counts_positivos_oferece_cruzar scripts/jarvis_qa_test.py::test_followup_cumpre_a_oferta -v
```

Expected: PASS (Savassi follow-up antigo intacto).

- [ ] **Step 5: Commit** (só se humano pedir)

```bash
git add scripts/jarvis_qa.py scripts/jarvis_qa_test.py Docs/superpowers/specs/2026-09-03-jarvis-q-tf-design.md
git commit -m "fix(jarvis-q): smoke 10 — entidade apos penetracao e cruzar fora do toy"
```

---

### Task 3: Suite de regressão + sync spec

**Files:**
- Verify: `scripts/jarvis_qa_test.py`
- Sync: copiar spec atualizado para `assistent-control` se o worktree divergir

- [ ] **Step 1: Run focused suite**

```powershell
cd C:\Users\marce\jarvis-eleven
.\.venv\Scripts\python.exe -m pytest scripts/jarvis_qa_test.py -k "tf_off_projector or penetracao or followup or kg_toy" -v --tb=short
```

Expected: PASS

- [ ] **Step 2: Sync docs to main workspace (copy, sem commit)**

```powershell
Copy-Item C:\Users\marce\jarvis-eleven\Docs\superpowers\specs\2026-09-03-jarvis-q-tf-design.md `
  C:\Users\marce\assistent-control\Docs\superpowers\specs\2026-09-03-jarvis-q-tf-design.md -Force
Copy-Item C:\Users\marce\assistent-control\Docs\superpowers\plans\2026-09-06-jarvis-q-bugbot-leftovers.md `
  C:\Users\marce\jarvis-eleven\Docs\superpowers\plans\2026-09-06-jarvis-q-bugbot-leftovers.md -Force
```

- [ ] **Step 3: Commit** (só se humano pedir) — opcional, mensagem: `docs(jarvis-q): plan bugbot leftovers 5c+10`

---

## Spec coverage checklist

| Spec item | Task |
|-----------|------|
| Smoke 5c | T1 |
| Smoke 10 + `contexto.entidade` pós-RAG | T2 |
| Sem pitch toy na recusa de cruzar | T2 |
| Regressão fallback Projector factual / follow-up Savassi | T1–T3 |

## Out of scope (explicit)

- Merge `feat/jarvis-eleven` → `main`
- KG real (renda IBGE / bairro vivo) — **próximo produto** depois deste plano
- ElevenLabs / voz (já locked + implementado)
- Body-walk completo de `Rule.body` além da heurística atual

## Self-review

1. Spec smokes 5c e 10 mapeados 1:1 em tasks.  
2. Tipos/porque novos (`bairro_fora_do_kg_toy`, `cruzar_sem_entidade`) nomeados.  
3. Não reabre contract-gaps nem voz.  
4. Placeholder TBD: nenhum.  
5. Consistência: oferta cruzar continua; entidade agora âncora o turno 2.
