"""Projector BAIRRO-LEVEL de viabilidade (adaptacao GymSite MRLR).
Cada ponto = 1 bairro com academia. Cruza DEMANDA (renda) x CUSTO (aluguel MRLR) x
OFERTA (n academias, penetracao TP, whitespace). Ver em TensorBoard -> PROJECTOR (run 'viabilidade').

Fontes: aluguel-mrlr-nacional.json (MRLR), renda-bairro-by-ibge-nacional.json (renda_pc),
receita-enriched-totalpass.csv + receita-x-totalpass-match.json (academias/TP por bairro).
HONESTIDADE: aluguel = ESTIMATIVA MRLR extrapolada (calibracao Goias), local=2 default, VU a 500 m2.
"""
import os, csv, json, re, unicodedata, collections
import numpy as np
os.environ.setdefault('TF_CPP_MIN_LOG_LEVEL', '2')
import tensorflow as tf
from tensorboard.plugins import projector
from sklearn.preprocessing import StandardScaler
from sklearn.decomposition import PCA

R = r"C:/Users/marce/assistent-control"
PROC = os.path.join(R, "data", "processed")
HERE = os.path.dirname(os.path.abspath(__file__))
LOG = os.path.join(HERE, "tb_logs", "viabilidade")
os.makedirs(LOG, exist_ok=True)

def bnorm(s):
    s = "".join(c for c in unicodedata.normalize("NFKD", str(s or "")) if not unicodedata.combining(c)).lower()
    return re.sub(r"\s+", " ", re.sub(r"[^a-z0-9 ]", " ", s)).strip()

UF_REG = {**{u: "Norte" for u in "AC AP AM PA RO RR TO".split()},
          **{u: "Nordeste" for u in "AL BA CE MA PB PE PI RN SE".split()},
          **{u: "Centro-Oeste" for u in "DF GO MT MS".split()},
          **{u: "Sudeste" for u in "ES MG RJ SP".split()},
          **{u: "Sul" for u in "PR RS SC".split()}}

# resolver de cobertura ~100% (bairro exato -> fuzzy -> mediana municipio)
from bairro_resolver import Resolver
RV = Resolver()

# cnpj -> ibge
ibge_by_cnpj = {r["cnpj"]: r.get("ibge", "") for r in json.load(open(f"{PROC}/receita-x-totalpass-match.json", encoding="utf-8"))}

# agrega bairros das academias CORE
agg = {}
with open(f"{PROC}/receita-enriched-totalpass.csv", encoding="utf-8") as f:
    for row in csv.DictReader(f):
        if row["academia_core"] != "1":
            continue
        ibge = ibge_by_cnpj.get(row["cnpj"], "")
        bn = bnorm(row["bairro"])
        if not ibge or not bn:
            continue
        k = (ibge, bn)
        a = agg.setdefault(k, {"n": 0, "tp": 0, "cidade": row["cidade"], "uf": row["uf"], "bairro": row["bairro"]})
        a["n"] += 1
        a["tp"] += 1 if row["na_totalpass"] == "1" else 0

# monta registros — resolver garante renda+aluguel p/ TODO bairro (nada 'sem dado')
recs = []
for (ibge, bn), a in agg.items():
    r = RV.full(ibge, a["bairro"])
    vu = r["vu_m2"]
    if vu is None:  # so cai aqui se municipio sem PIB (raro)
        continue
    recs.append({
        "ibge": ibge, "bairro": a["bairro"], "cidade": a["cidade"], "uf": a["uf"],
        "regiao": UF_REG.get(a["uf"], "?"),
        "renda_pc": float(r["renda_pc"]), "vu_m2": float(vu),
        "n_acad": a["n"], "n_tp": a["tp"], "whitespace": a["n"] - a["tp"],
        "penetracao": round(100 * a["tp"] / a["n"], 1),
        "margem_proxy": round(float(r["renda_pc"]) / vu, 2),
        "match_level": r["match_level"],
    })
import collections as _c
print(f"bairros no projector: {len(recs)} | match_level: {dict(_c.Counter(x['match_level'] for x in recs))}")

def faixa(vals, v, labels=("Baixo", "Medio", "Alto", "Premium")):
    qs = np.quantile(vals, [.25, .5, .75])
    return labels[0] if v <= qs[0] else labels[1] if v <= qs[1] else labels[2] if v <= qs[2] else labels[3]

renda_v = [r["renda_pc"] for r in recs]; vu_v = [r["vu_m2"] for r in recs]
mg_v = [r["margem_proxy"] for r in recs]; nac_v = [r["n_acad"] for r in recs]
for r in recs:
    r["faixa_renda"] = faixa(renda_v, r["renda_pc"])
    r["faixa_aluguel"] = faixa(vu_v, r["vu_m2"])
    r["faixa_margem"] = faixa(mg_v, r["margem_proxy"])
    r["faixa_n_acad"] = faixa(nac_v, r["n_acad"], ("1-poucas", "2-media", "3-muitas", "4-densa"))

# features -> embedding
feat = np.array([[r["renda_pc"], r["vu_m2"], r["n_acad"], r["whitespace"], r["penetracao"], r["margem_proxy"]] for r in recs], dtype="float64")
X = StandardScaler().fit_transform(feat).astype("float32")
n_comp = min(8, X.shape[1])
Z = PCA(n_components=n_comp, random_state=42).fit_transform(X).astype("float32")
rng = np.random.default_rng(42)
Z = Z + rng.normal(0, 0.02 * Z.std(0, keepdims=True), Z.shape).astype("float32")

emb = tf.Variable(Z, name="viabilidade_embedding")
tf.train.Checkpoint(embedding=emb).save(os.path.join(LOG, "embedding.ckpt"))

cols = ["cidade", "uf", "regiao", "faixa_renda", "faixa_aluguel", "faixa_margem", "faixa_n_acad", "match_level", "bairro"]
with open(os.path.join(LOG, "metadata.tsv"), "w", encoding="utf-8") as f:
    f.write("\t".join(cols) + "\n")
    for r in recs:
        f.write("\t".join(str(r[c]).replace("\t", " ").replace("\n", " ")[:40] for c in cols) + "\n")

cfg = projector.ProjectorConfig(); ep = cfg.embeddings.add()
ep.tensor_name = "embedding/.ATTRIBUTES/VARIABLE_VALUE"
ep.metadata_path = "metadata.tsv"  # relativo (portabilidade)
projector.visualize_embeddings(LOG, cfg)
print(f"OK: {len(recs)} bairros | logdir {LOG}")
print("color_by sugerido: faixa_margem (verde=conta fecha), faixa_aluguel, regiao")
