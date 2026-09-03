"""
Passo 1 do ecossistema temporal (SPEC_FEATURES_TEMPORAIS_VIABILIDADE).
Deriva a série TRIMESTRAL de parque ativo / aberturas / fechamentos por
(uf, bairro_norm, trimestre) a partir dos eventos RFB que já temos.

É a primeira feature VARIÁVEL NO TEMPO (trajetória do parque) + o alvo (evento).
Determinístico, auditável, as-of por construção (cada trimestre só vê seu passado).
"""
from __future__ import annotations

import collections
import json
import unicodedata

ROOT = r"C:\Users\marce\assistent-control"
SRC = rf"{ROOT}\data\processed\receita-cnae-9313100-principal-ativo-baixada.json"
OUT = rf"{ROOT}\data\processed\rfb-parque-temporal.json"
MIN_ESTAB = 5

# trimestres 2023Q1 .. 2026Q3 (hoje = 2026-09)
TRIS = [(a, t) for a in range(2023, 2027) for t in (1, 2, 3, 4) if not (a == 2026 and t == 4)]
_QSTART = {1: 101, 2: 401, 3: 701, 4: 1001}
_QEND = {1: 331, 2: 630, 3: 930, 4: 1231}


def norm(s):
    x = unicodedata.normalize("NFKD", (s or "").strip().lower())
    x = "".join(c for c in x if not unicodedata.combining(c))
    return x.replace("-", " ").strip()


def ymd(v):
    d = "".join(ch for ch in str(v or "") if ch.isdigit())
    return int(d[:8]) if len(d) >= 8 else None


def main():
    rows = json.load(open(SRC, encoding="utf-8"))
    por = collections.defaultdict(list)
    for r in rows:
        uf = str(r.get("uf", "")).upper()
        b = norm(r.get("bairro"))
        if not uf or not b:
            continue
        ini = ymd(r.get("data_inicio_atividade"))
        situ = str(r.get("situacao_cadastral"))
        fech = ymd(r.get("data_situacao_cadastral")) if situ in ("8", "08") else None
        if ini is None:
            continue
        por[(uf, b)].append((ini, fech))

    panel = []
    n_bairros = 0
    for (uf, b), evs in por.items():
        if len(evs) < MIN_ESTAB:
            continue
        n_bairros += 1
        for (ano, tri) in TRIS:
            qs = ano * 10000 + _QSTART[tri]
            qe = ano * 10000 + _QEND[tri]
            parque_ini = sum(1 for i, f in evs if i < qs and (f is None or f >= qs))
            parque_fim = sum(1 for i, f in evs if i <= qe and (f is None or f > qe))
            aberturas = sum(1 for i, _ in evs if qs <= i <= qe)
            fechamentos = sum(1 for _, f in evs if f and qs <= f <= qe)
            taxa = round(fechamentos / parque_ini, 4) if parque_ini > 0 else None
            panel.append({
                "uf": uf, "bairro_norm": b, "ano": ano, "tri": tri,
                "periodo": f"{ano}Q{tri}",
                "parque_ativo_ini": parque_ini, "parque_ativo_fim": parque_fim,
                "aberturas": aberturas, "fechamentos": fechamentos,
                "saldo": aberturas - fechamentos, "taxa_fechamento": taxa,
            })

    meta = {
        "gerado_por": "build_rfb_parque_temporal.py",
        "spec": "SPEC_FEATURES_TEMPORAIS_VIABILIDADE",
        "fonte": "receita-cnae-9313100-principal-ativo-baixada.json (RFB 02+08)",
        "min_estab": MIN_ESTAB, "trimestres": [f"{a}Q{t}" for a, t in TRIS],
        "n_bairros": n_bairros, "n_linhas": len(panel),
        "chave": "(uf, bairro_norm, periodo)",
        "nota_asof": "parque_ativo_ini/taxa de cada trimestre usam só eventos <= inicio do tri",
        "nota_alvo": "aberturas/fechamentos/saldo sao ALVO — nao usar como feature no treino",
    }
    json.dump({"_meta": meta, "panel": panel}, open(OUT, "w", encoding="utf-8"), ensure_ascii=False)

    # sanity
    tot_ab = sum(p["aberturas"] for p in panel)
    tot_fe = sum(p["fechamentos"] for p in panel)
    print(f"bairros (>= {MIN_ESTAB}): {n_bairros}  linhas painel: {len(panel)}  trimestres: {len(TRIS)}")
    print(f"aberturas total: {tot_ab}  fechamentos total: {tot_fe}")
    # trajetória do parque nacional por trimestre (soma parque_fim)
    by_q = collections.defaultdict(lambda: [0, 0, 0])
    for p in panel:
        agg = by_q[p["periodo"]]
        agg[0] += p["parque_ativo_fim"]; agg[1] += p["aberturas"]; agg[2] += p["fechamentos"]
    print("\nperiodo  parque_ativo  aberturas  fechamentos")
    for a, t in TRIS:
        q = f"{a}Q{t}"; v = by_q[q]
        print(f"  {q}   {v[0]:8d}   {v[1]:6d}   {v[2]:6d}")
    print("saida:", OUT)


if __name__ == "__main__":
    main()
