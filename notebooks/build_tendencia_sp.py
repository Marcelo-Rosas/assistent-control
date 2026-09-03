"""
Passo 3 — Agregação tendência CNPJ fitness por bairro (PILOTO SP), determinístico.
Alvo de treino: aberturas x fechamentos x saldo x taxa_fechamento por (bairro, ano).
Fonte: receita-cnae-9313100-principal-ativo-baixada.json (RFB, situação 02+08).

Regras (plano aprovado):
  B: métrica = TAXA de fechamento (fechamentos / ativos_inicio_ano).
  C: threshold >=5 estabelecimentos (ever) por bairro — evita ruído de 1 fechamento.
  Janela: 2023-2025 (fechados) + 2026 YTD.
  Anti-leakage: painel guarda o alvo; features (renda etc.) vêm do substrate e são
    pré-período (Censo 2022) — NÃO injetar saldo como feature na hora de treinar.
Determinístico, auditável (SPEC_TENDENCIA_CNPJ_BAIRROS). Sem ML aqui.
"""
from __future__ import annotations

import collections
import json
import unicodedata

ROOT = r"C:\Users\marce\assistent-control"
SRC = rf"{ROOT}\data\processed\receita-cnae-9313100-principal-ativo-baixada.json"
FEATS = rf"{ROOT}\data\processed\viabilidade-features-bairro.json"
OUT = rf"{ROOT}\data\processed\tendencia-sp-bairro.json"
ANOS = [2023, 2024, 2025, 2026]
MIN_ESTAB = 5


def norm(s):
    x = unicodedata.normalize("NFKD", (s or "").strip().lower())
    x = "".join(c for c in x if not unicodedata.combining(c))
    return x.replace("-", " ").strip()


def ymd(v):
    d = "".join(ch for ch in str(v or "") if ch.isdigit())
    return int(d[:8]) if len(d) >= 8 else None


def main():
    rows = json.load(open(SRC, encoding="utf-8"))
    sp = [r for r in rows if str(r.get("uf", "")).upper() == "SP"]

    # eventos por bairro
    por_bairro = collections.defaultdict(list)
    for r in sp:
        b = norm(r.get("bairro"))
        if not b:
            continue
        inicio = ymd(r.get("data_inicio_atividade"))
        situ = str(r.get("situacao_cadastral"))
        fech = ymd(r.get("data_situacao_cadastral")) if situ in ("8", "08") else None
        if inicio is None:
            continue
        por_bairro[b].append((inicio, fech, r.get("cnpj_basico")))

    panel = []
    bairro_vec = {}  # p/ tarefa (b) similaridade
    for b, evs in por_bairro.items():
        if len(evs) < MIN_ESTAB:
            continue
        serie = []
        for ano in ANOS:
            y0, y1 = ano * 10000 + 101, ano * 10000 + 1231
            aberturas = sum(1 for ini, _, _ in evs if y0 <= ini <= y1)
            fechamentos = sum(1 for _, f, _ in evs if f and y0 <= f <= y1)
            # ativos no início do ano = abertos antes de y0 e não fechados antes de y0
            ativos_ini = sum(1 for ini, f, _ in evs if ini < y0 and (f is None or f >= y0))
            saldo = aberturas - fechamentos
            taxa = round(fechamentos / ativos_ini, 4) if ativos_ini > 0 else None
            serie.append({
                "ano": ano, "aberturas": aberturas, "fechamentos": fechamentos,
                "saldo": saldo, "ativos_inicio": ativos_ini, "taxa_fechamento": taxa,
            })
        ativos_hoje = sum(1 for _, f, _ in evs if f is None)
        redes = len({cb for _, _, cb in evs if cb})
        vec = {
            "aberturas_trienio": sum(s["aberturas"] for s in serie if s["ano"] < 2026),
            "fechamentos_trienio": sum(s["fechamentos"] for s in serie if s["ano"] < 2026),
            "saldo_trienio": sum(s["saldo"] for s in serie if s["ano"] < 2026),
            "taxa_fech_media": round(
                sum(s["taxa_fechamento"] for s in serie if s["taxa_fechamento"] is not None)
                / max(1, sum(1 for s in serie if s["taxa_fechamento"] is not None)), 4),
            "ativos_hoje": ativos_hoje,
        }
        bairro_vec[b] = vec
        panel.append({
            "uf": "SP", "bairro_norm": b, "n_estab_total": len(evs),
            "cnpj_basicos_distintos": redes, "serie": serie, **vec,
        })

    # join ao feature substrate (renda/municipal/geo) por (uf, bairro_norm)
    fj = json.load(open(FEATS, encoding="utf-8"))
    fmap = {(f["uf"], f["bairro_norm"]): f for f in fj["features"]}
    joined = matched = 0
    for p in panel:
        f = fmap.get(("SP", p["bairro_norm"]))
        if f:
            matched += 1
            p["renda_pc"] = f.get("renda_pc")
            p["percentil_municipio"] = f.get("percentil_municipio")
            p["renda_source"] = f.get("renda_source")
            p["n_gyms_index"] = f.get("n_gyms")
            p["lat_centroide"] = f.get("lat_centroide")
            p["lng_centroide"] = f.get("lng_centroide")
        else:
            p["renda_pc"] = None
            p["renda_source"] = "sem_join_substrate"
        joined += 1

    tot_ab = sum(p["aberturas_trienio"] for p in panel)
    tot_fe = sum(p["fechamentos_trienio"] for p in panel)
    json.dump({
        "_meta": {
            "piloto": "SP", "janela": "2023-2025 fechados + 2026 YTD",
            "min_estab": MIN_ESTAB, "metrica": "taxa_fechamento = fech/ativos_inicio",
            "n_bairros": len(panel), "n_estab_sp": len(sp),
            "fonte": "receita-cnae-9313100-principal-ativo-baixada.json (RFB 02+08)",
            "join_substrate_pct": round(100 * matched / max(joined, 1), 1),
            "nota_leakage": "saldo/fechamento sao ALVO; nao usar como feature no treino",
        },
        "bairros": sorted(panel, key=lambda p: -p["n_estab_total"]),
    }, open(OUT, "w", encoding="utf-8"), ensure_ascii=False)

    print(f"bairros SP (>= {MIN_ESTAB} estab): {len(panel)}  de {len(por_bairro)} brutos")
    print(f"estab SP: {len(sp)}  aberturas trienio: {tot_ab}  fechamentos trienio: {tot_fe}  saldo: {tot_ab-tot_fe}")
    print(f"join com substrate (renda): {matched}/{len(panel)} = {100*matched/max(len(panel),1):.1f}%")
    # top red-flags: pior saldo com ativos suficientes
    rf = [p for p in panel if p["saldo_trienio"] < 0]
    rf.sort(key=lambda p: (p["saldo_trienio"], -p["fechamentos_trienio"]))
    print("\ntop bairros em retração (saldo trienio < 0):")
    for p in rf[:6]:
        print(f"  {p['bairro_norm'][:24]:24} saldo={p['saldo_trienio']:+d} "
              f"fech={p['fechamentos_trienio']} ab={p['aberturas_trienio']} "
              f"ativos_hoje={p['ativos_hoje']} renda_pc={p.get('renda_pc')}")
    print("saida:", OUT)


if __name__ == "__main__":
    main()
