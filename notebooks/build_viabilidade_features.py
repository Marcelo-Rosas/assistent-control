"""
Estrutura features de viabilidade per-bairro (substrato do worker TF).
NÃO treina modelo — só consolida eixos independentes com proveniência + null-flag
(constituição gymsite: nada inventado; ausência = dados_nao_disponiveis).

Eixos:
  demanda    -> renda_bairro (Supabase, IBGE/PDAD)
  municipal  -> mediana renda do município (fallback -000/sem-bairro)
  oferta_gym -> densidade de gyms por bairro (tp-bairro-index)
  geo        -> centroide lat/lng
  tendencia  -> GAP: cnpj_tendencia.py não implementado (SPEC_TENDENCIA)

Fixes do usuário:
  1. -000 / sem match de bairro -> renda MUNICIPAL, granularidade='municipio'
  2. sem-CEP -> bairro já vem de geocode (Nominatim) no tp-bairro-index
  3. lat/lng incluídos como feature + centroide
"""
from __future__ import annotations

import bisect
import collections
import json
import os
import re
import statistics
import unicodedata

ROOT = r"C:\Users\marce\assistent-control"


def load_env():
    env = open(r"C:\Users\marce\gymsite\.env", encoding="utf-8").read()
    for k in ("SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"):
        m = re.search(rf"^{k}=(.*)$", env, re.M)
        if m:
            os.environ[k] = m.group(1).strip().strip('"').strip("'")


def norm(s):
    x = unicodedata.normalize("NFKD", (s or "").strip().lower())
    x = "".join(c for c in x if not unicodedata.combining(c))
    return x.replace("-", " ").strip()


EST = {"acre": "AC", "alagoas": "AL", "amapa": "AP", "amazonas": "AM", "bahia": "BA",
       "ceara": "CE", "distrito federal": "DF", "espirito santo": "ES", "goias": "GO",
       "maranhao": "MA", "mato grosso": "MT", "mato grosso do sul": "MS", "minas gerais": "MG",
       "para": "PA", "paraiba": "PB", "parana": "PR", "pernambuco": "PE", "piaui": "PI",
       "rio de janeiro": "RJ", "rio grande do norte": "RN", "rio grande do sul": "RS",
       "rondonia": "RO", "roraima": "RR", "santa catarina": "SC", "sao paulo": "SP",
       "sergipe": "SE", "tocantins": "TO"}
RANGES = [(1000, 19999, "SP"), (20000, 28999, "RJ"), (29000, 29999, "ES"), (30000, 39999, "MG"),
          (40000, 48999, "BA"), (49000, 49999, "SE"), (50000, 56999, "PE"), (57000, 57999, "AL"),
          (58000, 58999, "PB"), (59000, 59999, "RN"), (60000, 63999, "CE"), (64000, 64999, "PI"),
          (65000, 65999, "MA"), (66000, 68899, "PA"), (68900, 68999, "AP"), (69000, 69299, "AM"),
          (69300, 69389, "RR"), (69400, 69899, "AM"), (69900, 69999, "AC"), (70000, 72799, "DF"),
          (72800, 72999, "GO"), (73000, 73699, "DF"), (73700, 76799, "GO"), (76800, 76999, "RO"),
          (77000, 77999, "TO"), (78000, 78899, "MT"), (78900, 78999, "RO"), (79000, 79999, "MS"),
          (80000, 87999, "PR"), (88000, 89999, "SC"), (90000, 99999, "RS")]
_ST = [r[0] for r in RANGES]


def uf_disp(disp):
    for p in (disp or "").split(","):
        u = EST.get(norm(p))
        if u:
            return u


def uf_cep(cep):
    dd = re.sub(r"\D", "", str(cep or ""))
    if len(dd) < 5:
        return None
    p = int(dd[:5])
    i = bisect.bisect_right(_ST, p) - 1
    if 0 <= i < len(RANGES) and RANGES[i][0] <= p <= RANGES[i][1]:
        return RANGES[i][2]


def cep_class(cep):
    dd = re.sub(r"\D", "", str(cep or ""))
    if len(dd) != 8:
        return "sem_cep"
    return "generico_000" if dd.endswith("000") else "especifico"


def main():
    load_env()
    from supabase import create_client
    cli = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_ROLE_KEY"])

    cols = ("uf,bairro_norm,municipio_cod,cidade,renda_pc,renda_mediana,percentil_municipio,"
            "ranking_municipio,domicilios,pessoas,fonte,ano")
    renda = {}
    off = 0
    while True:
        rows = cli.table("renda_bairro").select(cols).range(off, off + 999).execute().data
        if not rows:
            break
        for r in rows:
            renda[(r["uf"], norm(r["bairro_norm"]))] = r
        off += 1000
        if off > 40000:
            break

    # renda municipal (mediana dos bairros) — usada no fallback -000/sem-bairro
    mun = collections.defaultdict(list)
    cidade_por_ufkey = {}  # (uf, cidade_norm) -> municipio_cod, p/ fallback municipal
    for r in renda.values():
        if isinstance(r.get("renda_pc"), (int, float)):
            mun[r["municipio_cod"]].append(r["renda_pc"])
        if r.get("municipio_cod") and r.get("cidade"):
            cidade_por_ufkey[(r["uf"], norm(r["cidade"]))] = r["municipio_cod"]
    mun_renda = {k: round(statistics.median(v), 2) for k, v in mun.items()}

    at = json.load(open(rf"{ROOT}\data\academia.train.json", encoding="utf-8"))
    cid_by_ibge = {c["ibge"]: c for c in at["cidades"]}

    d = json.load(open(rf"{ROOT}\data\processed\tp-bairro-index.json", encoding="utf-8"))
    agg = collections.defaultdict(lambda: {"n": 0, "lat": [], "lng": [], "cep": collections.Counter(),
                                           "city": collections.Counter()})
    for v in d["by_gym_id"].values():
        b = norm(v.get("bairro_slug") or v.get("bairro") or "")
        if not b:
            continue
        uf = uf_disp(v.get("nominatim_display_name")) or uf_cep(v.get("cep"))
        if not uf:
            continue
        a = agg[(uf, b)]
        a["n"] += 1
        if isinstance(v.get("lat"), (int, float)):
            a["lat"].append(v["lat"])
        if isinstance(v.get("lng"), (int, float)):
            a["lng"].append(v["lng"])
        a["cep"][cep_class(v.get("cep"))] += 1
        # cidade do display Nominatim (penúltimo campo antes de UF), best-effort
        disp = v.get("nominatim_display_name") or ""
        parts = [p.strip() for p in disp.split(",")]
        if len(parts) >= 4:
            a["city"][norm(parts[-4])] += 1

    feats = []
    src = collections.Counter()
    for (uf, b), a in agg.items():
        row = renda.get((uf, b))
        mcod = cidade = renda_pc = renda_med = perc = rank = dom = pes = fonte = None
        if row and isinstance(row.get("renda_pc"), (int, float)):
            renda_src, granul = "bairro", "bairro"
            mcod, cidade = row["municipio_cod"], row["cidade"]
            renda_pc, renda_med, perc = row["renda_pc"], row.get("renda_mediana"), row.get("percentil_municipio")
            rank, dom, pes, fonte = row.get("ranking_municipio"), row.get("domicilios"), row.get("pessoas"), row.get("fonte")
        else:
            # fix #1: fallback municipal via cidade dominante do display -> municipio_cod
            city_norm = a["city"].most_common(1)[0][0] if a["city"] else None
            mcod = cidade_por_ufkey.get((uf, city_norm)) if city_norm else None
            if mcod and mcod in mun_renda:
                renda_src, granul = "municipio_fallback", "municipio"
                cidade = city_norm
                renda_pc = mun_renda[mcod]
                fonte = "renda_bairro (mediana municipal — fallback -000/sem-bairro)"
            else:
                renda_src, granul = "missing", "nao_disponivel"
        src[renda_src] += 1

        muni = cid_by_ibge.get(mcod) if mcod else None
        merc = (muni or {}).get("mercado") or {}
        feats.append({
            "uf": uf, "bairro_norm": b, "municipio_cod": mcod, "cidade": cidade,
            "n_gyms": a["n"],
            "lat_centroide": round(statistics.mean(a["lat"]), 6) if a["lat"] else None,
            "lng_centroide": round(statistics.mean(a["lng"]), 6) if a["lng"] else None,
            "cep_mix": dict(a["cep"]),
            "renda_pc": renda_pc, "renda_mediana": renda_med, "percentil_municipio": perc,
            "ranking_municipio": rank, "domicilios": dom, "pessoas": pes,
            "renda_source": renda_src, "granularidade": granul, "renda_fonte": fonte,
            "mun_renda_pc_mediana": merc.get("renda_pc_mediana"),
            "mun_empresas_por_mil": merc.get("empresas_por_mil"),
            "mun_indice_formal": merc.get("indice_formal"),
            "mun_score_corporativo": merc.get("score_corporativo"),
            "mun_pop": (muni or {}).get("pop"),
            "mun_gap_agg": (muni or {}).get("gap_agg"),
            "mun_pattern": (muni or {}).get("pattern"),
            "tendencia_cnpj_bairro": None,  # GAP: cnpj_tendencia.py nao implementado
            "tendencia_provenance": "nao_implementado:SPEC_TENDENCIA_CNPJ_BAIRROS",
        })

    out = rf"{ROOT}\data\processed\viabilidade-features-bairro.json"
    json.dump({
        "_meta": {
            "n": len(feats), "gerado_por": "build_viabilidade_features.py",
            "eixos": ["demanda(renda_bairro)", "municipal", "oferta_gym(densidade)", "geo", "tendencia(GAP)"],
            "fixes": ["-000/sem-match->municipal(flag)", "sem-CEP->geocode ja no index", "lat/lng incluidos"],
            "renda_source_dist": dict(src),
            "gaps": ["tendencia_cnpj_bairro: cnpj_tendencia.py nao implementado"],
        },
        "features": feats,
    }, open(out, "w", encoding="utf-8"), ensure_ascii=False)

    print("bairros:", len(feats))
    print("renda_source:", dict(src))
    print("com renda bairro:", sum(1 for f in feats if f["renda_source"] == "bairro"))
    print("com municipal mercado:", sum(1 for f in feats if f["mun_renda_pc_mediana"] is not None))
    cov = sum(1 for f in feats if f["renda_pc"] is not None)
    print(f"com renda (bairro+fallback): {cov}/{len(feats)} = {100*cov/max(len(feats),1):.1f}%")
    print("saida:", out)


if __name__ == "__main__":
    main()
