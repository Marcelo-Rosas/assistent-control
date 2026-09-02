"""MRLR de aluguel comercial (IBAPE-GO, R2=0,8633) portado do GymSite, standalone nacional.

Fonte fiel: gymsite/tools/mrlr_modelo.py + aluguel_mrlr.py + catalogos.py (mrlr_coef/mrlr_escala).
    Valor Unitario (R$/m2/mes) = [b0 + b1*ln(Area) + b2*ln(Padrao) + b3*Local
                                  + b4*ln(Porte) + b5*(1/PIB) + b6*Fator]^2
Inputs nacionais dos espelhos Supabase (exportados p/ JSON):
  - padrao   <- renda_bairro.percentil_municipio  (>=0.66->3, <0.33->1, senao 2)
  - porte    <- municipio_pib.populacao           (<30k->1,<50k->2,<100k->3,>=100k->4)
  - fator    <- municipio_pib.pib_per_capita      (>=50k->2 senao 1)
  - PIB      <- municipio_pib.pib_reais (total)
  - local    <- zoneamento LUOS (INEXISTENTE nacional -> default 2, como o codigo degrada)
  - area     <- REF 500 m2 (VU depende de ln(area); fixa p/ comparar bairros)

HONESTIDADE: calibracao em Goias -> aplicacao nacional e EXTRAPOLACAO GEOGRAFICA (o proprio
codigo rotula). local=2 default (sem zoneamento). VU a 500 m2 de referencia. Aluguel = ESTIMATIVA.
"""
import json, math, os, collections

OUT = r"C:/Users/marce/assistent-control/data/processed"
REF_AREA = 500.0

# coeficientes fixos (gymsite/tools/catalogos.py catalogo mrlr_coef, verbatim)
COEF = {"intercepto": 4.313769885, "ln_area": -0.8626002338, "ln_padrao": 1.864588423,
        "local": 0.9845380613, "ln_porte": 0.6497837846, "inv_pib": -74535651.84,
        "fator_economico": 1.7713348}

def porte_de_populacao(pop):
    p = float(pop or 0)
    return 1 if p < 30_000 else 2 if p < 50_000 else 3 if p < 100_000 else 4

def fator_de_pib_per_capita(pib_pc):
    return 2 if float(pib_pc or 0) >= 50_000 else 1

def padrao_de_percentil(perc):
    if perc is None:
        return 2
    return 3 if perc >= 0.66 else 1 if perc < 0.33 else 2

def valor_unitario_mrlr(area_m2, padrao, local, porte, pib, fator):
    c = COEF
    if area_m2 <= 0 or padrao <= 0 or porte <= 0 or pib <= 0:
        return None
    base = (c["intercepto"] + c["ln_area"] * math.log(area_m2)
            + c["ln_padrao"] * math.log(padrao) + c["local"] * local
            + c["ln_porte"] * math.log(porte) + c["inv_pib"] * (1.0 / pib)
            + c["fator_economico"] * fator)
    return round(base ** 2, 2) if base > 0 else None

def _sanity():
    # Coco/Fortaleza 900 m2, padrao 3, local 2, porte 4, PIB Fortaleza -> VU ~ 26,37 (auditado no GymSite)
    vu = valor_unitario_mrlr(900, 3, 2, 4, 86_939_832_000.0, 1)
    print(f"[sanity] Coco/Fortaleza 900m2 VU={vu} (esperado ~26.37) -> {'OK' if abs(vu-26.37)<0.1 else 'DIVERGE'}")
    return vu

def run():
    _sanity()
    renda = json.load(open(f"{OUT}/renda-bairro-percentil.json", encoding="utf-8"))
    pib = json.load(open(f"{OUT}/municipio-pib.json", encoding="utf-8"))
    out = {}
    n_bairro = 0
    sem_pib = collections.Counter()
    for ibge, bairros in renda.items():
        m = pib.get(ibge)
        if not m or not m.get("populacao") or not m.get("pib_reais"):
            sem_pib[ibge] += 1
            continue
        pop = m["populacao"]; pibr = m["pib_reais"]; pibpc = m.get("pib_per_capita") or 0
        porte = porte_de_populacao(pop); fator = fator_de_pib_per_capita(pibpc)
        local = 2  # sem zoneamento nacional
        d = {}
        for bairro, perc in bairros.items():
            padrao = padrao_de_percentil(perc)
            vu = valor_unitario_mrlr(REF_AREA, padrao, local, porte, pibr, fator)
            if vu is None:
                continue
            d[bairro] = {"vu_m2": vu, "aluguel_total": round(vu * REF_AREA, 2),
                         "padrao": padrao, "porte": porte, "fator": fator,
                         "pib_pc": round(pibpc)}
            n_bairro += 1
        if d:
            out[ibge] = d
    meta = {"_meta": {"modelo": "MRLR IBAPE-GO (R2=0,8633)", "area_ref_m2": REF_AREA,
                      "local_default": 2, "aviso": "calibracao Goias; aplicacao nacional = extrapolacao geografica; sem ajuste de zoneamento; aluguel = ESTIMATIVA",
                      "coef": COEF}}
    out_full = {**meta, **out}
    json.dump(out_full, open(f"{OUT}/aluguel-mrlr-nacional.json", "w", encoding="utf-8"), ensure_ascii=False)
    print(f"aluguel-mrlr-nacional.json: {len(out)} municipios, {n_bairro} bairros com aluguel")
    print(f"municipios sem PIB (pulados): {len(sem_pib)}")
    # distribuicao VU
    vus = sorted(v["vu_m2"] for d in out.values() for v in d.values())
    if vus:
        import statistics
        q = lambda p: vus[int(p * (len(vus) - 1))]
        print(f"VU R$/m2 quartis: min={vus[0]} Q1={q(.25)} med={q(.5)} Q3={q(.75)} max={vus[-1]}")
    # sanity bairros
    for ib, nome in [("3550308", "SP"), ("3304557", "RJ")]:
        d = out.get(ib, {})
        if d:
            ex = list(d.items())[:2]
            print(f"  {nome} {ib}: {len(d)} bairros; ex {[(b, v['vu_m2'], 'aluguel', v['aluguel_total']) for b, v in ex]}")

if __name__ == "__main__":
    run()
