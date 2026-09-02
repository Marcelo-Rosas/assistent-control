"""Receita CNAE wellness — segment match, dedup, tags (Python mirror of receitaWellnessFilter.ts)."""
from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[2]
DEFAULT_CONFIG = ROOT / "data" / "config" / "receita-cnae-segments.json"


def load_config(path: Path | None = None) -> dict[str, Any]:
    p = path or DEFAULT_CONFIG
    return json.loads(p.read_text(encoding="utf-8"))


def cnae_in_secondary(cnae: str, secundaria: str | None) -> bool:
    if not secundaria or not str(secundaria).strip():
        return False
    return cnae in [p.strip() for p in str(secundaria).split(",")]


def row_has_cnae(row: dict[str, Any], cnae: str) -> tuple[bool, str | None]:
    if str(row.get("cnae_fiscal_principal") or "") == cnae:
        return True, "principal"
    if cnae_in_secondary(cnae, row.get("cnae_fiscal_secundaria")):
        return True, "secundario"
    return False, None


def find_segment_hits(row: dict[str, Any], segments: list[dict[str, str]]) -> list[dict[str, Any]]:
    hits: list[dict[str, Any]] = []
    for i, seg in enumerate(segments):
        ok, match = row_has_cnae(row, seg["cnae"])
        if ok and match:
            hits.append({"order": i, "segment": seg, "match": match})
    return hits


def pick_winning_hit(hits: list[dict[str, Any]]) -> dict[str, Any] | None:
    if not hits:
        return None
    principals = [h for h in hits if h["match"] == "principal"]
    pool = principals if principals else hits
    return min(pool, key=lambda h: h["order"])


def apply_tag_rules(row: dict[str, Any], rules: list[dict[str, Any]]) -> list[str]:
    tags: set[str] = set()
    nome = str(row.get("nome_fantasia") or "")

    for rule in rules:
        if rule.get("match") == "nome_fantasia":
            pat = rule["pattern"].replace("(?i)", "", 1) if rule["pattern"].startswith("(?i)") else rule["pattern"]
            if re.search(pat, nome, re.IGNORECASE):
                tags.add(rule["id"])
        elif rule.get("match") == "cnae":
            ok, _ = row_has_cnae(row, rule["cnae"])
            if ok:
                tags.add(rule["id"])

    return sorted(tags)


def enrich_row(row: dict[str, Any], config: dict[str, Any]) -> dict[str, Any] | None:
    segments = config.get("segments") or []
    hits = find_segment_hits(row, segments)
    winner = pick_winning_hit(hits)
    if not winner:
        return None

    seg = winner["segment"]
    enriched = dict(row)
    enriched["cnae_match"] = winner["match"]
    enriched["cnae_segment"] = seg["id"]
    enriched["cnae_fiscal_matched"] = seg["cnae"]
    enriched["cnae_tags"] = apply_tag_rules(row, config.get("tags") or [])
    return enriched


def dedupe_rows(rows: list[dict[str, Any]], config: dict[str, Any]) -> list[dict[str, Any]]:
    by_cnpj: dict[str, dict[str, Any]] = {}
    segments = config.get("segments") or []

    for row in rows:
        cnpj = row.get("cnpj")
        if not cnpj:
            continue
        enriched = enrich_row(row, config)
        if not enriched:
            continue

        prev = by_cnpj.get(cnpj)
        if not prev:
            by_cnpj[cnpj] = enriched
            continue

        prev_w = pick_winning_hit(find_segment_hits(prev, segments))
        next_w = pick_winning_hit(find_segment_hits(row, segments))
        if not prev_w or not next_w:
            continue

        prev_score = 0 if prev_w["match"] == "principal" else 1
        next_score = 0 if next_w["match"] == "principal" else 1
        if next_score < prev_score or (
            next_score == prev_score and next_w["order"] < prev_w["order"]
        ):
            by_cnpj[cnpj] = enriched

    return list(by_cnpj.values())


def count_by_segment(rows: list[dict[str, Any]]) -> dict[str, int]:
    counts: dict[str, int] = {}
    for row in rows:
        seg = row.get("cnae_segment") or "?"
        counts[seg] = counts.get(seg, 0) + 1
    return counts
