"""
Passo 4 — Baseline no painel as-of (SPEC_FEATURES_TEMPORAIS_VIABILIDADE, RD-05).
Pergunta: features TEMPORAIS (parque trajetória + CAGED) preveem fechamento(t+1)
melhor que o size-only e que o estático (renda), cujo sinal era r≈0?

Split temporal (treina <=2024Q4, testa >=2025Q1). Métrica AUC + PR-AUC (alvo raro).
Modelos comparados:
  A size-only   : [parque_ativo_fim]          -> "tamanho prevê trivialmente?"
  B static-only : [renda_pc, percentil]        -> replica o achado r≈0
  C temporal    : parque + trailing + CAGED + renda -> tem sinal ALÉM de tamanho?
Clássico (logística numpy). Sem TF.
"""
from __future__ import annotations

import json

import numpy as np

SRC = r"C:\Users\marce\assistent-control\data\processed\painel-viabilidade-asof.json"
rng = np.random.default_rng(0)


def auc(y, s):
    y = np.asarray(y); s = np.asarray(s, float)
    pos, neg = (y == 1).sum(), (y == 0).sum()
    if pos == 0 or neg == 0:
        return float("nan")
    order = np.argsort(s); ranks = np.empty(len(s)); ranks[order] = np.arange(1, len(s) + 1)
    return float((ranks[y == 1].sum() - pos * (pos + 1) / 2) / (pos * neg))


def ap(y, s):
    y = np.asarray(y); order = np.argsort(-np.asarray(s, float)); y = y[order]
    tp = np.cumsum(y); prec = tp / np.arange(1, len(y) + 1)
    rec_hits = y == 1
    return float(prec[rec_hits].mean()) if rec_hits.any() else float("nan")


def logistic(Xtr, ytr, Xte, epochs=600, lr=0.3, l2=1e-3):
    mu, sd = Xtr.mean(0), Xtr.std(0) + 1e-9
    Xtr = (Xtr - mu) / sd; Xte = (Xte - mu) / sd
    w = np.zeros(Xtr.shape[1]); b = 0.0
    # peso de classe (alvo raro)
    pw = (ytr == 0).sum() / max((ytr == 1).sum(), 1)
    sw = np.where(ytr == 1, pw, 1.0)
    for _ in range(epochs):
        p = 1 / (1 + np.exp(-(Xtr @ w + b)))
        g = (p - ytr) * sw
        w -= lr * (Xtr.T @ g / len(ytr) + l2 * w)
        b -= lr * (g.mean())
    return 1 / (1 + np.exp(-(Xte @ w + b)))


def prep(panel, cols):
    tr = [r for r in panel if r["periodo_t"] <= "2024Q4"]
    te = [r for r in panel if r["periodo_t"] >= "2025Q1"]
    def mat(rows):
        keep = [r for r in rows if all(r.get(c) is not None for c in cols)]
        X = np.array([[float(r[c]) for c in cols] for r in keep], float)
        y = np.array([r["alvo_houve_fechamento_t1"] for r in keep], float)
        return X, y, len(keep)
    return mat(tr), mat(te)


def main():
    d = json.load(open(SRC, encoding="utf-8"))
    panel = [r for r in d["panel"] if r["periodo_alvo"] != "2026Q3"]  # exclui incompleto
    prev = np.mean([r["alvo_houve_fechamento_t1"] for r in panel])
    print(f"painel: {len(panel)}  prevalência alvo: {100*prev:.1f}%  (baseline PR-AUC ~= {prev:.3f})")
    print(f"{'modelo':14} {'features':40} {'n_tr':>6} {'n_te':>6} {'AUC':>7} {'PR-AUC':>8}")

    modelos = {
        "A size-only": ["parque_ativo_fim_t"],
        "B static": ["renda_pc", "percentil_municipio"],
        "C temporal": ["parque_ativo_fim_t", "ab_trail4", "fe_trail4", "caged_saldo_t",
                       "renda_pc", "percentil_municipio"],
        "C- sem_caged": ["parque_ativo_fim_t", "ab_trail4", "fe_trail4"],
    }
    res = {}
    for name, cols in modelos.items():
        (Xtr, ytr, ntr), (Xte, yte, nte) = prep(panel, cols)
        if ntr < 30 or nte < 30 or ytr.sum() < 3 or yte.sum() < 3:
            print(f"{name:14} {str(cols)[:40]:40} {ntr:6d} {nte:6d}   dados insuficientes")
            continue
        s = logistic(Xtr, ytr, Xte)
        a, p = auc(yte, s), ap(yte, s)
        res[name] = (a, p)
        print(f"{name:14} {str(cols)[:40]:40} {ntr:6d} {nte:6d} {a:7.3f} {p:8.3f}")

    # ---- comparação JUSTA: A (size) vs C (temporal) no MESMO subconjunto ----
    cols_c = modelos["C temporal"]
    fair = [r for r in panel if all(r.get(c) is not None for c in cols_c)]
    tr = [r for r in fair if r["periodo_t"] <= "2024Q4"]
    te = [r for r in fair if r["periodo_t"] >= "2025Q1"]

    def mat(rows, cols):
        X = np.array([[float(r[c]) for c in cols] for r in rows], float)
        y = np.array([r["alvo_houve_fechamento_t1"] for r in rows], float)
        return X, y

    ytr = np.array([r["alvo_houve_fechamento_t1"] for r in tr], float)
    yte = np.array([r["alvo_houve_fechamento_t1"] for r in te], float)
    print("\n=== Comparação JUSTA (mesmo subconjunto complete-case) ===")
    print(f"n_tr={len(tr)} n_te={len(te)} pos_te={int(yte.sum())}")
    out = {}
    for name, cols in (("A size", ["parque_ativo_fim_t"]), ("C temporal", cols_c)):
        Xtr, _ = mat(tr, cols); Xte, _ = mat(te, cols)
        s = logistic(Xtr, ytr, Xte)
        out[name] = auc(yte, s)
        print(f"  {name:12} AUC={out[name]:.3f}  PR-AUC={ap(yte, s):.3f}")

    print("\n=== Veredito ===")
    d_fair = out["C temporal"] - out["A size"]
    print(f"AUC C(temporal) - A(size), MESMO subconjunto = {d_fair:+.3f}")
    if out["C temporal"] < 0.55:
        print("SINAL AUSENTE: nem temporal prevê fechamento (AUC<0.55).")
    elif d_fair < 0.03:
        print("Temporal NÃO supera size-only de forma relevante: fechamento acompanha "
              "exposição/tamanho; CAGED/trajetória não agregam sinal preditivo real neste grão.")
    else:
        print(f"SINAL TEMPORAL REAL: C bate size em {d_fair:+.3f} AUC -> ecossistema se justifica.")


if __name__ == "__main__":
    main()
