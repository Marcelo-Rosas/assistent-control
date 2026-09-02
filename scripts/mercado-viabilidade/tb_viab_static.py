"""Render estatico 2D do embedding de viabilidade (mesmo dado do TensorBoard Projector),
colorido por faixa_margem e faixa_aluguel. Fallback quando o browser MCP nao coopera.
"""
import os, csv, json, re, unicodedata
import numpy as np
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from sklearn.preprocessing import StandardScaler
from sklearn.decomposition import PCA

R = r"C:/Users/marce/assistent-control"
PROC = os.path.join(R, "data", "processed")
HERE = os.path.dirname(os.path.abspath(__file__))

def bnorm(s):
    s = "".join(c for c in unicodedata.normalize("NFKD", str(s or "")) if not unicodedata.combining(c)).lower()
    return re.sub(r"\s+", " ", re.sub(r"[^a-z0-9 ]", " ", s)).strip()

from bairro_resolver import Resolver
RV = Resolver()
ibge_by_cnpj = {r["cnpj"]: r.get("ibge", "") for r in json.load(open(f"{PROC}/receita-x-totalpass-match.json", encoding="utf-8"))}

agg = {}
with open(f"{PROC}/receita-enriched-totalpass.csv", encoding="utf-8") as f:
    for row in csv.DictReader(f):
        if row["academia_core"] != "1":
            continue
        ibge = ibge_by_cnpj.get(row["cnpj"], ""); bn = bnorm(row["bairro"])
        if not ibge or not bn:
            continue
        a = agg.setdefault((ibge, bn), {"n": 0, "tp": 0, "bairro": row["bairro"]})
        a["n"] += 1; a["tp"] += 1 if row["na_totalpass"] == "1" else 0

recs = []
for (ibge, bn), a in agg.items():
    r = RV.full(ibge, a["bairro"]); vu = r["vu_m2"]
    if vu is None:
        continue
    recs.append({"renda": float(r["renda_pc"]), "vu": float(vu), "n": a["n"], "ws": a["n"] - a["tp"],
                 "pen": 100 * a["tp"] / a["n"], "mg": float(r["renda_pc"]) / vu})

feat = np.array([[r["renda"], r["vu"], r["n"], r["ws"], r["pen"], r["mg"]] for r in recs])
X = StandardScaler().fit_transform(feat)
Z = PCA(n_components=2, random_state=42).fit_transform(X)

def faixa(vals, v):
    q = np.quantile(vals, [.25, .5, .75])
    return 0 if v <= q[0] else 1 if v <= q[1] else 2 if v <= q[2] else 3

mg_v = [r["mg"] for r in recs]; vu_v = [r["vu"] for r in recs]
cmg = np.array([faixa(mg_v, r["mg"]) for r in recs])
cal = np.array([faixa(vu_v, r["vu"]) for r in recs])

PAL = ["#c9564b", "#c9791f", "#3f7fd6", "#1f8f74"]  # Baixo..Premium
LBL = ["Baixo", "Medio", "Alto", "Premium"]

for cvec, titulo, fname, leg in [
    (cmg, "Viabilidade por bairro — cor = margem (renda / aluguel R$/m2)", "viab_margem.png", "Margem"),
    (cal, "Viabilidade por bairro — cor = custo do ponto (aluguel MRLR R$/m2)", "viab_aluguel.png", "Aluguel"),
]:
    fig, ax = plt.subplots(figsize=(9, 6.4), dpi=130)
    fig.patch.set_facecolor("#0c0f14"); ax.set_facecolor("#0c0f14")
    for k in range(4):
        m = cvec == k
        ax.scatter(Z[m, 0], Z[m, 1], s=7, c=PAL[k], label=f"{leg}: {LBL[k]}", alpha=.72, linewidths=0)
    ax.set_title(titulo, color="#e8ecf2", fontsize=11)
    ax.set_xlabel("PCA 1", color="#7c8798"); ax.set_ylabel("PCA 2", color="#7c8798")
    ax.tick_params(colors="#3f4a58"); [s.set_color("#262d38") for s in ax.spines.values()]
    lg = ax.legend(loc="upper right", framealpha=.15, fontsize=9)
    for t in lg.get_texts(): t.set_color("#aeb8c6")
    ax.text(.01, .01, f"{len(recs)} bairros · MRLR IBAPE-GO (extrapolacao) · VU a 500 m2",
            transform=ax.transAxes, color="#6b7688", fontsize=7)
    fig.tight_layout()
    out = os.path.join(HERE, fname)
    fig.savefig(out, facecolor=fig.get_facecolor()); plt.close(fig)
    print("salvo:", out)
print(f"{len(recs)} bairros renderizados")
