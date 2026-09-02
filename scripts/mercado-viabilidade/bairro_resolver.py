"""Resolver de bairro -> renda + percentil, cobertura ~100% (meta 99%, zero 'sem dado').
Cascata: bairro EXATO (norm) -> bairro FUZZY (rapidfuzz dentro do municipio) -> MEDIANA do municipio.
Sempre retorna valor (com match_level p/ transparencia). renda_bairro cobre 5570 munis -> fallback sempre existe.
"""
import json, re, unicodedata, statistics, functools
from rapidfuzz import process, fuzz
from mrlr_aluguel import porte_de_populacao, fator_de_pib_per_capita, padrao_de_percentil, valor_unitario_mrlr, REF_AREA

PROC = r"C:/Users/marce/assistent-control/data/processed"

# expansao de abreviacoes comuns (Receita/Correios) p/ casar com catalogo IBGE
ABBR = {
    "jd": "jardim", "jardins": "jardim", "vl": "vila", "pq": "parque", "pque": "parque",
    "res": "residencial", "resid": "residencial", "cj": "conjunto", "conj": "conjunto",
    "cjto": "conjunto", "st": "setor", "str": "setor", "nsa": "nossa senhora",
    "sto": "santo", "sta": "santa", "pres": "presidente", "gov": "governador",
    "dr": "doutor", "dra": "doutora", "profa": "professora", "prof": "professor",
    "cel": "coronel", "eng": "engenheiro", "alm": "almirante", "mal": "marechal",
    "pe": "padre", "n": "nova", "nv": "nova", "novo": "novo", "vist": "vista",
    "bl": "bloco", "loteamento": "loteamento", "lot": "loteamento", "ch": "chacara",
    "chac": "chacara", "faz": "fazenda", "distr": "distrito", "dist": "distrito",
}
STOP = {"de", "da", "do", "dos", "das", "e", "o", "a"}

def strip_ac(s):
    return "".join(c for c in unicodedata.normalize("NFKD", str(s or "")) if not unicodedata.combining(c))

def norm(s):
    s = strip_ac(s).lower()
    s = re.sub(r"[^a-z0-9 ]", " ", s)
    toks = [ABBR.get(t, t) for t in s.split() if t not in STOP]
    return re.sub(r"\s+", " ", " ".join(toks)).strip()

def _variants(bairro_raw):
    """Compostos 'X/Y', 'X - Y' -> tenta cada parte + o todo."""
    raw = str(bairro_raw or "")
    parts = re.split(r"[/\\\-–—]| ou ", raw)
    outs = [norm(raw)] + [norm(p) for p in parts if p.strip()]
    seen = set(); uniq = []
    for o in outs:
        if o and o not in seen:
            seen.add(o); uniq.append(o)
    return uniq

class Resolver:
    def __init__(self):
        renda = json.load(open(f"{PROC}/renda-bairro-by-ibge-nacional.json", encoding="utf-8"))
        perc = json.load(open(f"{PROC}/renda-bairro-percentil.json", encoding="utf-8"))
        # por ibge: {bairro_norm: (renda_pc, percentil)} + medianas + lista de keys
        self.by_ibge = {}
        self.med = {}
        self.keys = {}
        for ibge, bl in renda.items():
            d = {}
            for b, rp in bl.items():
                nb = norm(b)
                pc = (perc.get(ibge) or {}).get(b)
                d[nb] = (float(rp), pc if pc is not None else None)
            if not d:
                continue
            self.by_ibge[ibge] = d
            self.keys[ibge] = list(d.keys())
            rendas = [v[0] for v in d.values()]
            percs = [v[1] for v in d.values() if v[1] is not None]
            self.med[ibge] = (statistics.median(rendas),
                              statistics.median(percs) if percs else 0.5)
        # medianas nacionais (ultimo fallback se ibge ausente)
        allr = [m[0] for m in self.med.values()]
        self.nat = (statistics.median(allr) if allr else 0.0, 0.5)
        # municipio_pib p/ MRLR (porte/pib/fator por municipio)
        self.pib = json.load(open(f"{PROC}/municipio-pib.json", encoding="utf-8"))

    def vu(self, ibge, percentil):
        """Aluguel VU (R$/m2) via MRLR p/ o municipio+percentil. None se sem PIB."""
        m = self.pib.get(ibge)
        if not m or not m.get("populacao") or not m.get("pib_reais"):
            return None
        porte = porte_de_populacao(m["populacao"])
        fator = fator_de_pib_per_capita(m.get("pib_per_capita") or 0)
        padrao = padrao_de_percentil(percentil)
        return valor_unitario_mrlr(REF_AREA, padrao, 2, porte, m["pib_reais"], fator)

    def full(self, ibge, bairro_raw):
        """renda + percentil + aluguel VU, cobertura ~100% (bairro/municipio/nacional)."""
        r = self.resolve(ibge, bairro_raw)
        vu = self.vu(ibge, r["percentil"])
        r["vu_m2"] = vu
        r["aluguel_total"] = round(vu * REF_AREA, 2) if vu else None
        return r

    @functools.lru_cache(maxsize=200000)
    def resolve(self, ibge, bairro_raw):
        d = self.by_ibge.get(ibge)
        if not d:
            return {"renda_pc": self.nat[0], "percentil": self.nat[1], "match_level": "nacional"}
        for v in _variants(bairro_raw):
            if v in d:
                rp, pc = d[v]
                return {"renda_pc": rp, "percentil": pc if pc is not None else self.med[ibge][1], "match_level": "bairro_exato"}
        # fuzzy dentro do municipio
        cand = _variants(bairro_raw)
        best = None
        for v in cand:
            if not v:
                continue
            hit = process.extractOne(v, self.keys[ibge], scorer=fuzz.token_set_ratio, score_cutoff=82)
            if hit and (best is None or hit[1] > best[1]):
                best = hit
        if best:
            rp, pc = d[best[0]]
            return {"renda_pc": rp, "percentil": pc if pc is not None else self.med[ibge][1], "match_level": "bairro_fuzzy"}
        # fallback mediana do municipio
        mr, mp = self.med[ibge]
        return {"renda_pc": mr, "percentil": mp, "match_level": "municipio"}


if __name__ == "__main__":
    import csv, collections
    rv = Resolver()
    ibge_by_cnpj = {r["cnpj"]: r.get("ibge", "") for r in json.load(open(f"{PROC}/receita-x-totalpass-match.json", encoding="utf-8"))}
    lvl = collections.Counter()
    n = 0
    with open(f"{PROC}/receita-enriched-totalpass.csv", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            if row["academia_core"] != "1":
                continue
            ibge = ibge_by_cnpj.get(row["cnpj"], "")
            if not ibge:
                lvl["sem_ibge"] += 1; n += 1; continue
            r = rv.resolve(ibge, row["bairro"])
            lvl[r["match_level"]] += 1; n += 1
    print(f"academias core: {n}")
    for k, v in lvl.most_common():
        print(f"  {k}: {v} ({100*v/n:.1f}%)")
    com = n - lvl.get("sem_ibge", 0)
    print(f"COM DADO (renda+percentil): {com} ({100*com/n:.1f}%)")
