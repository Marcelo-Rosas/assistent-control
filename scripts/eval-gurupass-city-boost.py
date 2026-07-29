"""
Eval GuruPass — baseline RPC vs soft boost meta.cidade (+0.08).
Espelha notebook + boostByCityPrimary do Edge.

Run: npx tsx --no  (use python)
  python scripts/eval-gurupass-city-boost.py
"""
from __future__ import annotations

import json
import os
import unicodedata
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional, cast

import httpx
from dotenv import load_dotenv
from supabase import create_client

ROOT = Path(__file__).resolve().parents[1]
for name in (".env.local", ".env"):
    p = ROOT / name
    if p.is_file():
        load_dotenv(p, override=True)

CITY_PRIMARY_BOOST = 0.08
SUPABASE_URL = os.getenv("SUPABASE_URL") or os.getenv("VITE_SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
GURUPASS_GROUP_ID = os.getenv("GURUPASS_GROUP_ID") or "4d1e2c40-217b-4a39-bc08-f9c3e90fd803"
OLLAMA_BASE = (
    os.getenv("OLLAMA_BASE_URL") or "https://ollama2.vectracargo.com.br"
).rstrip("/").removesuffix("/v1")
EMBED_MODEL = os.getenv("EMBEDDING_MODEL") or "mxbai-embed-large"
EMBED_DIM = int(os.getenv("EMBEDDING_DIMENSION") or "1024")
MIN_SIM = float(os.getenv("RAG_MIN_SIMILARITY") or "0.35")
TOP_K = int(os.getenv("RAG_TOP_K") or "5")

assert SUPABASE_URL and SUPABASE_KEY, "missing SUPABASE_URL / SERVICE_ROLE"
supabase = create_client(SUPABASE_URL, SUPABASE_KEY)

EVAL_DATASET = [
    {
        "id": "gp-01",
        "query": "Academia de musculação em Arujá no GuruPass a partir de quantos créditos?",
        "expected_keywords": ["Arujá", "musculação", "créditos"],
        "expected_doc": "b9f7b844-881f-49db-a895-c02d366cd96e",
        "expected_cidade": "Arujá",
    },
    {
        "id": "gp-02",
        "query": "Onde fazer musculação em São Paulo com GuruPass barato em créditos?",
        "expected_keywords": ["São Paulo", "musculação", "créditos"],
        "expected_doc": "23443b34-629e-410a-b043-b9eb7c2107f3",
        "expected_cidade": "São Paulo",
    },
    {
        "id": "gp-03",
        "query": "Academia de boxe em Osasco que aceita GuruPass",
        "expected_keywords": ["Osasco", "boxe", "GuruPass"],
        "expected_doc": "ea5dbc61-ad1c-442d-a9f5-025cc7752d2b",
        "expected_cidade": "Osasco",
    },
    {
        "id": "gp-04",
        "query": "Jiu-jitsu em Guarulhos no GuruPass quantos créditos?",
        "expected_keywords": ["Guarulhos", "jiu", "créditos"],
        "expected_doc": "24c67f72-c8e2-4975-ad39-e81b6db83502",
        "expected_cidade": "Guarulhos",
    },
    {
        "id": "gp-05",
        "query": "Musculação em Curitiba via GuruPass Studio Happiness",
        "expected_keywords": ["Curitiba", "musculação", "Happiness"],
        "expected_doc": "defd6c33-dba4-4ab5-933a-aa2d73fbd0f6",
        "expected_cidade": "Curitiba",
    },
    {
        "id": "gp-06",
        "query": "Yoga em Campinas no GuruPass",
        "expected_keywords": ["Campinas", "yoga"],
        "expected_doc": "e49a473a-32c9-4014-bdc2-433afd744930",
        "expected_cidade": "Campinas",
    },
    {
        "id": "gp-07",
        "query": "Pilates em Niterói com GuruPass",
        "expected_keywords": ["Niterói", "pilates"],
        "expected_doc": "d6bccd92-3ed5-47cc-bce4-e6d8367c25b7",
        "expected_cidade": "Niterói",
    },
    {
        "id": "gp-08",
        "query": "Musculação em Santos ou São Vicente no GuruPass",
        "expected_keywords": ["Santos", "musculação"],
        "expected_doc": "549fa757-31e6-487d-a4a1-79814d8f6076",
        "expected_cidade": "Santos",
    },
]


def _norm(s: str) -> str:
    s = (s or "").lower()
    return "".join(
        c for c in unicodedata.normalize("NFD", s) if unicodedata.category(c) != "Mn"
    )


def _parse_meta(chunk: Dict[str, Any]) -> Dict[str, Any]:
    meta = chunk.get("meta")
    if isinstance(meta, str):
        try:
            meta = json.loads(meta)
        except json.JSONDecodeError:
            meta = {}
    return meta if isinstance(meta, dict) else {}


def embed_query(text: str) -> List[float]:
    url = f"{OLLAMA_BASE}/v1/embeddings"
    with httpx.Client(timeout=60.0) as client:
        r = client.post(url, json={"model": EMBED_MODEL, "input": text[:1000]})
        r.raise_for_status()
        data = r.json()
    vec = data["data"][0]["embedding"]
    if len(vec) != EMBED_DIM:
        raise ValueError(f"dim mismatch: got {len(vec)} expected {EMBED_DIM}")
    return vec


def rpc_match(
    query: str,
    municipio: Optional[str],
    modalidade: Optional[str] = None,
) -> List[Dict[str, Any]]:
    embedding = embed_query(query)
    result = supabase.rpc(
        "match_chunks",
        {
            "query_embedding": embedding,
            "match_group_id": GURUPASS_GROUP_ID,
            "match_tenant_id": None,
            "match_modalidade": modalidade,
            "match_bairro": None,
            "match_plano_rank": None,
            "match_municipio": municipio,
            "match_k": TOP_K,
            "min_similarity": MIN_SIM,
            "match_query": query,
        },
    ).execute()
    return cast(List[Dict[str, Any]], result.data or [])


def boost_by_city_primary(
    chunks: List[Dict[str, Any]],
    target: Optional[str],
) -> List[Dict[str, Any]]:
    """Espelho TS boostByCityPrimary — soft rank, cap 1.0."""
    if not target or not str(target).strip():
        return [{**c, "_cityBoost": False} for c in chunks]
    qn = _norm(target)
    out: List[Dict[str, Any]] = []
    for c in chunks:
        meta = _parse_meta(c)
        cidade = meta.get("cidade") if isinstance(meta.get("cidade"), str) else ""
        is_primary = bool(cidade) and _norm(cidade) == qn
        base = float(c.get("score") if c.get("score") is not None else c.get("similarity") or 0)
        score = min(base + CITY_PRIMARY_BOOST, 1.0) if is_primary else base
        out.append({**c, "score": score, "_cityBoost": is_primary})
    out.sort(
        key=lambda x: (float(x.get("score") or 0), float(x.get("similarity") or 0)),
        reverse=True,
    )
    return out


def _chunk_refs(chunk: Dict[str, Any]) -> List[str]:
    refs: List[str] = []
    if chunk.get("source_ref"):
        refs.append(str(chunk["source_ref"]))
    meta = _parse_meta(chunk)
    for key in ("source_ref", "gym_id", "nome_academia"):
        val = meta.get(key)
        if val:
            refs.append(str(val))
    return refs


def check_document_match(retrieved: List[Dict[str, Any]], expected_doc: str) -> bool:
    needle = _norm(expected_doc)
    for chunk in retrieved:
        for ref in _chunk_refs(chunk):
            if needle in _norm(ref) or _norm(ref) in needle:
                return True
    return False


def check_city_match_loose(retrieved: List[Dict[str, Any]], expected: str) -> bool:
    needle = _norm(expected)
    for chunk in retrieved:
        meta = _parse_meta(chunk)
        cidade = meta.get("cidade")
        if cidade and needle in _norm(str(cidade)):
            return True
        munis = meta.get("municipios_relacionados") or []
        if isinstance(munis, list):
            for m in munis:
                if needle in _norm(str(m)):
                    return True
    return False


def primary_at_k(retrieved: List[Dict[str, Any]], expected: str, k: int = 1) -> bool:
    needle = _norm(expected)
    for chunk in retrieved[:k]:
        meta = _parse_meta(chunk)
        cidade = meta.get("cidade")
        if cidade and _norm(str(cidade)) == needle:
            return True
    return False


def keyword_hit(chunk: Dict[str, Any], keywords: List[str]) -> bool:
    blob = _norm((chunk.get("text") or "") + " " + json.dumps(_parse_meta(chunk), ensure_ascii=False))
    return any(_norm(kw) in blob for kw in keywords)


def recall_at_k(retrieved: List[Dict[str, Any]], keywords: List[str], k: int = 5) -> float:
    if not keywords:
        return 0.0
    top = retrieved[:k]
    hit = sum(1 for kw in keywords if any(keyword_hit(c, [kw]) for c in top))
    return hit / len(keywords)


def precision_at_k(retrieved: List[Dict[str, Any]], keywords: List[str], k: int = 5) -> float:
    top = retrieved[:k]
    if not top:
        return 0.0
    hit = sum(1 for c in top if keyword_hit(c, keywords))
    return hit / len(top)


def mrr(retrieved: List[Dict[str, Any]], keywords: List[str]) -> float:
    for i, c in enumerate(retrieved, 1):
        if keyword_hit(c, keywords):
            return 1.0 / i
    return 0.0


def eval_one(item: Dict[str, Any], boosted: bool) -> Dict[str, Any]:
    raw = rpc_match(item["query"], item.get("expected_cidade"))
    retrieved = boost_by_city_primary(raw, item.get("expected_cidade")) if boosted else raw
    cidade = item.get("expected_cidade") or ""
    return {
        "id": item["id"],
        "query": item["query"],
        "expected_doc": item["expected_doc"],
        "expected_cidade": cidade,
        "boosted": boosted,
        "retrieved_count": len(retrieved),
        "recall@5": recall_at_k(retrieved, item["expected_keywords"], 5),
        "precision@5": precision_at_k(retrieved, item["expected_keywords"], 5),
        "mrr": mrr(retrieved, item["expected_keywords"]),
        "document_match": check_document_match(retrieved, item["expected_doc"]),
        "city_match": check_city_match_loose(retrieved, cidade) if cidade else None,
        "primary_at_1": primary_at_k(retrieved, cidade, 1) if cidade else None,
        "primary_in_top5": primary_at_k(retrieved, cidade, 5) if cidade else None,
        "primary_boost_count": sum(1 for c in retrieved if c.get("_cityBoost")),
        "top_sims": [round(float(c.get("similarity") or 0), 3) for c in retrieved[:3]],
        "top_scores": [round(float(c.get("score") or c.get("similarity") or 0), 3) for c in retrieved[:3]],
        "chunks_preview": [
            {
                "source_ref": (_chunk_refs(c) or ["N/A"])[0],
                "cidade": _parse_meta(c).get("cidade"),
                "municipios_relacionados": (_parse_meta(c).get("municipios_relacionados") or [])[:5],
                "nome_academia": _parse_meta(c).get("nome_academia"),
                "similarity": c.get("similarity"),
                "score": c.get("score"),
                "_cityBoost": bool(c.get("_cityBoost")),
                "text": (c.get("text") or "")[:200],
            }
            for c in retrieved[:3]
        ],
    }


def aggregate(rows: List[Dict[str, Any]]) -> Dict[str, Any]:
    n = len(rows) or 1
    city = [r for r in rows if r.get("city_match") is not None]
    p1 = [r for r in rows if r.get("primary_at_1") is not None]
    p5 = [r for r in rows if r.get("primary_in_top5") is not None]
    return {
        "avg_recall@5": sum(r["recall@5"] for r in rows) / n,
        "avg_precision@5": sum(r["precision@5"] for r in rows) / n,
        "avg_mrr": sum(r["mrr"] for r in rows) / n,
        "hit_rate": sum(1 for r in rows if r["retrieved_count"] > 0) / n,
        "doc_match_rate": sum(1 for r in rows if r["document_match"]) / n,
        "city_match_rate": (sum(1 for r in city if r["city_match"]) / len(city)) if city else None,
        "primary_at_1_rate": (sum(1 for r in p1 if r["primary_at_1"]) / len(p1)) if p1 else None,
        "primary_in_top5_rate": (sum(1 for r in p5 if r["primary_in_top5"]) / len(p5)) if p5 else None,
    }


def main() -> None:
    print(f"GuruPass eval · group={GURUPASS_GROUP_ID}")
    print(f"embed={EMBED_MODEL}@{OLLAMA_BASE} dim={EMBED_DIM} boost={CITY_PRIMARY_BOOST}\n")

    baseline: List[Dict[str, Any]] = []
    boosted: List[Dict[str, Any]] = []

    for item in EVAL_DATASET:
        print(f"[{item['id']}] {item['query'][:60]}...")
        b0 = eval_one(item, boosted=False)
        b1 = eval_one(item, boosted=True)
        baseline.append(b0)
        boosted.append(b1)
        print(
            f"  baseline primary@1={b0['primary_at_1']} doc={b0['document_match']} "
            f"| boost primary@1={b1['primary_at_1']} doc={b1['document_match']} "
            f"boosted={b1['primary_boost_count']}/{b1['retrieved_count']}"
        )
        if b0["chunks_preview"] and b1["chunks_preview"]:
            t0 = b0["chunks_preview"][0].get("cidade")
            t1 = b1["chunks_preview"][0].get("cidade")
            if t0 != t1:
                print(f"  TOP1 cidade: {t0} → {t1}")

    m0 = aggregate(baseline)
    m1 = aggregate(boosted)

    print("\n=== METRICS ===")
    keys = [
        "avg_recall@5",
        "avg_precision@5",
        "avg_mrr",
        "doc_match_rate",
        "city_match_rate",
        "primary_at_1_rate",
        "primary_in_top5_rate",
    ]
    print(f"{'metric':<24} {'baseline':>10} {'boosted':>10} {'delta':>10}")
    for k in keys:
        a, b = m0.get(k), m1.get(k)
        if a is None or b is None:
            print(f"{k:<24} {str(a):>10} {str(b):>10}")
            continue
        delta = b - a
        print(f"{k:<24} {a:>10.3f} {b:>10.3f} {delta:>+10.3f}")

    out_dir = ROOT / "data" / "evaluation"
    out_dir.mkdir(parents=True, exist_ok=True)

    report = {
        "timestamp": datetime.now().isoformat(),
        "group_id": GURUPASS_GROUP_ID,
        "embed_model": EMBED_MODEL,
        "embed_dim": EMBED_DIM,
        "min_similarity": MIN_SIM,
        "top_k": TOP_K,
        "city_primary_boost": CITY_PRIMARY_BOOST,
        "baseline_metrics": m0,
        "boosted_metrics": m1,
        "delta": {
            k: (None if m0.get(k) is None or m1.get(k) is None else m1[k] - m0[k])
            for k in keys
        },
        "baseline_results": baseline,
        "boosted_results": boosted,
    }

    boost_path = out_dir / "gurupass_eval_boost_compare.json"
    with open(boost_path, "w", encoding="utf-8") as f:
        json.dump(report, f, indent=2, ensure_ascii=False)

    # Canonical results = boosted (prod path pós-C)
    canon = {
        "timestamp": report["timestamp"],
        "group_id": GURUPASS_GROUP_ID,
        "embed_model": EMBED_MODEL,
        "embed_dim": EMBED_DIM,
        "min_similarity": MIN_SIM,
        "top_k": TOP_K,
        "city_primary_boost": CITY_PRIMARY_BOOST,
        "ranking": "boostByCityPrimary",
        "metrics": {
            **m1,
            "hit_rate": m1["hit_rate"],
        },
        "baseline_metrics_for_compare": m0,
        "results": [
            {k: v for k, v in r.items() if k != "boosted"}
            for r in boosted
        ],
    }
    canon_path = out_dir / "gurupass_eval_results.json"
    with open(canon_path, "w", encoding="utf-8") as f:
        json.dump(canon, f, indent=2, ensure_ascii=False)

    print(f"\nSalvo: {boost_path}")
    print(f"Salvo: {canon_path} (ranking=boostByCityPrimary)")


if __name__ == "__main__":
    main()
