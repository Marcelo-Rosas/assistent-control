"""Grid t-SNE do embedding de viabilidade — todas as opcoes (licoes do distill.pub/2016/misread-tsne).
Mostra que a FORMA depende de perplexity + iteracoes: um grafico so engana. Cor = faixa_margem.
Saidas: tsne_perplexity.png (varre perplexity), tsne_steps.png (varre iteracoes), tsne_headline.png.
"""
import os, csv, json, re, unicodedata, time
import numpy as np
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from sklearn.preprocessing import StandardScaler
from sklearn.manifold import TSNE

R = r"C:/Users/marce/assistent-control"
PROC = os.path.join(R, "data", "processed")
HERE = os.path.dirname(os.path.abspath(__file__))
from bairro_resolver import Resolver
RV = Resolver()

def bnorm(s):
    s = "".join(c for c in unicodedata.normalize("NFKD", str(s or "")) if not unicodedata.combining(c)).lower()
    return re.sub(r"\s+", " ", re.sub(r"[^a-z0-9 ]", " ", s)).strip()

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
X_all = StandardScaler().fit_transform(feat)
mg_all = np.array([r["mg"] for r in recs])
q = np.quantile(mg_all, [.25, .5, .75])
cls_all = np.digitize(mg_all, q)  # 0..3

# subamostra estratificada (t-SNE e O(n^2)-ish; distill usa amostras pequenas) — fixa p/ reprodutivel
rng = np.random.default_rng(42)
N = 2500
idx = []
for k in range(4):
    ids = np.where(cls_all == k)[0]
    take = min(len(ids), round(N * len(ids) / len(cls_all)))
    idx.extend(rng.choice(ids, size=take, replace=False).tolist())
idx = np.array(idx)
X = X_all[idx]; cls = cls_all[idx]
print(f"pontos totais {len(recs)} | subamostra t-SNE {len(idx)}")

PAL = ["#c9564b", "#c9791f", "#3f7fd6", "#1f8f74"]
LBL = ["Baixo", "Medio", "Alto", "Premium"]

def scatter(ax, Z, title):
    ax.set_facecolor("#0c0f14")
    for k in range(4):
        m = cls == k
        ax.scatter(Z[m, 0], Z[m, 1], s=4, c=PAL[k], alpha=.7, linewidths=0)
    ax.set_title(title, color="#e8ecf2", fontsize=9)
    ax.set_xticks([]); ax.set_yticks([])
    for s in ax.spines.values(): s.set_color("#262d38")

def run_tsne(perp, iters, lr="auto"):
    t0 = time.time()
    z = TSNE(n_components=2, perplexity=perp, max_iter=iters, learning_rate=lr,
             init="pca", random_state=42, n_jobs=-1).fit_transform(X)
    return z, time.time() - t0

# PAINEL 1 — varredura de PERPLEXITY (max_iter=1000)
perps = [2, 5, 15, 30, 50, 100]
fig, axes = plt.subplots(2, 3, figsize=(12, 8), dpi=120)
fig.patch.set_facecolor("#0c0f14")
for ax, p in zip(axes.ravel(), perps):
    z, dt = run_tsne(p, 1000)
    scatter(ax, z, f"perplexity = {p}  ({dt:.0f}s)")
    print(f"  perplexity {p}: {dt:.0f}s")
fig.suptitle("t-SNE · varredura de PERPLEXITY (max_iter=1000) — a forma MUDA com o parametro (licao distill)",
             color="#e8ecf2", fontsize=12)
lg = [plt.Line2D([0], [0], marker="o", color="w", markerfacecolor=PAL[k], label=f"margem {LBL[k]}", markersize=7, linewidth=0) for k in range(4)]
fig.legend(handles=lg, loc="lower center", ncol=4, framealpha=.1, fontsize=9, labelcolor="#aeb8c6")
fig.tight_layout(rect=[0, .04, 1, .96])
fig.savefig(os.path.join(HERE, "tsne_perplexity.png"), facecolor=fig.get_facecolor()); plt.close(fig)
print("salvo tsne_perplexity.png")

# PAINEL 2 — varredura de ITERACOES (perplexity=30) — convergencia
steps = [250, 500, 1000, 3000]
fig, axes = plt.subplots(1, 4, figsize=(15, 4.2), dpi=120)
fig.patch.set_facecolor("#0c0f14")
for ax, it in zip(axes.ravel(), steps):
    z, dt = run_tsne(30, it)
    scatter(ax, z, f"max_iter = {it}  ({dt:.0f}s)")
    print(f"  steps {it}: {dt:.0f}s")
fig.suptitle("t-SNE · varredura de ITERACOES (perplexity=30) — rodar ate ESTABILIZAR (licao distill)",
             color="#e8ecf2", fontsize=12)
fig.tight_layout(rect=[0, 0, 1, .93])
fig.savefig(os.path.join(HERE, "tsne_steps.png"), facecolor=fig.get_facecolor()); plt.close(fig)
print("salvo tsne_steps.png")

# HEADLINE — configuracao recomendada
z, dt = run_tsne(30, 2000)
fig, ax = plt.subplots(figsize=(9, 6.4), dpi=130)
fig.patch.set_facecolor("#0c0f14")
scatter(ax, z, f"t-SNE recomendado — perplexity=30, max_iter=2000, init=pca ({dt:.0f}s)")
lg = [plt.Line2D([0], [0], marker="o", color="w", markerfacecolor=PAL[k], label=f"margem {LBL[k]}", markersize=8, linewidth=0) for k in range(4)]
ax.legend(handles=lg, loc="upper right", framealpha=.12, fontsize=9, labelcolor="#aeb8c6")
ax.text(.01, .01, f"{len(idx)} bairros (subamostra) · cor=faixa_margem · MRLR extrapolado",
        transform=ax.transAxes, color="#6b7688", fontsize=7)
fig.tight_layout()
fig.savefig(os.path.join(HERE, "tsne_headline.png"), facecolor=fig.get_facecolor()); plt.close(fig)
print("salvo tsne_headline.png")
