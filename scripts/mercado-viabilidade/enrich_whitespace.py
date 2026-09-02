"""Enriquece o cruzamento: whitespace (formais fora do TP) + renda bairro + contatos + idade.
Entrega lista de prospeccao comercial pronta.
"""
import json, re, unicodedata, csv, os, collections

ROOT = r"C:/Users/marce/assistent-control"
OUT = os.path.join(ROOT, "data", "processed")

def strip_ac(s):
    return "".join(c for c in unicodedata.normalize("NFKD", str(s or "")) if not unicodedata.combining(c))
def bnorm(s):
    # compativel com bairro_norm do Supabase: lowercase, sem acento, sem pontuacao, espaco unico
    return re.sub(r"\s+", " ", re.sub(r"[^a-z0-9 ]", " ", strip_ac(s).lower())).strip()

# match rows (cnpj -> match/tp)
match = {r["cnpj"]: r for r in json.load(open(f"{OUT}/receita-x-totalpass-match.json", encoding="utf-8"))}

# --- PASSO 2: filtro clinica (config canonica receita-cnae-segments.json) ---
cfg = json.load(open(f"{ROOT}/data/config/receita-cnae-segments.json", encoding="utf-8"))
CNAE2SEG = {s["cnae"]: s["id"] for s in cfg["segments"]}
SEG2GROUP = {}
for grp, ids in cfg.get("segment_groups", {}).items():
    for i in ids:
        SEG2GROUP[i] = grp
# segmentos que NAO sao academia-alvo-frete (saude/medico/nicho nao-academia)
NAO_ACADEMIA_SEG = {"spa_estetica", "clinica", "clinica_ne", "geriatria", "fisioterapia"}
NOME_SAUDE = re.compile(r"\b(clinic|reabilit|fisioterap|fisio|nutri|geriatr|estetic|odonto|psicolog|medic|saude|terapia)\w*", re.I)

def classifica(cnae_principal, nome):
    seg = CNAE2SEG.get(str(cnae_principal or "").strip(), "academia" if str(cnae_principal).strip() == "9313100" else "outro")
    is_core = str(cnae_principal).strip() == "9313100"
    nome_saude = bool(NOME_SAUDE.search(str(nome or "")))
    # nao-academia se principal e segmento de saude, OU nome fortemente medico e nao e core
    nao_acad = (seg in NAO_ACADEMIA_SEG) or (not is_core and seg in ("danca", "esportes", "outro")) or (nome_saude and not is_core)
    return seg, is_core, nome_saude, nao_acad

# receita full ativos: contatos + idade
full = json.load(open(f"{OUT}/receita-cnae-9313100.json", encoding="utf-8"))
NOW = 2026 * 12 + 9  # set 2026
def idade_anos(dt):
    d = re.sub(r"\D", "", str(dt or ""))
    if len(d) < 6: return ""
    y, m = int(d[:4]), int(d[4:6])
    return round((NOW - (y*12+m)) / 12, 1)

# resolver de cobertura ~100% (bairro exato -> fuzzy -> mediana municipio) + aluguel MRLR
import sys
sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "scratchpad", "totalpass"))
sys.path.insert(0, r"C:/Users/marce/AppData/Local/Temp/claude/c--Users-marce-assistent-control/cd1a9a7f-5aec-43b4-aa9a-6dd1f66b2310/scratchpad/totalpass")
from bairro_resolver import Resolver
RV = Resolver()

rows = []
for r in full:
    if r.get("situacao_cadastral") != "02":
        continue
    cnpj = r["cnpj"]
    m = match.get(cnpj, {})
    is_match = m.get("match", 0)
    ibge = m.get("ibge", "")
    bairro = r.get("bairro", "")
    seg, is_core, nome_saude, nao_acad = classifica(r.get("cnae_fiscal_principal"), r.get("nome_fantasia"))
    res = RV.full(ibge, bairro) if ibge else {"renda_pc": "", "vu_m2": None, "aluguel_total": None, "match_level": "sem_ibge"}
    vu = res.get("vu_m2")
    rows.append({
        "cnpj": cnpj,
        "nome": r.get("nome_fantasia", ""),
        "uf": r.get("uf", ""),
        "cidade": m.get("city", ""),
        "ibge": ibge,
        "bairro": bairro,
        "renda_bairro": round(res["renda_pc"]) if isinstance(res.get("renda_pc"), (int, float)) else "",
        "aluguel_m2": vu if vu else "",
        "aluguel_total": res.get("aluguel_total") or "",
        "margem_proxy": round(res["renda_pc"] / vu, 2) if (vu and isinstance(res.get("renda_pc"), (int, float))) else "",
        "match_renda": res.get("match_level", ""),
        "cnae_match": r.get("cnae_match", ""),
        "cnae_principal": r.get("cnae_fiscal_principal", ""),
        "segmento": seg,
        "academia_core": int(is_core),
        "flag_nao_academia": int(nao_acad),
        "na_totalpass": is_match,
        "tp_name": m.get("tp_name", ""),
        "telefone": (f'{r.get("ddd_1","")}{r.get("telefone_1","")}' if r.get("telefone_1") else ""),
        "email": r.get("correio_eletronico", "") or "",
        "idade_anos": idade_anos(r.get("data_inicio_atividade")),
    })

# whitespace = formais fora do TP
ws = [x for x in rows if not x["na_totalpass"]]
# academia-alvo: whitespace E core academia E nao flagada clinica
academias = [x for x in ws if x["academia_core"] and not x["flag_nao_academia"]]
clinicas = [x for x in ws if x["flag_nao_academia"]]
com_contato = [x for x in academias if x["telefone"] or x["email"]]
com_renda = [x for x in academias if x["renda_bairro"] != ""]

print(f"Total ativos: {len(rows)} | na TP: {sum(x['na_totalpass'] for x in rows)} | WHITESPACE: {len(ws)}")
seg_ws = collections.Counter(x["segmento"] for x in ws)
print(f"  segmentos no whitespace: {dict(seg_ws)}")
print(f"  -> ACADEMIA-ALVO (core, sem clinica): {len(academias)}")
print(f"  -> removidas como clinica/fisio/estetica/nao-acad: {len(clinicas)}")
print(f"  academia-alvo com contato: {len(com_contato)} ({100*len(com_contato)//max(1,len(academias))}%) | com renda: {len(com_renda)} ({100*len(com_renda)//max(1,len(academias))}%)")

# ranked prospects: academia-alvo com renda, ordenado por renda desc
prospects = sorted([x for x in academias if x["renda_bairro"] != ""], key=lambda x: -float(x["renda_bairro"]))
cols = ["cnpj","nome","uf","cidade","bairro","renda_bairro","aluguel_m2","aluguel_total","margem_proxy","match_renda","idade_anos","telefone","email","segmento","cnae_match","cnae_principal","academia_core","flag_nao_academia","tp_name","na_totalpass"]
with open(f"{OUT}/receita-whitespace-academias.csv", "w", encoding="utf-8", newline="") as f:
    w = csv.DictWriter(f, fieldnames=cols, extrasaction="ignore"); w.writeheader(); w.writerows(prospects)
# full enriched (todos ativos, com flags)
with open(f"{OUT}/receita-enriched-totalpass.csv", "w", encoding="utf-8", newline="") as f:
    w = csv.DictWriter(f, fieldnames=cols, extrasaction="ignore"); w.writeheader(); w.writerows(rows)

print(f"\n=== TOP 12 academias-alvo premium (core gym, bairro rico, fora TP, com contato) ===")
top = [p for p in prospects if p["telefone"] or p["email"]][:12]
for p in top:
    S = lambda x: str(x or "")
    print(f"  R${S(p['renda_bairro']):>6} alug{S(p['aluguel_m2']):>6} {S(p['cidade'])[:14]:14} {S(p['bairro'])[:16]:16} {S(p['nome'])[:24]:24} [{S(p['match_renda'])[:9]}]")
print("\nsaidas: receita-whitespace-academias.csv (alvo limpo) + receita-enriched-totalpass.csv")
