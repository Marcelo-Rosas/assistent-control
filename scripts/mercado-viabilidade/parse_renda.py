import json, os, re
TR = r"C:/Users/marce/.claude/projects/c--Users-marce-assistent-control/cd1a9a7f-5aec-43b4-aa9a-6dd1f66b2310/tool-results"
files = ["mcp-plugin_supabase_supabase-execute_sql-1788364317071.txt",
         "mcp-plugin_supabase_supabase-execute_sql-1788364330553.txt",
         "mcp-plugin_supabase_supabase-execute_sql-1788364336754.txt"]
pat = re.compile(r'(\d{6,7})~([^~\\]+?)~(\d+)')
out = {}
n = 0
for fn in files:
    d = json.load(open(os.path.join(TR, fn), encoding="utf-8"))
    for code, bairro, renda in pat.findall(d["result"]):
        out.setdefault(code, {})[bairro.strip()] = int(renda)
        n += 1
print(f"triplas: {n} | municipios: {len(out)} | bairros: {sum(len(v) for v in out.values())}")
json.dump(out, open(r"C:/Users/marce/assistent-control/data/processed/renda-bairro-by-ibge-nacional.json", "w", encoding="utf-8"), ensure_ascii=False)
print("Vitoria 3205309:", len(out.get('3205309', {})), "| Blumenau:", len(out.get('4202404', {})), "| SP:", len(out.get('3550308', {})))
print("sample SP:", list(out.get('3550308', {}).items())[:3])
