"""
Passo 2 do ecossistema temporal — CAGED (emprego formal) por município/mês.
Piloto SP. Fonte: Base dos Dados (BigQuery) br_me_caged. Agregado em-SQL
(saldo municipal/mês) -> resultado minúsculo; scan controlado por dry-run.

Disciplina: estima_bytes (dry-run GRÁTIS) ANTES de rodar; só executa se custo
trivial e abaixo do cap. Determinístico, auditável (fonte + ref).
"""
from __future__ import annotations

import os
import re
import sys

GYM = r"C:\Users\marce\gymsite"


def load_env():
    env = open(rf"{GYM}\.env", encoding="utf-8").read()
    for k in ("GOOGLE_APPLICATION_CREDENTIALS", "GOOGLE_CLOUD_PROJECT", "BQ_BILLING_PROJECT"):
        m = re.search(rf"^{k}=(.*)$", env, re.M)
        if m:
            os.environ[k] = m.group(1).strip().strip('"').strip("'")
    # path de credencial relativo no .env -> resolve contra a raiz do gymsite
    cred = os.environ.get("GOOGLE_APPLICATION_CREDENTIALS", "")
    if cred and not os.path.isabs(cred):
        os.environ["GOOGLE_APPLICATION_CREDENTIALS"] = os.path.normpath(os.path.join(GYM, cred))


SQL_SP = """
SELECT ano, mes, sigla_uf, id_municipio,
       SUM(saldo_movimentacao) AS saldo,
       COUNT(*) AS n_movimentacoes
FROM `basedosdados.br_me_caged.microdados_movimentacao`
WHERE ano >= 2023 AND sigla_uf = 'SP'
GROUP BY ano, mes, sigla_uf, id_municipio
"""


def main():
    load_env()
    sys.path.insert(0, GYM)
    from tools.basedosdados_loader import estimar_bytes, run_query

    print("billing project:", os.environ.get("GOOGLE_CLOUD_PROJECT"))
    try:
        b = estimar_bytes(SQL_SP)
    except Exception as exc:
        print(f"DRY-RUN falhou: {type(exc).__name__}: {exc}")
        print("(provável: nome de tabela/coluna do BD mudou — ajustar SQL)")
        return
    gb = b / 1024**3
    custo = b / 1024**4 * 5.0  # ~US$5/TB
    print(f"DRY-RUN: scan estimado = {gb:.2f} GB  (~US$ {custo:.4f})")

    LIMIT_GB = 3.0
    if gb > LIMIT_GB:
        print(f"ABORTADO: scan {gb:.2f} GB > limite {LIMIT_GB} GB. "
              f"Reportar custo ao usuário antes de rodar.")
        return

    print("custo trivial -> executando...")
    rows = run_query(SQL_SP)
    rows = list(rows) if not isinstance(rows, list) else rows
    import json
    out = r"C:\Users\marce\assistent-control\data\processed\caged-sp-municipio-mes.json"
    meta = {
        "fonte": "Base dos Dados BigQuery — basedosdados.br_me_caged.microdados_movimentacao",
        "piloto": "SP", "janela": "ano >= 2023",
        "agregacao": "SUM(saldo_movimentacao) por (ano, mes, id_municipio)",
        "gerado_por": "build_caged_sp.py",
    }
    json.dump({"_meta": meta, "rows": rows}, open(out, "w", encoding="utf-8"), ensure_ascii=False)
    munis = {r["id_municipio"] for r in rows}
    meses = {(r["ano"], r["mes"]) for r in rows}
    saldo = sum(int(r["saldo"]) for r in rows if r.get("saldo") is not None)
    print(f"linhas: {len(rows)}  municipios: {len(munis)}  meses: {len(meses)}")
    print("saldo total SP (2023+):", saldo)
    print("saida:", out)


if __name__ == "__main__":
    main()
