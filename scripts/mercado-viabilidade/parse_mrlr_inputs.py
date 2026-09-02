import json, os, re
TR = r"C:/Users/marce/.claude/projects/c--Users-marce-assistent-control/cd1a9a7f-5aec-43b4-aa9a-6dd1f66b2310/tool-results"
OUT = r"C:/Users/marce/assistent-control/data/processed"

def blob_of(fn):
    d = json.load(open(os.path.join(TR, fn), encoding="utf-8"))
    s = d["result"]
    i = s.index('"blob":"') + 8
    j = s.index('"}]', i)
    return s[i:j]

# renda_bairro percentil: code~bairro~percentil (percentil pode ser vazio)
renda_files = ["mcp-plugin_supabase_supabase-execute_sql-1788365940379.txt",
               "mcp-plugin_supabase_supabase-execute_sql-1788365944118.txt",
               "mcp-plugin_supabase_supabase-execute_sql-1788365952861.txt"]
pat_r = re.compile(r'(\d{6,7})~([^~\\]+?)~([0-9.]*)(?:\\n|$)')
renda = {}
nr = 0
for fn in renda_files:
    for code, bairro, perc in pat_r.findall(blob_of(fn)):
        renda.setdefault(code, {})[bairro.strip()] = float(perc) if perc else None
        nr += 1
json.dump(renda, open(f"{OUT}/renda-bairro-percentil.json", "w", encoding="utf-8"), ensure_ascii=False)
print(f"renda_bairro percentil: {nr} triplas | municipios {len(renda)} | bairros {sum(len(v) for v in renda.values())}")

# municipio_pib: id~pop~pib_reais~pib_pc
pat_p = re.compile(r'(\d{6,7})~([0-9]*)~([0-9.eE+]*)~([0-9.eE+]*)(?:\\n|$)')
pib = {}
for idm, pop, pibr, pibpc in pat_p.findall(blob_of("mcp-plugin_supabase_supabase-execute_sql-1788365956441.txt")):
    pib[idm] = {"populacao": int(pop) if pop else None,
                "pib_reais": float(pibr) if pibr else None,
                "pib_per_capita": float(pibpc) if pibpc else None}
json.dump(pib, open(f"{OUT}/municipio-pib.json", "w", encoding="utf-8"), ensure_ascii=False)
print(f"municipio_pib: {len(pib)} municipios")
print("sample pib:", list(pib.items())[:2])
print("Fortaleza 2304400:", pib.get("2304400"))
