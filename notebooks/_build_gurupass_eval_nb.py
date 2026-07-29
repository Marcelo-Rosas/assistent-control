"""Gera notebooks/test_gurupass_rag.ipynb — eval GuruPass com match_municipio."""
from __future__ import annotations

import nbformat as nbf
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "notebooks" / "test_gurupass_rag.ipynb"


def md(source: str):
    return nbf.v4.new_markdown_cell(source.strip() + "\n")


def code(source: str):
    return nbf.v4.new_code_cell(source.strip() + "\n")


nb = nbf.v4.new_notebook()
nb.metadata["kernelspec"] = {
    "display_name": "Python 3.13 (.venv assistent-control)",
    "language": "python",
    "name": "assistent-control",
}
nb.metadata["language_info"] = {"name": "python", "version": "3.13.7"}

nb.cells = [
    md(
        """# Teste do GuruPass RAG — GymSite

**Grupo:** `4d1e2c40-217b-4a39-bc08-f9c3e90fd803` (GuruPass Brasil)
**Status:** ~5008 chunks `gym_modality` · `municipios_relacionados` preenchido
**Agent:** published

## O que este notebook testa
1. **Filtro de cidade** via `match_municipio` ↔ `meta.municipios_relacionados` (ex-`municipios_busca`)
2. **Modalidade + créditos** (musculação, yoga, boxe, jiu-jitsu, pilates)
3. **Recuperação por academia esperada** (`source_ref` / `gym_id`)
4. **Métricas** Recall@5, Precision@5, MRR, document_match, city_match

Busca = embed Ollama (`mxbai-embed-large` @ 1024) + RPC `match_chunks` (+ `match_municipio`).

## Requisitos
```bash
# use o kernel Python 3.13 (.venv assistent-control)
```

**Importante:** Kernel → Restart & Run All. Cwd costuma ser `notebooks/` — setup resolve ROOT."""
    ),
    code(
        r'''# Configuracao — rode ESTA cell antes de tudo
import os
import json
from pathlib import Path
from typing import Any, Dict, List, cast
from collections import Counter
from dotenv import load_dotenv
from supabase import create_client, Client

ROOT = Path.cwd()
if ROOT.name == "notebooks":
    ROOT = ROOT.parent

for env_name in (".env", ".env.local"):
    env_path = ROOT / env_name
    if env_path.is_file():
        load_dotenv(env_path, override=True)
        print(f"loaded {env_path}")

SUPABASE_URL = os.getenv("SUPABASE_URL") or os.getenv("VITE_SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
GURUPASS_GROUP_ID = (
    os.getenv("GURUPASS_GROUP_ID") or "4d1e2c40-217b-4a39-bc08-f9c3e90fd803"
)

OLLAMA_BASE = (
    os.getenv("OLLAMA_BASE_URL") or "https://ollama2.vectracargo.com.br"
).rstrip("/").removesuffix("/v1")
EMBED_MODEL = os.getenv("EMBEDDING_MODEL") or "mxbai-embed-large"
EMBED_DIM = int(os.getenv("EMBEDDING_DIMENSION") or "1024")
MIN_SIM = float(os.getenv("RAG_MIN_SIMILARITY") or "0.35")
TOP_K = int(os.getenv("RAG_TOP_K") or "5")

if not SUPABASE_URL or not SUPABASE_KEY:
    raise ValueError(
        f"SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY ausentes (ROOT={ROOT})"
    )

supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)
print(f"Supabase: {SUPABASE_URL}")
print(f"GuruPass group: {GURUPASS_GROUP_ID}")
print(f"Embed: {EMBED_MODEL} @ {OLLAMA_BASE} dim={EMBED_DIM} min_sim={MIN_SIM} top_k={TOP_K}")

agent = (
    supabase.table("eros_knowledge_agents")
    .select("*")
    .eq("group_id", GURUPASS_GROUP_ID)
    .execute()
)
if agent.data:
    a = cast(Dict[str, Any], agent.data[0])
    print(f"Agente: {a['name']} · status={a['status']} · chunks={a['chunk_count']}")
else:
    print("Agente nao encontrado")

types = (
    supabase.table("eros_knowledge_chunks")
    .select("chunk_type, embedding_model")
    .eq("group_id", GURUPASS_GROUP_ID)
    .execute()
)
rows = cast(List[Dict[str, Any]], types.data or [])
pending = sum(1 for r in rows if (r.get("embedding_model") or "") == "pending")
print("Tipos:", dict(Counter((r.get("chunk_type") or "?") for r in rows)))
print(f"Sample rows={len(rows)} pending={pending}")
'''
    ),
    code(
        r'''# Embeddings + match_chunks (+ match_municipio)
from typing import Any, Dict, List, Optional, cast
import httpx
import unicodedata

def _norm(s: str) -> str:
    s = (s or "").lower()
    return "".join(
        c for c in unicodedata.normalize("NFD", s) if unicodedata.category(c) != "Mn"
    )

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

def search_chunks(
    query: str,
    top_k: Optional[int] = None,
    min_similarity: Optional[float] = None,
    municipio: Optional[str] = None,
    modalidade: Optional[str] = None,
    apply_city_boost: bool = True,
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
            "match_k": top_k if top_k is not None else TOP_K,
            "min_similarity": min_similarity if min_similarity is not None else MIN_SIM,
            "match_query": query,
        },
    ).execute()
    rows = cast(List[Dict[str, Any]], result.data or [])
    if apply_city_boost and municipio:
        rows = boost_by_city_primary(rows, municipio)
    return rows

CITY_PRIMARY_BOOST = 0.08

def boost_by_city_primary(
    chunks: List[Dict[str, Any]], target: Optional[str]
) -> List[Dict[str, Any]]:
    """Espelho Edge boostByCityPrimary — soft rank meta.cidade."""
    if not target or not str(target).strip():
        return [{**c, "_cityBoost": False} for c in chunks]
    qn = _norm(target)
    out: List[Dict[str, Any]] = []
    for c in chunks:
        meta = c.get("meta") if isinstance(c.get("meta"), dict) else {}
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

print("Funcoes OK — search = embed + match_chunks + boostByCityPrimary(+0.08)")
'''
    ),
    md(
        """## Dataset de Teste — GuruPass

Queries com **cidade explícita** exercitam `match_municipio` contra `meta.municipios_relacionados`.
`expected_doc` = `gym_id` / `source_ref` da academia âncora."""
    ),
    code(
        r'''# Dataset de avaliacao — GuruPass (cidade + modalidade + créditos)
EVAL_DATASET = [
    {
        "id": "gp-01",
        "query": "Academia de musculação em Arujá no GuruPass a partir de quantos créditos?",
        "expected_keywords": ["Arujá", "musculação", "créditos"],
        "expected_doc": "b9f7b844-881f-49db-a895-c02d366cd96e",  # Studio Xtreme
        "expected_cidade": "Arujá",
    },
    {
        "id": "gp-02",
        "query": "Onde fazer musculação em São Paulo com GuruPass barato em créditos?",
        "expected_keywords": ["São Paulo", "musculação", "créditos"],
        "expected_doc": "23443b34-629e-410a-b043-b9eb7c2107f3",  # Evoque Rio Branco
        "expected_cidade": "São Paulo",
    },
    {
        "id": "gp-03",
        "query": "Academia de boxe em Osasco que aceita GuruPass",
        "expected_keywords": ["Osasco", "boxe", "GuruPass"],
        "expected_doc": "ea5dbc61-ad1c-442d-a9f5-025cc7752d2b",  # BrasCuba
        "expected_cidade": "Osasco",
    },
    {
        "id": "gp-04",
        "query": "Jiu-jitsu em Guarulhos no GuruPass quantos créditos?",
        "expected_keywords": ["Guarulhos", "jiu", "créditos"],
        "expected_doc": "24c67f72-c8e2-4975-ad39-e81b6db83502",  # Cabapuã
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
        "expected_keywords": ["Campinas", "yoga", "créditos"],
        "expected_doc": "e49a473a-32c9-4014-bdc2-433afd744930",  # Max Premium
        "expected_cidade": "Campinas",
    },
    {
        "id": "gp-07",
        "query": "Pilates em Niterói com GuruPass",
        "expected_keywords": ["Niterói", "pilates", "créditos"],
        "expected_doc": "d6bccd92-3ed5-47cc-bce4-e6d8367c25b7",
        "expected_cidade": "Niterói",
    },
    {
        "id": "gp-08",
        "query": "Musculação em Santos ou São Vicente no GuruPass",
        "expected_keywords": ["Santos", "musculação", "créditos"],
        "expected_doc": "549fa757-31e6-487d-a4a1-79814d8f6076",
        "expected_cidade": "Santos",
    },
]

print(f"Dataset de avaliacao: {len(EVAL_DATASET)} queries")
print(f"Academias esperadas: {len(set(q['expected_doc'] for q in EVAL_DATASET))}")
print(f"Cidades com city_match: {sum(1 for q in EVAL_DATASET if q.get('expected_cidade'))}")
'''
    ),
    md(
        """## Funções de avaliação

`city_match` olha `meta.cidade` **e** `meta.municipios_relacionados` (campo que a migration 20260728 usa no filtro)."""
    ),
    code(
        r'''def _parse_meta(chunk: Dict[str, Any]) -> Dict[str, Any]:
    meta = chunk.get("meta") or {}
    if isinstance(meta, str):
        try:
            meta = json.loads(meta)
        except Exception:
            meta = {}
    return meta if isinstance(meta, dict) else {}

def chunk_blob(chunk: Dict[str, Any]) -> str:
    return _norm(
        " ".join(
            [
                str(chunk.get("text") or ""),
                str(chunk.get("meta") or ""),
                str(chunk.get("source_ref") or ""),
            ]
        )
    )

def chunk_is_relevant(chunk: Dict[str, Any], expected_keywords: List[str]) -> bool:
    blob = chunk_blob(chunk)
    return any(_norm(kw) in blob for kw in expected_keywords)

def calculate_recall_at_k(retrieved, expected_keywords, k=5) -> float:
    if not expected_keywords:
        return 1.0
    blob = " ".join(chunk_blob(c) for c in retrieved[:k])
    hit = sum(1 for kw in expected_keywords if _norm(kw) in blob)
    return hit / len(expected_keywords)

def calculate_precision_at_k(retrieved, expected_keywords, k=5) -> float:
    if not retrieved[:k]:
        return 0.0
    relevant = sum(1 for c in retrieved[:k] if chunk_is_relevant(c, expected_keywords))
    return relevant / min(k, len(retrieved[:k]))

def calculate_mrr(retrieved, expected_keywords) -> float:
    for i, chunk in enumerate(retrieved):
        if chunk_is_relevant(chunk, expected_keywords):
            return 1.0 / (i + 1)
    return 0.0

def _chunk_source_refs(chunk: Dict[str, Any]) -> List[str]:
    refs: List[str] = []
    top = chunk.get("source_ref")
    if top:
        refs.append(str(top))
    meta = _parse_meta(chunk)
    for key in ("source_ref", "gym_id", "nome_academia"):
        val = meta.get(key)
        if val:
            refs.append(str(val))
    return refs

def check_document_match(retrieved: List[Dict[str, Any]], expected_doc: str) -> bool:
    needle = _norm(expected_doc)
    for chunk in retrieved:
        for ref in _chunk_source_refs(chunk):
            if needle in _norm(ref) or _norm(ref) in needle:
                return True
    return False

def check_city_match(
    retrieved: List[Dict[str, Any]], expected_cidade: Optional[str]
) -> Optional[bool]:
    if not expected_cidade:
        return None
    needle = _norm(expected_cidade)
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
        if needle in chunk_blob(chunk):
            return True
    return False

def evaluate_query(
    query: str,
    expected_keywords: List[str],
    expected_doc: str,
    expected_cidade: Optional[str] = None,
    top_k: Optional[int] = None,
    min_similarity: Optional[float] = None,
) -> Dict[str, Any]:
    retrieved = search_chunks(
        query,
        top_k=top_k,
        min_similarity=min_similarity,
        municipio=expected_cidade,
    )
    city = check_city_match(retrieved, expected_cidade)
    return {
        "query": query,
        "expected_doc": expected_doc,
        "expected_cidade": expected_cidade,
        "retrieved_count": len(retrieved),
        "recall@5": calculate_recall_at_k(retrieved, expected_keywords, k=5),
        "precision@5": calculate_precision_at_k(retrieved, expected_keywords, k=5),
        "mrr": calculate_mrr(retrieved, expected_keywords),
        "document_match": check_document_match(retrieved, expected_doc),
        "city_match": city,
        "top_sims": [round(float(c.get("similarity") or 0), 3) for c in retrieved[:3]],
        "chunks": retrieved[:3],
    }

print("Funcoes de avaliacao OK")
'''
    ),
    md(
        """## Smoke — filtro cidade

Compara a mesma query **com** e **sem** `match_municipio=Arujá`."""
    ),
    code(
        r'''# Smoke: match_municipio liga/desliga
q = "musculação GuruPass créditos"
plain = search_chunks(q, municipio=None)
filtered = search_chunks(q, municipio="Arujá")

def _cities(chunks):
    out = []
    for c in chunks[:5]:
        m = _parse_meta(c)
        out.append({
            "cidade": m.get("cidade"),
            "mun": (m.get("municipios_relacionados") or [])[:3],
            "nome": m.get("nome_academia"),
            "sim": round(float(c.get("similarity") or 0), 3),
        })
    return out

print("SEM municipio:")
for row in _cities(plain):
    print(" ", row)
print("\nCOM match_municipio=Arujá:")
for row in _cities(filtered):
    print(" ", row)
'''
    ),
    md(
        """## Executar Avaliação

Para cada query: embed → `match_chunks` com `match_municipio=expected_cidade` → métricas."""
    ),
    code(
        r'''# Executar avaliacao completa
results = []

print("Executando avaliacao GuruPass (vector + match_municipio)...\n")
print("=" * 80)

for eval_item in EVAL_DATASET:
    print(f"\n[{eval_item['id']}] {eval_item['query']}")
    print(f"   Esperado: {eval_item['expected_doc']} · cidade={eval_item.get('expected_cidade')}")
    print(f"   Keywords: {eval_item['expected_keywords']}")

    result = evaluate_query(
        query=eval_item["query"],
        expected_keywords=eval_item["expected_keywords"],
        expected_doc=eval_item["expected_doc"],
        expected_cidade=eval_item.get("expected_cidade"),
        top_k=TOP_K,
        min_similarity=MIN_SIM,
    )
    result["id"] = eval_item["id"]
    results.append(result)

    city_s = (
        "N/A" if result["city_match"] is None else ("YES" if result["city_match"] else "NO")
    )
    print(f"   Recuperados: {result['retrieved_count']} chunks sims={result['top_sims']}")
    print(f"   Recall@5: {result['recall@5']:.2f}")
    print(f"   Precision@5: {result['precision@5']:.2f}")
    print(f"   MRR: {result['mrr']:.2f}")
    print(f"   document_match: {'YES' if result['document_match'] else 'NO'}")
    print(f"   city_match: {city_s}")

    if result["chunks"]:
        first = result["chunks"][0]
        refs = _chunk_source_refs(first)
        meta = _parse_meta(first)
        preview = (first.get("text") or "")[:120].replace("\n", " ")
        print(f"   Primeiro: {refs[0] if refs else 'N/A'} · cidade={meta.get('cidade')}")
        print(f"   Preview: {preview}...")

print("\n" + "=" * 80)
'''
    ),
    md("""## Relatório de Avaliação"""),
    code(
        r'''if not results:
    raise RuntimeError("results vazio — rode a cell de avaliacao antes")

avg_recall = sum(r["recall@5"] for r in results) / len(results)
avg_precision = sum(r["precision@5"] for r in results) / len(results)
avg_mrr = sum(r["mrr"] for r in results) / len(results)
doc_match_rate = sum(1 for r in results if r["document_match"]) / len(results)
city_scored = [r for r in results if r["city_match"] is not None]
city_match_rate = (
    sum(1 for r in city_scored if r["city_match"]) / len(city_scored)
    if city_scored
    else None
)

print("Relatorio de Avaliacao — GuruPass")
print("=" * 50)
print(f"Total de queries: {len(results)}")
print(f"Recall@5 medio: {avg_recall:.2f}")
print(f"Precision@5 medio: {avg_precision:.2f}")
print(f"MRR medio: {avg_mrr:.2f}")
print(f"Taxa document_match: {doc_match_rate:.0%}")
if city_match_rate is not None:
    print(f"Taxa city_match: {city_match_rate:.0%} ({len(city_scored)} queries)")
print("=" * 50)

print("\nQueries com Recall@5 < 0.5:")
low_recall = [r for r in results if r["recall@5"] < 0.5]
if low_recall:
    for r in low_recall:
        print(f"  - {r['query'][:60]}...: Recall@5={r['recall@5']:.2f}")
else:
    print("  Nenhuma")

print("\nQueries sem academia esperada:")
no_doc = [r for r in results if not r["document_match"]]
if no_doc:
    for r in no_doc:
        print(f"  - {r['query'][:60]}...: esperado {r['expected_doc']}")
else:
    print("  Todas as academias esperadas foram recuperadas")

print("\nQueries sem cidade esperada:")
no_city = [r for r in city_scored if not r["city_match"]]
if no_city:
    for r in no_city:
        print(f"  - {r['query'][:60]}...: esperado {r['expected_cidade']}")
elif city_scored:
    print("  Todas as cidades esperadas foram recuperadas")
else:
    print("  N/A")
'''
    ),
    md("""## Análise por cidade / academia"""),
    code(
        r'''doc_counts: Dict[str, int] = {}
city_counts: Dict[str, int] = {}
for r in results:
    for chunk in r["chunks"]:
        refs = _chunk_source_refs(chunk)
        key = refs[0] if refs else "N/A"
        doc_counts[key] = doc_counts.get(key, 0) + 1
        meta = _parse_meta(chunk)
        cidade = meta.get("cidade")
        if cidade:
            city_counts[str(cidade)] = city_counts.get(str(cidade), 0) + 1

print("Academias recuperadas (top 8):")
for doc, count in sorted(doc_counts.items(), key=lambda x: x[1], reverse=True)[:8]:
    print(f"  {doc}: {count} vezes")

print("\nCidades recuperadas (meta.cidade):")
for cidade, count in sorted(city_counts.items(), key=lambda x: x[1], reverse=True):
    print(f"  {cidade}: {count} vezes")

print("\nDistribuicao por academia esperada:")
for doc in sorted(set(r["expected_doc"] for r in results)):
    qs = [r for r in results if r["expected_doc"] == doc]
    avg_r = sum(r["recall@5"] for r in qs) / len(qs)
    match_rate = sum(1 for r in qs if r["document_match"]) / len(qs)
    print(
        f"  {doc}: {len(qs)} queries · "
        f"Recall@5={avg_r:.2f} · doc_match={match_rate:.0%}"
    )
'''
    ),
    md("""## Salvar Resultados

Salva em `data/evaluation/gurupass_eval_results.json`."""),
    code(
        r'''from datetime import datetime

output_path = ROOT / "data" / "evaluation" / "gurupass_eval_results.json"
output_path.parent.mkdir(parents=True, exist_ok=True)

serializable_results = []
for r in results:
    row = {k: v for k, v in r.items() if k != "chunks"}
    row["chunks_preview"] = [
        {
            "source_ref": (_chunk_source_refs(c) or ["N/A"])[0],
            "cidade": _parse_meta(c).get("cidade"),
            "municipios_relacionados": (_parse_meta(c).get("municipios_relacionados") or [])[:5],
            "nome_academia": _parse_meta(c).get("nome_academia"),
            "similarity": c.get("similarity"),
            "text": (c.get("text") or "")[:240],
        }
        for c in r.get("chunks") or []
    ]
    serializable_results.append(row)

eval_report = {
    "timestamp": datetime.now().isoformat(),
    "group_id": GURUPASS_GROUP_ID,
    "embed_model": EMBED_MODEL,
    "embed_dim": EMBED_DIM,
    "min_similarity": MIN_SIM,
    "top_k": TOP_K,
    "metrics": {
        "avg_recall@5": avg_recall,
        "avg_precision@5": avg_precision,
        "avg_mrr": avg_mrr,
        "doc_match_rate": doc_match_rate,
        "city_match_rate": city_match_rate,
    },
    "results": serializable_results,
}

with open(output_path, "w", encoding="utf-8") as f:
    json.dump(eval_report, f, indent=2, ensure_ascii=False)

print(f"Resultados salvos em: {output_path}")
'''
    ),
    md(
        """##### Conclusão

Grupo GuruPass: **~5008** chunks com `municipios_relacionados`.
Eval foca `city_match` — prova que `match_municipio` casa com o scrape enriquecido.
Rode **Restart & Run All** e confira `data/evaluation/gurupass_eval_results.json`."""
    ),
]

OUT.parent.mkdir(parents=True, exist_ok=True)
nbf.write(nb, OUT)
print(f"Wrote {OUT}")
