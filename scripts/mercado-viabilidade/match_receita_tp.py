"""Cruzamento Receita (CNAE 9313100 ativos) x TotalPass — sem CNPJ no TP.
Match por: bloco cidade+UF -> ancora logradouro+numero -> confirma nome_fantasia.
Chains (Smart Fit etc) exigem ancora de endereco (nao casa por nome so).
Saidas: receita-x-totalpass-match.csv/json + penetracao por municipio/UF.
"""
import json, re, unicodedata, csv, os, collections
from rapidfuzz import fuzz, process

ROOT = r"C:/Users/marce/assistent-control"
SCR = r"C:/Users/marce/AppData/Local/Temp/claude/c--Users-marce-assistent-control/cd1a9a7f-5aec-43b4-aa9a-6dd1f66b2310/scratchpad"
OUT = os.path.join(ROOT, "data", "processed")

RFB = json.load(open(SCR + "/rfb_municipio.json", encoding="utf-8"))

def strip_ac(s):
    return "".join(c for c in unicodedata.normalize("NFKD", s) if not unicodedata.combining(c))

def norm(s):
    s = strip_ac(str(s or "")).upper()
    s = re.sub(r"[^A-Z0-9 ]", " ", s)
    return re.sub(r"\s+", " ", s).strip()

TIPO = {"RUA","R","AV","AVENIDA","AVN","AV.","TRAVESSA","TV","TRV","RODOVIA","ROD","ALAMEDA","AL",
        "PRACA","PC","PCA","ESTRADA","EST","ESTR","VILA","VL","LARGO","LGO","BECO","BC","VIELA",
        "PASSAGEM","PSG","QUADRA","Q","QD","CONJUNTO","CJ","SETOR","LOTEAMENTO","LOT","JARDIM","JD"}
# So sufixo societario/artigos — NAO remover ACADEMIA/FITNESS/etc (token_set_ratio lida com tokens extras;
# remover demais gera nucleos minusculos que dao falso-positivo)
CORP = {"LTDA","ME","EIRELI","EPP","SA","CIA","DE","DA","DO","DOS","DAS","E"}

def street_key(tipo, logr):
    toks = norm(f"{tipo} {logr}").split()
    toks = [t for t in toks if t not in TIPO]
    return " ".join(toks)

def street_from_full(full):
    # "Av Brig Faria Lima, 2894, 111" -> street, numero
    parts = [p.strip() for p in str(full or "").split(",")]
    street = parts[0] if parts else ""
    num = ""
    if len(parts) >= 2:
        num = re.sub(r"\D", "", parts[1])
    toks = [t for t in norm(street).split() if t not in TIPO]
    return " ".join(toks), num

def name_core(s):
    # so remove sufixo societario/artigos; mantem ACADEMIA/FITNESS/etc (token_set_ratio robusto)
    toks = [t for t in norm(s).split() if t not in CORP]
    return " ".join(toks) if toks else norm(s)

def num_norm(n):
    d = re.sub(r"\D", "", str(n or ""))
    return d

# ---------- Receita ativos FULL (principal+secundario, situacao 02) ----------
full = json.load(open(f"{OUT}/receita-cnae-9313100.json", encoding="utf-8"))
rec = [r for r in full if r.get("situacao_cadastral") == "02"]
R = []
for r in rec:
    uf = r.get("uf", "")
    code = str(r.get("municipio", "")).zfill(4)
    ref = RFB.get(code) or {}
    city = ref.get("nome", "")
    R.append({
        "cnpj": r["cnpj"], "nome": r.get("nome_fantasia", ""),
        "uf": uf, "city": city, "ibge": ref.get("ibge", ""),
        "cnae_match": r.get("cnae_match", ""),
        "bairro": r.get("bairro", ""), "cep": num_norm(r.get("cep")),
        "st": street_key(r.get("tipo_logradouro", ""), r.get("logradouro", "")),
        "num": num_norm(r.get("numero")),
        "nc": name_core(r.get("nome_fantasia", "")),
        "ckey": uf,  # bloco por UF (city do TP nao e confiavel)
    })
n_princ = sum(1 for x in R if x["cnae_match"] == "principal")
print(f"Receita ativos FULL: {len(R)} (principal={n_princ}, secundario={len(R)-n_princ})")

# ---------- TotalPass ----------
tp = json.load(open(f"{ROOT}/data/raw/totalpass-brasil-all.json", encoding="utf-8"))
tp = tp if isinstance(tp, list) else (tp.get("data") or list(tp.values())[0])
T = []
for g in tp:
    a = g.get("attributes", {})
    uf = a.get("uf", "")
    muns = a.get("municipios_relacionados") or a.get("municipios_busca") or []
    city = muns[0] if muns else ""
    st, num = street_from_full(a.get("full_address", ""))
    T.append({
        "id": a.get("identifier") or g.get("id"), "name": a.get("name", ""),
        "uf": uf, "city": city, "st": st, "num": num,
        "nc": name_core(a.get("name", "")),
        "ckey": uf,  # bloco por UF
    })
print(f"TotalPass: {len(T)}")

# ---------- index TP: (uf,numero) e sub-bloco por token distintivo ----------
def keytok(s):
    toks = [t for t in s.split() if len(t) >= 4]
    return max(toks, key=len) if toks else (s.split()[0] if s.split() else "")

tp_by_ufnum = collections.defaultdict(list)
tp_by_uf_ntok = collections.defaultdict(list)   # (uf, nome-token) -> idx
tp_by_uf_stok = collections.defaultdict(list)   # (uf, rua-token)  -> idx
for i, t in enumerate(T):
    if t["num"]:
        tp_by_ufnum[(t["ckey"], t["num"])].append(i)
    if t["nc"]:
        tp_by_uf_ntok[(t["ckey"], keytok(t["nc"]))].append(i)
    if t["st"]:
        tp_by_uf_stok[(t["ckey"], keytok(t["st"]))].append(i)

# ---------- match (precision-first: endereco E nome, nunca so um) ----------
def match_row(r):
    if not r["nc"]:
        return None  # sem nome nao ha como confirmar -> nao casa
    best = None  # (tier, addr_sim, name_sim, tp_idx, method)
    # PASSO 1: mesmo UF+numero -> exige rua alta E nome ok (mata colisao cross-cidade)
    if r["num"]:
        for ti in tp_by_ufnum.get((r["ckey"], r["num"]), []):
            t = T[ti]
            if not t["nc"]:
                continue
            ss = fuzz.token_set_ratio(r["st"], t["st"]) if r["st"] and t["st"] else 0
            ns = fuzz.token_set_ratio(r["nc"], t["nc"])
            if ss >= 85 and ns >= 72:
                cand = ("alta", ss, ns, ti, "num+rua+nome")
                if best is None or (cand[2] + cand[1]) > (best[2] + best[1]):
                    best = cand
    if best:
        return best
    # PASSO 2: nome muito forte (sub-bloco) ancorado por rua moderada (numero ausente/typo)
    ntok = keytok(r["nc"])
    for ti in tp_by_uf_ntok.get((r["ckey"], ntok), []):
        t = T[ti]
        ns = fuzz.token_set_ratio(r["nc"], t["nc"])
        if ns >= 88:
            ss = fuzz.token_set_ratio(r["st"], t["st"]) if r["st"] and t["st"] else 0
            if ss >= 70:
                cand = ("media", ss, ns, ti, "nome+rua")
                if best is None or (cand[2] + cand[1]) > (best[2] + best[1]):
                    best = cand
    return best

rows = []
matched = 0
for r in R:
    base = {k: r[k] for k in ("cnpj","nome","uf","city","ibge","bairro","cnae_match")}
    m = match_row(r)
    if m:
        matched += 1
        t = T[m[3]]
        rows.append({**base, "match": 1, "tier": m[0], "method": m[4],
                     "addr_sim": round(m[1]), "name_sim": round(m[2]),
                     "tp_id": t["id"], "tp_name": t["name"]})
    else:
        rows.append({**base, "match": 0, "tier": "", "method": "", "addr_sim": "", "name_sim": "",
                     "tp_id": "", "tp_name": ""})

print(f"\n=== MATCH: {matched}/{len(R)} = {100*matched/len(R):.1f}% Receita ativos (full) casam com TP ===")
# recorte principal (mercado core)
pr = [x for x in rows if x["cnae_match"] == "principal"]
pr_m = sum(x["match"] for x in pr)
print(f"    recorte PRINCIPAL: {pr_m}/{len(pr)} = {100*pr_m/len(pr):.1f}% penetracao TP no mercado core")
tiers = collections.Counter(x["tier"] for x in rows if x["match"])
print("por tier:", dict(tiers))
meth = collections.Counter(x["method"] for x in rows if x["match"])
print("por metodo:", dict(meth))

# TP casados unicos (cobertura reversa)
tp_used = set(x["tp_id"] for x in rows if x["match"])
print(f"TP unicos casados: {len(tp_used)} / {len(T)} ({100*len(tp_used)/len(T):.1f}% da base TP)")

# ---------- saidas ----------
cols = ["cnpj","nome","uf","city","ibge","bairro","cnae_match","match","tier","method","addr_sim","name_sim","tp_id","tp_name"]
with open(f"{OUT}/receita-x-totalpass-match.csv", "w", encoding="utf-8", newline="") as f:
    w = csv.DictWriter(f, fieldnames=cols); w.writeheader(); w.writerows(rows)
json.dump(rows, open(f"{OUT}/receita-x-totalpass-match.json", "w", encoding="utf-8"), ensure_ascii=False)

# penetracao por UF>municipio
pen = collections.defaultdict(lambda: {"receita": 0, "tp_match": 0})
for x in rows:
    k = (x["uf"], x["city"], x["ibge"])
    pen[k]["receita"] += 1
    pen[k]["tp_match"] += x["match"]
pen_list = []
for (uf, city, ibge), v in pen.items():
    r_ = v["receita"]; m_ = v["tp_match"]
    pen_list.append({"uf": uf, "municipio": city, "ibge": ibge,
                     "receita_ativos": r_, "tp_match": m_,
                     "whitespace": r_ - m_,
                     "penetracao_pct": round(100*m_/r_, 1) if r_ else 0})
pen_list.sort(key=lambda x: -x["receita_ativos"])
json.dump(pen_list, open(f"{OUT}/receita-x-totalpass-penetracao.json", "w", encoding="utf-8"), ensure_ascii=False, indent=1)

print("\n=== PENETRACAO TP nas 12 maiores cidades (Receita) ===")
print(f"{'cidade':22} {'UF':3} {'receita':>7} {'tp':>5} {'pen%':>6} {'whitespace':>10}")
for x in pen_list[:12]:
    print(f"{x['municipio'][:21]:22} {x['uf']:3} {x['receita_ativos']:7} {x['tp_match']:5} {x['penetracao_pct']:6} {x['whitespace']:10}")

tot_r = len(R); tot_m = matched
print(f"\nBRASIL: {tot_m}/{tot_r} academias formais na TP = {100*tot_m/tot_r:.1f}% penetracao | whitespace = {tot_r-tot_m}")
print("saidas: receita-x-totalpass-match.csv/.json + receita-x-totalpass-penetracao.json")
