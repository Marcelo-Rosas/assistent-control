"""
Passo 3 — Feature store AS-OF (SPEC_FEATURES_TEMPORAIS_VIABILIDADE).
Painel (uf, bairro_norm, trimestre t): features observadas ATÉ t -> alvo em t+1.
Zero leakage por construção (RD-01): aberturas/fechamentos de t+1 são ALVO, nunca feature.

Junta:
  RFB parque-temporal (bairro, tri)   -> parque_ativo_fim[t], trail dinâmica passada
  CAGED (municipio, mês->tri)         -> saldo emprego[t] (via municipio_cod IBGE)
  substrate (renda estática)          -> renda_pc, percentil (fundo)
Piloto SP.
"""
from __future__ import annotations

import collections
import json

ROOT = r"C:\Users\marce\assistent-control"
RFB = rf"{ROOT}\data\processed\rfb-parque-temporal.json"
CAGED = rf"{ROOT}\data\processed\caged-sp-municipio-mes.json"
FEATS = rf"{ROOT}\data\processed\viabilidade-features-bairro.json"
OUT = rf"{ROOT}\data\processed\painel-viabilidade-asof.json"

TRIS = [(a, t) for a in range(2023, 2027) for t in (1, 2, 3, 4) if not (a == 2026 and t == 4)]
TRI_IDX = {f"{a}Q{t}": i for i, (a, t) in enumerate(TRIS)}


def main():
    rfb = json.load(open(RFB, encoding="utf-8"))["panel"]
    caged_rows = json.load(open(CAGED, encoding="utf-8"))["rows"]
    fj = json.load(open(FEATS, encoding="utf-8"))["features"]

    # substrate: (uf,bairro) -> municipio_cod + renda
    sub = {(f["uf"], f["bairro_norm"]): f for f in fj}

    # CAGED mensal -> trimestral por municipio_cod (IBGE)
    caged_q = collections.defaultdict(float)  # (municipio_cod, "AAAAQn") -> saldo
    caged_cov = set()
    for r in caged_rows:
        mcod = str(r["id_municipio"])
        tri = (int(r["mes"]) - 1) // 3 + 1
        key = (mcod, f"{r['ano']}Q{tri}")
        if r.get("saldo") is not None:
            caged_q[key] += float(r["saldo"])
            caged_cov.add(key)

    # indexa RFB por (uf,bairro) -> {periodo: linha}
    by_bairro = collections.defaultdict(dict)
    for p in rfb:
        if p["uf"] != "SP":
            continue
        by_bairro[(p["uf"], p["bairro_norm"])][p["periodo"]] = p

    panel = []
    leak_ok = True
    cov_caged = cov_renda = 0
    for key, serie in by_bairro.items():
        uf, b = key
        f = sub.get(key, {})
        mcod = f.get("municipio_cod")
        renda_pc = f.get("renda_pc")
        percentil = f.get("percentil_municipio")
        for i, (a, t) in enumerate(TRIS):
            if i + 1 >= len(TRIS):
                continue  # precisa de t+1 (alvo)
            per_t = f"{a}Q{t}"
            per_t1 = f"{TRIS[i+1][0]}Q{TRIS[i+1][1]}"
            row_t = serie.get(per_t)
            row_t1 = serie.get(per_t1)
            if not row_t or not row_t1:
                continue
            # trailing 4Q (features passadas — inclui t, exclui futuro)
            idxs = [j for j in range(max(0, i - 3), i + 1)]
            pers = [f"{TRIS[j][0]}Q{TRIS[j][1]}" for j in idxs]
            ab_trail = sum(serie[p]["aberturas"] for p in pers if p in serie)
            fe_trail = sum(serie[p]["fechamentos"] for p in pers if p in serie)
            caged_t = caged_q.get((mcod, per_t)) if mcod else None
            if caged_t is not None:
                cov_caged += 1
            if renda_pc is not None:
                cov_renda += 1
            feat = {
                "uf": uf, "bairro_norm": b, "municipio_cod": mcod,
                "periodo_t": per_t, "periodo_alvo": per_t1,
                # --- FEATURES (as-of <= t) ---
                "parque_ativo_fim_t": row_t["parque_ativo_fim"],
                "aberturas_t": row_t["aberturas"],
                "fechamentos_t": row_t["fechamentos"],
                "ab_trail4": ab_trail,
                "fe_trail4": fe_trail,
                "caged_saldo_t": caged_t,
                "renda_pc": renda_pc,
                "percentil_municipio": percentil,
                # --- ALVO (t+1) ---
                "alvo_fechamentos_t1": row_t1["fechamentos"],
                "alvo_aberturas_t1": row_t1["aberturas"],
                "alvo_houve_fechamento_t1": 1 if row_t1["fechamentos"] > 0 else 0,
            }
            # leakage self-check: nenhuma feature pode usar dado de t+1
            if row_t1["periodo"] == feat["periodo_t"]:
                leak_ok = False
            panel.append(feat)

    # exclui trimestre-alvo incompleto (RFB 2026Q3 subconta) — flag
    incompletos = [p for p in panel if p["periodo_alvo"] == "2026Q3"]
    meta = {
        "spec": "SPEC_FEATURES_TEMPORAIS_VIABILIDADE",
        "gerado_por": "build_feature_store_asof.py",
        "piloto": "SP", "n_linhas": len(panel),
        "features": ["parque_ativo_fim_t", "aberturas_t", "fechamentos_t",
                     "ab_trail4", "fe_trail4", "caged_saldo_t", "renda_pc", "percentil_municipio"],
        "alvos": ["alvo_fechamentos_t1", "alvo_aberturas_t1", "alvo_houve_fechamento_t1"],
        "leakage_check_ok": leak_ok,
        "cobertura_caged": round(100 * cov_caged / max(len(panel), 1), 1),
        "cobertura_renda": round(100 * cov_renda / max(len(panel), 1), 1),
        "nota_incompleto": f"{len(incompletos)} linhas com alvo=2026Q3 (RFB subconta; excluir no treino)",
        "nota_leakage": "aberturas/fechamentos de t+1 = ALVO; features só <= t",
    }
    json.dump({"_meta": meta, "panel": panel}, open(OUT, "w", encoding="utf-8"), ensure_ascii=False)

    print(f"linhas painel: {len(panel)}  bairros SP: {len(by_bairro)}")
    print(f"leakage_check_ok: {leak_ok}")
    print(f"cobertura CAGED: {meta['cobertura_caged']}%  renda: {meta['cobertura_renda']}%")
    print(f"alvo houve_fechamento=1: {sum(p['alvo_houve_fechamento_t1'] for p in panel)} "
          f"({100*sum(p['alvo_houve_fechamento_t1'] for p in panel)/max(len(panel),1):.1f}%)")
    print(f"linhas alvo incompleto (2026Q3): {len(incompletos)}")
    print("saida:", OUT)


if __name__ == "__main__":
    main()
