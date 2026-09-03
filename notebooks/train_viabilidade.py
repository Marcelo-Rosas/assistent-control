"""
Trainer de viabilidade municipal (Vectra Cargo)
===============================================
Treina o ViabilityReasoner sobre a base municipal de academia.train.json e
mede honestamente se o raciocínio relacional agrega valor sobre um baseline
flat — evitando o "número sem validação".

Granularidade: MUNICIPAL (645 cidades, já agregadas por ibge). Blocker gym->ibge
não se aplica aqui — os dados já vêm por município.

Label REAL: `recomendacao` (subconjunto de cidades flagado pelo negócio).
Não-circular entre eixos: demanda (renda/empresas IBGE) x oferta (gap de aggregator).

Provas anti-circularidade (ambas reportadas):
  1. BASELINE flat: logística sobre features cruas. Se o reasoner não bate o
     baseline, o grafo não agrega — e dizemos isso.
  2. MASKING: esconde as arestas de faixa (renda+gap) das cidades de validação
     e mede se o modelo ainda prevê via contexto relacional (região/aggregator).
     Se a AUC desaba pro nível do acaso, o valor relacional é nulo — reportado.

Uso: python notebooks/train_viabilidade.py [caminho_json]
"""
from __future__ import annotations

# pyright: reportIndexIssue=false, reportOperatorIssue=false
# pyright: reportReturnType=false, reportOptionalCall=false, reportArgumentType=false

import json
import sys

import numpy as np
import tensorflow as tf

from reasoning_neuron_viabilidade import KnowledgeGraph, ViabilityReasoner

DEFAULT_JSON = "data/academia.train.json"
AGGREGATORS = ("wellhub", "totalpass", "gurupass")
AGG_TOKEN = {"WH": "wellhub", "TP": "totalpass", "GP": "gurupass"}


# ----------------------------------------------------------------------------
# 1. Carregar dados municipais
# ----------------------------------------------------------------------------
def load_cidades(path: str) -> tuple[list[dict], set[str]]:
    d = json.load(open(path, encoding="utf-8"))
    cidades = d["cidades"]
    rec_set = {r["ibge"] for r in d.get("recomendacoes", [])}
    return cidades, rec_set


def _quartil_faixa(valores: np.ndarray) -> np.ndarray:
    """Mapeia valores contínuos em 0..3 por quartil (NaN -> quartil 0)."""
    v = np.array(valores, dtype=np.float64)
    finite = v[np.isfinite(v)]
    if finite.size == 0:
        return np.zeros(len(v), dtype=int)
    qs = np.quantile(finite, [0.25, 0.5, 0.75])
    out = np.zeros(len(v), dtype=int)
    for i, x in enumerate(v):
        if not np.isfinite(x):
            out[i] = 0
        else:
            out[i] = int(np.searchsorted(qs, x, side="right"))
    return out


# ----------------------------------------------------------------------------
# 2. Montar KG + labels + features flat
# ----------------------------------------------------------------------------
def build_kg(cidades: list[dict], rec_set: set[str]):
    entity2id: dict[str, int] = {}

    def eid(name: str) -> int:
        return entity2id.setdefault(name, len(entity2id))

    # Nós de faixa/região/aggregator (fixos)
    for q in range(4):
        eid(f"renda_q{q}")
        eid(f"pop_q{q}")
    for g in range(4):
        eid(f"gap_{g}")
    for agg in AGGREGATORS:
        eid(f"aggr:{agg}")

    def num(c: dict, *keys, default=np.nan):
        cur = c
        for k in keys:
            cur = (cur or {}).get(k) if isinstance(cur, dict) else None
        return cur if isinstance(cur, (int, float)) else default

    renda = np.array([num(c, "mercado", "renda_pc_mediana") for c in cidades])
    pop = np.array([num(c, "pop") for c in cidades])
    indice = np.array([num(c, "mercado", "indice_formal") for c in cidades])
    emp_mil = np.array([num(c, "mercado", "empresas_por_mil") for c in cidades])
    gap = np.array([int(c.get("gap_agg") or 0) for c in cidades])

    renda_q = _quartil_faixa(renda)
    pop_q = _quartil_faixa(pop)

    relation2id = {
        "na_regiao": 0, "faixa_renda": 1, "faixa_pop": 2,
        "faixa_gap": 3, "presente_em": 4,
    }
    triples: list[tuple[int, int, int]] = []
    city_ids: list[int] = []
    labels: list[int] = []
    masked_relations = {relation2id["faixa_renda"], relation2id["faixa_gap"]}

    for i, c in enumerate(cidades):
        cid = eid(f"cidade:{c['ibge']}")
        city_ids.append(cid)
        labels.append(1 if c["ibge"] in rec_set else 0)

        triples.append((cid, relation2id["na_regiao"], eid(f"regiao:{c.get('region','?')}")))
        triples.append((cid, relation2id["faixa_renda"], entity2id[f"renda_q{renda_q[i]}"]))
        triples.append((cid, relation2id["faixa_pop"], entity2id[f"pop_q{pop_q[i]}"]))
        triples.append((cid, relation2id["faixa_gap"], entity2id[f"gap_{min(gap[i],3)}"]))
        present = str(c.get("aggregators_present") or c.get("pattern") or "")
        for tok, agg in AGG_TOKEN.items():
            if tok in present:
                triples.append((cid, relation2id["presente_em"], entity2id[f"aggr:{agg}"]))

    kg = KnowledgeGraph(entity2id, relation2id, triples)

    # features flat para o baseline (demanda + oferta), padronizadas
    def fill(v):
        v = np.array(v, dtype=np.float64)
        m = np.nanmedian(v[np.isfinite(v)]) if np.isfinite(v).any() else 0.0
        v[~np.isfinite(v)] = m
        return v

    feats = np.stack([fill(renda), fill(pop), fill(indice), fill(emp_mil), gap.astype(float)], axis=1)
    feats = (feats - feats.mean(0)) / (feats.std(0) + 1e-8)

    return kg, np.array(city_ids), np.array(labels), feats, masked_relations


# ----------------------------------------------------------------------------
# 3. Métricas + baseline
# ----------------------------------------------------------------------------
def auc(y: np.ndarray, s: np.ndarray) -> float:
    y = np.asarray(y)
    pos, neg = np.sum(y == 1), np.sum(y == 0)
    if pos == 0 or neg == 0:
        return float("nan")
    order = np.argsort(s)
    ranks = np.empty(len(s), dtype=np.float64)
    ranks[order] = np.arange(1, len(s) + 1)
    return float((ranks[y == 1].sum() - pos * (pos + 1) / 2) / (pos * neg))


def logistic_baseline(Xtr, ytr, Xva, epochs=400, lr=0.1):
    """Logística numpy pura (sem sklearn) — baseline flat honesto."""
    w = np.zeros(Xtr.shape[1])
    b = 0.0
    for _ in range(epochs):
        z = Xtr @ w + b
        p = 1 / (1 + np.exp(-z))
        gw = Xtr.T @ (p - ytr) / len(ytr)
        gb = float(np.mean(p - ytr))
        w -= lr * gw
        b -= lr * gb
    return 1 / (1 + np.exp(-(Xva @ w + b)))


# ----------------------------------------------------------------------------
# 4. Treino + avaliação honesta
# ----------------------------------------------------------------------------
def main(path: str = DEFAULT_JSON) -> None:
    try:
        sys.stdout.reconfigure(encoding="utf-8")  # console Windows = cp1252
    except Exception:
        pass
    rng = np.random.default_rng(42)
    cidades, rec_set = load_cidades(path)
    kg, city_ids, labels, feats, masked_rel = build_kg(cidades, rec_set)
    n = len(city_ids)
    print(f"cidades={n} positivos(recomendacao)={int(labels.sum())} "
          f"entidades={kg.num_entities} relacoes_base={kg.num_base_relations}")

    # split estratificado 80/20
    idx = rng.permutation(n)
    va = np.concatenate([
        idx[labels[idx] == 1][: max(1, int(0.2 * (labels == 1).sum()))],
        idx[labels[idx] == 0][: max(1, int(0.2 * (labels == 0).sum()))],
    ])
    tr = np.setdiff1d(idx, va)
    ytr, yva = labels[tr], labels[va]

    # baseline flat
    base_va = logistic_baseline(feats[tr], ytr.astype(float), feats[va])
    auc_base = auc(yva, base_va)

    # reasoner
    model = ViabilityReasoner(kg, embedding_dim=32, max_hops=2)
    pos = np.array(kg.triples, dtype=np.int64)
    opt = tf.keras.optimizers.Adam(5e-3)
    ctr = city_ids[tr].astype(np.int64)
    ltr = tf.constant(ytr, tf.float32)

    for step in range(300):
        neg = pos.copy()
        neg[:, 2] = rng.integers(0, kg.num_entities, size=len(pos))
        with tf.GradientTape() as tape:
            H, _ = model.reason()
            loss = model.kge_loss(H, pos, neg) + model.viability_loss(H, ctr, ltr)
        grads = tape.gradient(loss, model.trainable_variables)
        opt.apply_gradients(zip(grads, model.trainable_variables))

    # AUC held-out sem masking
    H, _ = model.reason()
    s_va = tf.nn.sigmoid(model.viability_logit(H, city_ids[va].astype(np.int64))).numpy()
    auc_full = auc(yva, s_va)

    # AUC held-out COM masking (esconde faixa_renda+faixa_gap das cidades de val)
    val_city_set = set(city_ids[va].tolist())
    masked_triples = [
        t for t in kg.triples
        if not (t[0] in val_city_set and t[1] in masked_rel)
    ]
    kg_masked = KnowledgeGraph(kg.entity2id, kg.relation2id, masked_triples)
    model.adj = kg_masked.build_adjacencies()
    Hm, _ = model.reason()
    s_mask = tf.nn.sigmoid(model.viability_logit(Hm, city_ids[va].astype(np.int64))).numpy()
    auc_mask = auc(yva, s_mask)
    model.adj = kg.build_adjacencies()  # restaura

    # ---- veredito honesto ----
    print("\n=== Avaliação (held-out) ===")
    print(f"AUC baseline flat (logística) : {auc_base:.3f}")
    print(f"AUC reasoner (sem masking)    : {auc_full:.3f}")
    print(f"AUC reasoner (com masking)    : {auc_mask:.3f}")
    delta = auc_full - auc_base
    print("\n=== Veredito ===")
    if not np.isfinite(auc_full):
        print("INCONCLUSIVO: val sem classes suficientes.")
    elif delta < 0.02:
        print(f"Reasoner NÃO supera baseline (Δ={delta:+.3f}). Grafo agrega ~nada "
              f"além do flat; valor = trace explicável, não predição melhor.")
    elif auc_mask < 0.6:
        print(f"Reasoner bate baseline (Δ={delta:+.3f}) MAS desaba sob masking "
              f"({auc_mask:.3f}) → depende da feature direta, generalização "
              f"relacional fraca. Reportar com essa ressalva.")
    else:
        print(f"Reasoner supera baseline (Δ={delta:+.3f}) E sustenta sob masking "
              f"({auc_mask:.3f}) → há valor relacional real. Liberado p/ relatório.")

    print(f"\nCheckpoint salvável via model.save_weights(). N={n} é pequeno — "
          f"tratar como scoring estruturado + explicabilidade, não deep learning.")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else DEFAULT_JSON)
