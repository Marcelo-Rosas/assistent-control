#!/usr/bin/env python3
"""
Filter Receita Federal ESTABELE for CNAE 9313100 (academias).

Reads Estabelecimentos*.zip (or extracted CSV) and writes:
  data/processed/receita-cnae-9313100.csv (+ .json)
  data/processed/receita-cnae-9313100-principal-ativos.csv (+ .json)
  data/processed/receita-cnae-9313100-principal-ativo-baixada.csv (+ .json)

Layout (no header, `;`, latin-1) — RFB Estabelecimentos dump.
"""
from __future__ import annotations

import argparse
import csv
import json
import sys
import zipfile
from pathlib import Path

import duckdb

ROOT = Path(__file__).resolve().parents[1]
PROCESSED = ROOT / "data" / "processed"
DEFAULT_RAW = ROOT / "data" / "raw" / "Receita"
DEFAULT_EXTRACT = Path("D:/receita-estab-filter")
CNAE = "9313100"

COLUMNS = [
    "cnpj_basico",
    "cnpj_ordem",
    "cnpj_dv",
    "identificador_matriz_filial",
    "nome_fantasia",
    "situacao_cadastral",
    "data_situacao_cadastral",
    "motivo_situacao_cadastral",
    "nome_cidade_exterior",
    "pais",
    "data_inicio_atividade",
    "cnae_fiscal_principal",
    "cnae_fiscal_secundaria",
    "tipo_logradouro",
    "logradouro",
    "numero",
    "complemento",
    "bairro",
    "cep",
    "uf",
    "municipio",
    "ddd_1",
    "telefone_1",
    "ddd_2",
    "telefone_2",
    "ddd_fax",
    "fax",
    "correio_eletronico",
    "situacao_especial",
    "data_situacao_especial",
]

OUT_FIELDS = [
    "cnpj",
    "cnpj_basico",
    "cnpj_ordem",
    "cnpj_dv",
    "identificador_matriz_filial",
    "nome_fantasia",
    "situacao_cadastral",
    "data_situacao_cadastral",
    "data_inicio_atividade",
    "cnae_fiscal_principal",
    "cnae_fiscal_secundaria",
    "cnae_match",
    "tipo_logradouro",
    "logradouro",
    "numero",
    "complemento",
    "bairro",
    "cep",
    "uf",
    "municipio",
    "ddd_1",
    "telefone_1",
    "ddd_2",
    "telefone_2",
    "correio_eletronico",
]


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Filter Receita ESTABELE for CNAE 9313100")
    p.add_argument("--raw-dir", type=Path, default=DEFAULT_RAW, help="Dir with zips or extracted CSV")
    p.add_argument(
        "--extract-dir",
        type=Path,
        default=DEFAULT_EXTRACT,
        help="Where to extract ESTABELE CSV (default D:/receita-estab-filter)",
    )
    p.add_argument("--zip-dir", type=Path, default=None, help="Explicit month folder with Estabelecimentos*.zip")
    p.add_argument("--smoke", action="store_true", help="Only Estabelecimentos0.zip")
    p.add_argument("--skip-extract", action="store_true", help="Use existing extracted CSV in extract-dir")
    return p.parse_args()


def find_zips(raw_dir: Path, zip_dir: Path | None, smoke: bool) -> list[Path]:
    if zip_dir:
        zips = sorted(zip_dir.glob("Estabelecimentos*.zip"))
    else:
        zips = sorted(raw_dir.rglob("Estabelecimentos*.zip"))
    if smoke:
        zips = [z for z in zips if z.name == "Estabelecimentos0.zip"]
    if not zips:
        raise SystemExit(f"Nenhum Estabelecimentos*.zip em {zip_dir or raw_dir}")
    return zips


def extract_zips(zips: list[Path], extract_dir: Path) -> list[Path]:
    extract_dir.mkdir(parents=True, exist_ok=True)
    csvs: list[Path] = []
    for zp in zips:
        with zipfile.ZipFile(zp) as zf:
            members = [m for m in zf.namelist() if "ESTABELE" in m.upper() and not m.endswith("/")]
            if not members:
                raise SystemExit(f"Sem ESTABELE dentro de {zp}")
            for member in members:
                out = extract_dir / Path(member).name
                if out.exists() and out.stat().st_size > 0:
                    print(f"SKIP extract {out.name} ({out.stat().st_size} bytes)")
                else:
                    print(f"Extract {member} -> {out}")
                    with zf.open(member) as src, out.open("wb") as dst:
                        while True:
                            chunk = src.read(8 * 1024 * 1024)
                            if not chunk:
                                break
                            dst.write(chunk)
                csvs.append(out)
    return csvs


def read_csv_sql(path: Path) -> str:
    p = path.as_posix().replace("'", "''")
    cols = ", ".join(f"'{c}': 'VARCHAR'" for c in COLUMNS)
    return f"""
    SELECT * FROM read_csv(
      '{p}',
      header=false,
      delim=';',
      quote='"',
      escape='"',
      encoding='CP1252',
      columns={{{cols}}},
      parallel=true,
      ignore_errors=true
    )
    """


def build_query(sources: list[Path]) -> str:
    parts = []
    for src in sources:
        parts.append(read_csv_sql(src).strip())
    union = "\nUNION ALL BY NAME\n".join(parts)
    return f"""
    WITH raw AS (
      {union}
    ),
    matched AS (
      SELECT
        raw.*,
        CASE
          WHEN cnae_fiscal_principal = '{CNAE}' THEN 'principal'
          ELSE 'secundario'
        END AS cnae_match
      FROM raw
      WHERE cnae_fiscal_principal = '{CNAE}'
         OR (
           cnae_fiscal_secundaria IS NOT NULL
           AND cnae_fiscal_secundaria <> ''
           AND (
             cnae_fiscal_secundaria = '{CNAE}'
             OR cnae_fiscal_secundaria LIKE '{CNAE},%'
             OR cnae_fiscal_secundaria LIKE '%,{CNAE},%'
             OR cnae_fiscal_secundaria LIKE '%,{CNAE}'
           )
         )
    ),
    shaped AS (
      SELECT
        cnpj_basico || cnpj_ordem || cnpj_dv AS cnpj,
        cnpj_basico,
        cnpj_ordem,
        cnpj_dv,
        identificador_matriz_filial,
        nome_fantasia,
        situacao_cadastral,
        data_situacao_cadastral,
        data_inicio_atividade,
        cnae_fiscal_principal,
        cnae_fiscal_secundaria,
        cnae_match,
        tipo_logradouro,
        logradouro,
        numero,
        complemento,
        bairro,
        cep,
        uf,
        municipio,
        ddd_1,
        telefone_1,
        ddd_2,
        telefone_2,
        correio_eletronico
      FROM matched
    )
    SELECT * FROM shaped
    """


def write_csv_json(rows: list[dict], stem: Path) -> None:
    stem.parent.mkdir(parents=True, exist_ok=True)
    csv_path = stem.with_suffix(".csv")
    json_path = stem.with_suffix(".json")
    with csv_path.open("w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=OUT_FIELDS)
        w.writeheader()
        for row in rows:
            w.writerow({k: row.get(k, "") for k in OUT_FIELDS})
    with json_path.open("w", encoding="utf-8") as f:
        json.dump(rows, f, ensure_ascii=False)
    print(f"Wrote {csv_path.name}: {len(rows):,} rows")
    print(f"Wrote {json_path.name}")


def main() -> None:
    args = parse_args()

    if args.skip_extract:
        sources = sorted(args.extract_dir.glob("*ESTABELE*"))
        if not sources:
            raise SystemExit(f"Nada em {args.extract_dir}")
    else:
        zips = find_zips(args.raw_dir, args.zip_dir, args.smoke)
        sources = extract_zips(zips, args.extract_dir)

    print(f"Sources: {len(sources)} file(s)")
    con = duckdb.connect()
    sql = build_query(sources)
    result = con.execute(sql)
    cols = [d[0] for d in result.description]
    all_rows = [dict(zip(cols, row)) for row in result.fetchall()]
    print(f"Matched CNAE {CNAE}: {len(all_rows):,} rows")

    write_csv_json(all_rows, PROCESSED / "receita-cnae-9313100")

    principal = [r for r in all_rows if r.get("cnae_match") == "principal"]
    principal_ativos = [r for r in principal if str(r.get("situacao_cadastral", "")).zfill(2) == "02"]
    principal_baixada = [
        r
        for r in principal
        if str(r.get("situacao_cadastral", "")).zfill(2) in ("02", "08")
    ]

    write_csv_json(
        principal_ativos,
        PROCESSED / "receita-cnae-9313100-principal-ativos",
    )
    write_csv_json(
        principal_baixada,
        PROCESSED / "receita-cnae-9313100-principal-ativo-baixada",
    )

    # quick max-date sanity
    max_inicio = max((str(r.get("data_inicio_atividade") or "") for r in principal_ativos), default="")
    max_baixa = max(
        (
            str(r.get("data_situacao_cadastral") or "")
            for r in principal_baixada
            if str(r.get("situacao_cadastral", "")).zfill(2) == "08"
        ),
        default="",
    )
    print(f"Max data_inicio_atividade (principal ativos): {max_inicio}")
    print(f"Max data_situacao_cadastral (baixados): {max_baixa}")


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        sys.exit(130)
