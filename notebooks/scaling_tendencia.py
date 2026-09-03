"""
Scaling / power analysis: em qual TAMANHO (escala nacional + threshold de bairro)
o sinal de fechamento vale a pena modelar.

Distingue "falta dado" de "sinal ausente":
  - se |r(feature, taxa_fech)| CRESCE e estabiliza com bairro maior -> vale escalar.
  - se fica ~0 mesmo com bairro grande (denominador grande, pouco ruído) -> sinal
    genuinamente ausente; nem clássico nem TF preveem. Não é problema de N.

Nacional (todas UF) vs SP; varredura min_estab. Determinístico.
"""
from __future__ import annotations

import collections
import json
import unicodedata

import numpy as np

ROOT = r"C:\Users\marce\assistent-control"
SRC = rf"{ROOT}\data\processed\receita-cnae-9313100-principal-ativo-baixada.json"
FEATS = rf"{ROOT}\data\processed\viabilidade-features-bairro.json"
ANOS = [2023, 2024, 2025, 2026]


def norm(s):
    x = unicodedata.normalize("NFKD", (s or "").strip().lower())
    x = "".join(c for c in x if not unicodedata.combining(c))
    return x.replace("-", " ").strip()


def ymd(v):
    d = "".join(ch for ch in str(v or "") if ch.isdigit())
    return int(d[:8]) if len(d) >= 8 else None


def pearson(x, y):
    x, y = np.asarray(x, float), np.asarray(y, float)
    m = np.isfinite(x) & np.isfinite(y)
    x, y = x[m], y[m]
    if len(x) < 5 or x.std() == 0 or y.std() == 0:
        return float("nan"), len(x)
    return float(np.corrcoef(x, y)[0, 1]), len(x)


def build(rows, uf_filter=None):
    por = collections.defaultdict(list)
    for r in rows:
        uf = str(r.get("uf", "")).upper()
        if uf_filter and uf != uf_filter:
            continue
        b = norm(r.get("bairro"))
        if not b:
            continue
        ini = ymd(r.get("data_inicio_atividade"))
        situ = str(r.get("situacao_cadastral"))
        fech = ymd(r.get("data_situacao_cadastral")) if situ in ("8", "08") else None
        if ini is None:
            continue
        por[(uf, b)].append((ini, fech))
    out = {}
    for key, evs in por.items():
        serie = {}
        for ano in ANOS:
            y0, y1 = ano * 10000 + 101, ano * 10000 + 1231
            ab = sum(1 for i, _ in evs if y0 <= i <= y1)
            fe = sum(1 for _, f in evs if f and y0 <= f <= y1)
            ai = sum(1 for i, f in evs if i < y0 and (f is None or f >= y0))
            serie[ano] = (ab, fe, ai)
        tot_ab3 = sum(serie[a][0] for a in (2023, 2024, 2025))
        tot_fe3 = sum(serie[a][1] for a in (2023, 2024, 2025))
        taxas = [serie[a][1] / serie[a][2] for a in ANOS if serie[a][2] > 0]
        out[key] = {
            "n": len(evs),
            "saldo3": tot_ab3 - tot_fe3,
            "fech3": tot_fe3,
            "taxa": float(np.mean(taxas)) if taxas else None,
            "ativos_hoje": sum(1 for _, f in evs if f is None),
            "fech_cedo": serie[2023][1] + serie[2024][1],
            "ab_tarde": serie[2025][0] + serie[2026][0],
        }
    return out


def sweep(agg, fmap, label):
    print(f"\n=== {label} ===")
    print(f"{'min_estab':>9} {'bairros':>8} {'fech_tot':>9} {'fech/bair':>10} "
          f"{'r(renda,taxa)':>14} {'r(perc,taxa)':>13} {'partial_c':>10}")
    for th in (5, 10, 20, 50, 100, 200):
        sel = {k: v for k, v in agg.items() if v["n"] >= th}
        if len(sel) < 10:
            continue
        renda = [fmap.get(k, {}).get("renda_pc") for k in sel]
        perc = [fmap.get(k, {}).get("percentil_municipio") for k in sel]
        taxa = [v["taxa"] for v in sel.values()]
        r1, _ = pearson(renda, taxa)
        r2, _ = pearson(perc, taxa)
        # partial (c): fech_cedo x ab_tarde controlando ativos_hoje
        fc = np.array([v["fech_cedo"] for v in sel.values()], float)
        at = np.array([v["ab_tarde"] for v in sel.values()], float)
        sz = np.array([v["ativos_hoje"] for v in sel.values()], float)
        A = np.vstack([sz, np.ones_like(sz)]).T
        rc = lambda y: y - A @ np.linalg.lstsq(A, y, rcond=None)[0]
        rp, _ = pearson(rc(fc), rc(at))
        fech_tot = sum(v["fech3"] for v in sel.values())
        print(f"{th:9d} {len(sel):8d} {fech_tot:9d} {fech_tot/len(sel):10.2f} "
              f"{r1:14.3f} {r2:13.3f} {rp:10.3f}")


def main():
    rows = json.load(open(SRC, encoding="utf-8"))
    fj = json.load(open(FEATS, encoding="utf-8"))
    fmap = {(f["uf"], f["bairro_norm"]): f for f in fj["features"]}
    print(f"estab total: {len(rows)}  baixados: {sum(1 for r in rows if str(r.get('situacao_cadastral')) in ('8','08'))}")
    sweep(build(rows, "SP"), fmap, "SP (piloto)")
    sweep(build(rows), fmap, "NACIONAL (todas UF)")
    print("\nLeitura: se |r(renda,taxa)| sobe com min_estab e estabiliza != 0 -> vale escalar/modelar.")
    print("Se fica ~0 mesmo em bairro grande (fech/bair alto) -> sinal ausente, não é falta de N.")


if __name__ == "__main__":
    main()
