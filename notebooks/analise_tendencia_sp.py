"""
Passo 4 (clássico, pré-TF) — análise da tendência SP. Robusto a esparsidade.
  (a) Descritivo: correlação features x saldo/taxa_fechamento + retração vs expansão.
  (b) Clustering (kmeans numpy) de bairros por vetor open/close -> tipos de bairro.
  (c) Correlação temporal: fechamentos cedo (2023-24) -> aberturas tarde (2025-26)?

Sem afirmar causa: tudo correlacional, com caveat. Baseline antes de qualquer TF.
"""
from __future__ import annotations

import json
import math

import numpy as np

SRC = r"C:\Users\marce\assistent-control\data\processed\tendencia-sp-bairro.json"
rng = np.random.default_rng(7)


def pearson(x, y):
    x, y = np.asarray(x, float), np.asarray(y, float)
    m = np.isfinite(x) & np.isfinite(y)
    x, y = x[m], y[m]
    if len(x) < 3 or x.std() == 0 or y.std() == 0:
        return float("nan"), len(x)
    r = float(np.corrcoef(x, y)[0, 1])
    return r, len(x)


def kmeans(X, k, iters=50):
    c = X[rng.choice(len(X), k, replace=False)]
    for _ in range(iters):
        d = ((X[:, None, :] - c[None, :, :]) ** 2).sum(2)
        lab = d.argmin(1)
        newc = np.array([X[lab == j].mean(0) if (lab == j).any() else c[j] for j in range(k)])
        if np.allclose(newc, c):
            break
        c = newc
    return lab, c


def main():
    d = json.load(open(SRC, encoding="utf-8"))
    B = d["bairros"]
    print(f"bairros: {len(B)}  (meta: {d['_meta']['janela']})")

    # ---------- (a) descritivo ----------
    feats = ["renda_pc", "percentil_municipio", "n_estab_total", "cnpj_basicos_distintos",
             "aberturas_trienio", "ativos_hoje"]
    saldo = [b["saldo_trienio"] for b in B]
    taxa = [b["taxa_fech_media"] for b in B]
    print("\n=== (a) Correlação feature x [saldo_trienio | taxa_fechamento] ===")
    print(f"{'feature':22} {'r(saldo)':>9} {'r(taxa_fech)':>13}")
    for f in feats:
        v = [b.get(f) for b in B]
        rs, _ = pearson(v, saldo)
        rt, _ = pearson(v, taxa)
        print(f"{f:22} {rs:9.3f} {rt:13.3f}")

    # retração vs expansão (só com renda)
    ret = [b["renda_pc"] for b in B if b["saldo_trienio"] < 0 and b.get("renda_pc")]
    exp = [b["renda_pc"] for b in B if b["saldo_trienio"] > 0 and b.get("renda_pc")]
    print(f"\nretração (saldo<0): n={len(ret)} renda_pc média={np.mean(ret):.0f}" if ret else "retração: n=0")
    print(f"expansão (saldo>0): n={len(exp)} renda_pc média={np.mean(exp):.0f}" if exp else "expansão: n=0")

    # ---------- (b) clustering ----------
    cols = ["aberturas_trienio", "fechamentos_trienio", "saldo_trienio", "taxa_fech_media", "ativos_hoje"]
    M = np.array([[b.get(c) if b.get(c) is not None else 0.0 for c in cols] for b in B], float)
    Z = (M - M.mean(0)) / (M.std(0) + 1e-9)
    k = 4
    lab, cent = kmeans(Z, k)
    print(f"\n=== (b) Clustering k={k} (vetor open/close por bairro) ===")
    for j in range(k):
        idx = np.where(lab == j)[0]
        prof = M[idx].mean(0)
        rend = [B[i].get("renda_pc") for i in idx if B[i].get("renda_pc")]
        ex = ", ".join(B[i]["bairro_norm"][:14] for i in idx[:3])
        print(f"  cluster {j}: n={len(idx):3d} | ab={prof[0]:.1f} fech={prof[1]:.1f} "
              f"saldo={prof[2]:+.1f} taxa={prof[3]:.3f} ativos={prof[4]:.1f} | "
              f"renda~{np.mean(rend):.0f} | ex: {ex}" if rend else
              f"  cluster {j}: n={len(idx):3d} | saldo={prof[2]:+.1f} | ex: {ex}")

    # ---------- (c) correlação temporal fechamento->entrante ----------
    def ysum(b, key, anos):
        return sum(s[key] for s in b["serie"] if s["ano"] in anos)
    fech_cedo = [ysum(b, "fechamentos", {2023, 2024}) for b in B]
    ab_tarde = [ysum(b, "aberturas", {2025, 2026}) for b in B]
    r, n = pearson(fech_cedo, ab_tarde)
    print(f"\n=== (c) fechamentos 2023-24 x aberturas 2025-26 ===")
    print(f"Pearson r = {r:.3f} (n={n})  -> correlação, NÃO causa (confound: tamanho do bairro)")
    # controla tamanho: parcializa por ativos_hoje via correlação de resíduos simples
    size = np.array([b["ativos_hoje"] for b in B], float)
    def resid(y):
        y = np.asarray(y, float); A = np.vstack([size, np.ones_like(size)]).T
        b_ = np.linalg.lstsq(A, y, rcond=None)[0]; return y - A @ b_
    rp, _ = pearson(resid(fech_cedo), resid(ab_tarde))
    print(f"Pearson parcial (controlando ativos_hoje) = {rp:.3f}")
    print("  -> se cair muito vs bruto, a relação era só 'bairro grande abre e fecha mais'.")


if __name__ == "__main__":
    main()
