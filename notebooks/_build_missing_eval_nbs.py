"""Build eval notebooks for domains without dedicated RAG eval."""
from __future__ import annotations

import nbformat as nbf
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT_DIR = ROOT / "notebooks"


def md(source: str):
    return nbf.v4.new_markdown_cell(source.strip() + "\n")


def code(source: str):
    return nbf.v4.new_code_cell(source.strip() + "\n")


SETUP_TEMPLATE = r'''
# Configuracao — rode ESTA cell antes de tudo
import os
import json
from pathlib import Path
from typing import Any, Dict, List, cast
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
GROUP_ID = (
    os.getenv("__ENV_VAR__") or "__FALLBACK_UUID__"
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
print(f"__LABEL__ group: {GROUP_ID}")
print(f"Embed: {EMBED_MODEL} @ {OLLAMA_BASE} dim={EMBED_DIM} min_sim={MIN_SIM} top_k={TOP_K}")

agent = (
    supabase.table("eros_knowledge_agents")
    .select("*")
    .eq("group_id", GROUP_ID)
    .execute()
)
if agent.data:
    a = cast(Dict[str, Any], agent.data[0])
    print(f"Agente: {a['name']} · status={a['status']} · chunks={a['chunk_count']}")
else:
    print("Agente nao encontrado")

# Inventario de chunks no grupo
rows = (
    supabase.table("eros_knowledge_chunks")
    .select("chunk_type, source_ref, embedding_model")
    .eq("group_id", GROUP_ID)
    .execute()
)
from collections import Counter
raw_rows = cast(List[Dict[str, Any]], rows.data or [])
types = Counter((r.get("chunk_type") or "?") for r in raw_rows)
pending = sum(1 for r in raw_rows if (r.get("embedding_model") or "") == "pending")
print(f"Chunks: {len(raw_rows)} · pending={pending} · tipos={dict(types)}")
'''

SEARCH_CELL = r'''
# Embeddings (mxbai-embed-large @ 1024) + match_chunks
from typing import Any, Dict, List, Optional, cast
import httpx
import unicodedata

def _norm(s: str) -> str:
    s = (s or "").lower()
    return "".join(
        c for c in unicodedata.normalize("NFD", s) if unicodedata.category(c) != "Mn"
    )

def embed_query(text: str) -> List[float]:
    # OpenAI-compat embeddings via Ollama — mesmo modelo do ingest
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
) -> List[Dict[str, Any]]:
    embedding = embed_query(query)
    result = supabase.rpc(
        "match_chunks",
        {
            "query_embedding": embedding,
            "match_group_id": GROUP_ID,
            "match_tenant_id": None,
            "match_modalidade": None,
            "match_bairro": None,
            "match_plano_rank": None,
            "match_municipio": None,
            "match_k": top_k if top_k is not None else TOP_K,
            "min_similarity": min_similarity if min_similarity is not None else MIN_SIM,
            "match_query": query,
        },
    ).execute()
    return cast(List[Dict[str, Any]], result.data or [])

print("Funcoes OK — search = embed(Ollama mxbai) + match_chunks hybrid (vector+FTS)")
'''

EVAL_FUNCS = r'''
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
    meta = chunk.get("meta") or {}
    if isinstance(meta, str):
        try:
            meta = json.loads(meta)
        except Exception:
            meta = {}
    if isinstance(meta, dict):
        for key in ("source_ref", "document_name", "article"):
            val = meta.get(key)
            if val:
                refs.append(str(val))
    return refs

def check_document_match(retrieved: List[Dict[str, Any]], expected_doc: str) -> bool:
    needle = _norm(expected_doc)
    for chunk in retrieved:
        for ref in _chunk_source_refs(chunk):
            if needle in _norm(ref):
                return True
    return False

def evaluate_query(
    query: str,
    expected_keywords: List[str],
    expected_doc: str,
    top_k: Optional[int] = None,
    min_similarity: Optional[float] = None,
) -> Dict[str, Any]:
    retrieved = search_chunks(query, top_k=top_k, min_similarity=min_similarity)
    return {
        "query": query,
        "expected_doc": expected_doc,
        "retrieved_count": len(retrieved),
        "recall@5": calculate_recall_at_k(retrieved, expected_keywords, k=5),
        "precision@5": calculate_precision_at_k(retrieved, expected_keywords, k=5),
        "mrr": calculate_mrr(retrieved, expected_keywords),
        "document_match": check_document_match(retrieved, expected_doc),
        "top_sims": [round(float(c.get("similarity") or 0), 3) for c in retrieved[:3]],
        "chunks": retrieved[:3],
    }

print("Funcoes de avaliacao OK")
'''

RUN_EVAL = r'''
# Executar avaliacao
results = []

print("Executando avaliacao (vector match_chunks)...\n")
print("=" * 80)

for eval_item in EVAL_DATASET:
    print(f"\n[{eval_item['id']}] {eval_item['query']}")
    print(f"   Esperado: {eval_item['expected_doc']}")
    print(f"   Keywords: {eval_item['expected_keywords']}")

    result = evaluate_query(
        query=eval_item["query"],
        expected_keywords=eval_item["expected_keywords"],
        expected_doc=eval_item["expected_doc"],
        top_k=TOP_K,
        min_similarity=MIN_SIM,
    )
    result["id"] = eval_item["id"]
    results.append(result)

    print(f"   Recuperados: {result['retrieved_count']} chunks sims={result['top_sims']}")
    print(f"   Recall@5: {result['recall@5']:.2f}")
    print(f"   Precision@5: {result['precision@5']:.2f}")
    print(f"   MRR: {result['mrr']:.2f}")
    print(f"   document_match: {'YES' if result['document_match'] else 'NO'}")

    if result["chunks"]:
        first = result["chunks"][0]
        refs = _chunk_source_refs(first)
        preview = (first.get("text") or "")[:120].replace("\n", " ")
        print(f"   Primeiro: {refs[0] if refs else 'N/A'}")
        print(f"   Preview: {preview}...")

print("\n" + "=" * 80)
'''

REPORT = r'''
if not results:
    raise RuntimeError("results vazio — rode a cell de avaliacao antes")

avg_recall = sum(r["recall@5"] for r in results) / len(results)
avg_precision = sum(r["precision@5"] for r in results) / len(results)
avg_mrr = sum(r["mrr"] for r in results) / len(results)
doc_match_rate = sum(1 for r in results if r["document_match"]) / len(results)

print("Relatorio de Avaliacao")
print("=" * 50)
print(f"Total de queries: {len(results)}")
print(f"Recall@5 medio: {avg_recall:.2f}")
print(f"Precision@5 medio: {avg_precision:.2f}")
print(f"MRR medio: {avg_mrr:.2f}")
print(f"Taxa document_match: {doc_match_rate:.0%}")
print("=" * 50)

print("\nQueries com Recall@5 < 0.5:")
low_recall = [r for r in results if r["recall@5"] < 0.5]
if low_recall:
    for r in low_recall:
        print(f"  - {r['query'][:60]}...: Recall@5={r['recall@5']:.2f}")
else:
    print("  Nenhuma")

print("\nQueries sem documento esperado:")
no_doc_match = [r for r in results if not r["document_match"]]
if no_doc_match:
    for r in no_doc_match:
        print(f"  - {r['query'][:60]}...: esperado {r['expected_doc']}")
else:
    print("  Todos os documentos esperados foram recuperados")
'''

BY_DOC = r'''
# Contar quantas vezes cada documento foi recuperado
doc_counts: Dict[str, int] = {}
for r in results:
    for chunk in r["chunks"]:
        refs = _chunk_source_refs(chunk)
        key = refs[0] if refs else "N/A"
        doc_counts[key] = doc_counts.get(key, 0) + 1

print("Documentos recuperados (top 8):")
sorted_docs = sorted(doc_counts.items(), key=lambda x: x[1], reverse=True)
for doc, count in sorted_docs[:8]:
    print(f"  {doc}: {count} vezes")

print("\nDistribuicao por documento esperado:")
for doc in sorted(set(r["expected_doc"] for r in results)):
    queries_for_doc = [r for r in results if r["expected_doc"] == doc]
    avg_r = sum(r["recall@5"] for r in queries_for_doc) / len(queries_for_doc)
    match_rate = sum(1 for r in queries_for_doc if r["document_match"]) / len(queries_for_doc)
    print(
        f"  {doc}: {len(queries_for_doc)} queries · "
        f"Recall@5={avg_r:.2f} · doc_match={match_rate:.0%}"
    )
'''

SAVE_TEMPLATE = r'''
from datetime import datetime

output_path = ROOT / "data" / "evaluation" / "__OUT_NAME__"
output_path.parent.mkdir(parents=True, exist_ok=True)

serializable_results = []
for r in results:
    row = {k: v for k, v in r.items() if k != "chunks"}
    row["chunks_preview"] = [
        {
            "source_ref": (_chunk_source_refs(c) or ["N/A"])[0],
            "similarity": c.get("similarity"),
            "text": (c.get("text") or "")[:240],
        }
        for c in r.get("chunks") or []
    ]
    serializable_results.append(row)

eval_report = {
    "timestamp": datetime.now().isoformat(),
    "group_id": GROUP_ID,
    "domain": "__DOMAIN__",
    "embed_model": EMBED_MODEL,
    "embed_dim": EMBED_DIM,
    "min_similarity": MIN_SIM,
    "top_k": TOP_K,
    "metrics": {
        "avg_recall@5": avg_recall,
        "avg_precision@5": avg_precision,
        "avg_mrr": avg_mrr,
        "doc_match_rate": doc_match_rate,
    },
    "results": serializable_results,
}

with open(output_path, "w", encoding="utf-8") as f:
    json.dump(eval_report, f, indent=2, ensure_ascii=False)

print(f"Resultados salvos em: {output_path}")
'''


def build_notebook(
    *,
    title_md: str,
    env_var: str,
    fallback_uuid: str,
    label: str,
    dataset_intro_md: str,
    dataset_code: str,
    out_name: str,
    domain: str,
    conclusion_md: str,
    filename: str,
) -> Path:
    nb = nbf.v4.new_notebook()
    setup = (
        SETUP_TEMPLATE.replace("__ENV_VAR__", env_var)
        .replace("__FALLBACK_UUID__", fallback_uuid)
        .replace("__LABEL__", label)
    )
    save = SAVE_TEMPLATE.replace("__OUT_NAME__", out_name).replace("__DOMAIN__", domain)

    nb.cells = [
        md(title_md),
        code(setup),
        code(SEARCH_CELL),
        md(dataset_intro_md),
        code(dataset_code),
        md(
            "## Executar Avaliação\n\n"
            "Para cada query:\n"
            "1. Buscar chunks (`mxbai-embed-large` + `match_chunks`)\n"
            "2. Keywords (Recall@K / Precision@K / MRR)\n"
            "3. Documento esperado (`document_match`)\n"
        ),
        code(EVAL_FUNCS),
        code(RUN_EVAL),
        md("## Relatório de Avaliação\n\nMétricas agregadas de todas as queries.\n"),
        code(REPORT),
        md("## Análise Detalhada por Documento\n\nVerificar quais documentos foram mais recuperados.\n"),
        code(BY_DOC),
        md(f"## Salvar Resultados\n\nSalva em `data/evaluation/{out_name}`.\n"),
        code(save),
        md(conclusion_md),
    ]
    nb.metadata = {
        "kernelspec": {
            "display_name": "Python 3 (ipykernel)",
            "language": "python",
            "name": "python3",
        },
        "language_info": {"name": "python"},
    }
    out = OUT_DIR / filename
    nbf.write(nb, out)
    return out


def main() -> None:
    eng = build_notebook(
        title_md="""
# Teste do Engenharia RAG — GymSite

**Grupo:** `f087bfc8-ad2b-434c-bc18-a38608be183d` (Engenharia de Obra)
**Status:** 33 chunks · 4 documentos · published
**Pasta:** `data/raw/engenheiro/`

## Documentos Ingeridos
| Documento | Tema | Conteúdo Principal |
|-----------|------|--------------------|
| engenharia_climatizacao_academia_ref.txt | climatizacao | NBR 16401, PMOC, vazão, carga térmica |
| engenharia_dimensionamento_academia_ref.txt | dimensionamento | densidades, cardio/musculação, MEP |
| engenharia_layout_academia_ref.txt | layout | ANVISA 0,80 m, footprints, circulação |
| engenharia_obra_academia_ref.txt | obra | ART/RRT, AVCB, NBR 6120, licenças |

## O que este notebook testa
1. HVAC / climatização (vazão, split sem renovação)
2. Dimensionamento (densidade, carga de laje)
3. Layout (distância entre aparelhos)
4. Obra / licenciamento (ART, AVCB)

Busca = embed Ollama (`mxbai-embed-large` @ 1024) + RPC `match_chunks`.

## Requisitos
```bash
pip install supabase python-dotenv openai httpx
```

**Importante:** rode as cells em ordem (Kernel → Restart & Run All).
""",
        env_var="ENGENHEIRO_GROUP_ID",
        fallback_uuid="f087bfc8-ad2b-434c-bc18-a38608be183d",
        label="Engenheiro",
        dataset_intro_md="""
## Dataset de Teste — Engenharia de Obra

Queries alinhadas aos 4 refs em `data/raw/engenheiro/`.
""",
        dataset_code=r'''
# Dataset de avaliacao — Engenharia de Obra
EVAL_DATASET = [
    {
        "id": "eng-01",
        "query": "Qual a vazão mínima de ar exterior para sala coletiva de 100 m² pela NBR 16401?",
        "expected_keywords": ["16401", "vazão", "l/s", "pessoa"],
        "expected_doc": "engenharia_climatizacao_academia_ref.txt",
    },
    {
        "id": "eng-02",
        "query": "Split high wall sem renovação de ar é conformidade na academia?",
        "expected_keywords": ["split", "renovação", "não conformidade", "16401"],
        "expected_doc": "engenharia_climatizacao_academia_ref.txt",
    },
    {
        "id": "eng-03",
        "query": "Qual a densidade de projeto em m² por aluno para sala coletiva?",
        "expected_keywords": ["3,5", "m²", "coletiva", "aluno"],
        "expected_doc": "engenharia_dimensionamento_academia_ref.txt",
    },
    {
        "id": "eng-04",
        "query": "Qual a carga dinâmica de laje recomendada para zona de peso livre?",
        "expected_keywords": ["6120", "laje", "kgf", "500"],
        "expected_doc": "engenharia_dimensionamento_academia_ref.txt",
    },
    {
        "id": "eng-05",
        "query": "Qual a distância mínima entre aparelhos de musculação segundo ANVISA?",
        "expected_keywords": ["0,80", "ANVISA", "musculação", "distância"],
        "expected_doc": "engenharia_layout_academia_ref.txt",
    },
    {
        "id": "eng-06",
        "query": "Quanto de área de planejamento por esteira incluindo zona de escape?",
        "expected_keywords": ["esteira", "4", "m²", "escape"],
        "expected_doc": "engenharia_layout_academia_ref.txt",
    },
    {
        "id": "eng-07",
        "query": "Quando a obra de academia exige ART e laudo estrutural em reforma?",
        "expected_keywords": ["ART", "16280", "reforma", "estrutural"],
        "expected_doc": "engenharia_obra_academia_ref.txt",
    },
    {
        "id": "eng-08",
        "query": "O que é AVCB e quando a academia precisa do Corpo de Bombeiros?",
        "expected_keywords": ["AVCB", "bombeiros", "PPCI", "incêndio"],
        "expected_doc": "engenharia_obra_academia_ref.txt",
    },
]

print(f"Dataset de avaliacao: {len(EVAL_DATASET)} queries")
print(f"Documentos esperados: {len(set(q['expected_doc'] for q in EVAL_DATASET))}")
''',
        out_name="engenheiro_eval_results.json",
        domain="engenheiro",
        conclusion_md="""
## Conclusão

Engenharia RAG: **33 chunks** em 4 refs (`data/raw/engenheiro/`).

Se métricas baixas:
1. Ajustar keywords do dataset ao texto real dos chunks
2. Revisar chunking (`CHUNK_SIZE` / overlap)
3. Checar `RAG_MIN_SIMILARITY`
4. Re-rodar `npm run ingest:engenheiro` + `npm run embed:engenheiro`
""",
        filename="test_engenheiro_rag.ipynb",
    )

    lei = build_notebook(
        title_md="""
# Teste do Regulatório Lei RAG — GymSite

**Grupo:** `b7dad505-2d2a-49a9-bbaf-d4b9c4929dea` (Regulatório CONFEF/CREF)
**Foco:** chunks `legal_article` (Lei 9.696/1998) — distinto do eval de taxas

Fonte ingerida: `data/raw/L9696.html` (via `npm run ingest:law-9696`).
Texto espelho: `data/raw/Regulatorio/regulatorio_lei_base.txt` (ainda sem ingest próprio).

## O que este notebook testa
1. Prerrogativa profissional (Art. 1º)
2. Inscrição / registro no CREF (Art. 2º)
3. Competências do profissional (Art. 3º)
4. Criação Confef/Crefs (Art. 4º)
5. Competências Confef (Art. 5º-A)

Busca = embed Ollama (`mxbai-embed-large` @ 1024) + RPC `match_chunks`.

## Requisitos
```bash
pip install supabase python-dotenv openai httpx
```

**Importante:** rode as cells em ordem (Kernel → Restart & Run All).
""",
        env_var="REGULATORIO_GROUP_ID",
        fallback_uuid="b7dad505-2d2a-49a9-bbaf-d4b9c4929dea",
        label="Regulatorio",
        dataset_intro_md="""
## Dataset de Teste — Lei 9.696/1998

Queries focadas em artigos legais (não taxas municipais).
`expected_doc` aponta para `L9696` / rótulo do artigo no meta.
""",
        dataset_code=r'''
# Dataset de avaliacao — Lei 9.696/1998 (legal_article)
EVAL_DATASET = [
    {
        "id": "lei-01",
        "query": "Quem pode exercer atividades de Educação Física segundo a Lei 9.696?",
        "expected_keywords": ["Art. 1", "prerrogativa", "Conselhos Regionais", "registrados"],
        "expected_doc": "Art. 1",
    },
    {
        "id": "lei-02",
        "query": "Quem pode se inscrever nos Conselhos Regionais de Educação Física?",
        "expected_keywords": ["Art. 2", "diploma", "Educação Física", "inscritos"],
        "expected_doc": "Art. 2",
    },
    {
        "id": "lei-03",
        "query": "Quais competências do Profissional de Educação Física na Lei 9.696?",
        "expected_keywords": ["Art. 3", "coordenar", "planejar", "atividades físicas"],
        "expected_doc": "Art. 3",
    },
    {
        "id": "lei-04",
        "query": "A Lei 9.696 cria quais conselhos de Educação Física?",
        "expected_keywords": ["Art. 4", "Confef", "Crefs", "Conselho Federal"],
        "expected_doc": "Art. 4",
    },
    {
        "id": "lei-05",
        "query": "Quais são as competências do Confef no Art. 5º-A?",
        "expected_keywords": ["Art. 5", "Confef", "compete", "Sistema"],
        "expected_doc": "Art. 5",
    },
    {
        "id": "lei-06",
        "query": "A Lei 9.696 regulamenta a profissão de Educação Física?",
        "expected_keywords": ["9.696", "Educação Física", "regulamentação", "profissão"],
        "expected_doc": "L9696",
    },
    {
        "id": "lei-07",
        "query": "Egressos de cursos superiores de Tecnologia podem se registrar no CREF?",
        "expected_keywords": ["Tecnologia", "Confef", "inscritos", "Art. 2"],
        "expected_doc": "Art. 2",
    },
    {
        "id": "lei-08",
        "query": "Onde fica a sede provisória do Confef segundo a lei?",
        "expected_keywords": ["Rio de Janeiro", "sede", "Confef", "Brasília"],
        "expected_doc": "Art. 4",
    },
]

print(f"Dataset de avaliacao: {len(EVAL_DATASET)} queries")
print(f"Documentos/artigos esperados: {len(set(q['expected_doc'] for q in EVAL_DATASET))}")
''',
        out_name="regulatorio_lei_eval_results.json",
        domain="regulatorio_lei",
        conclusion_md="""
## Conclusão

Eval dedicado aos chunks `legal_article` (Lei 9.696). Taxas municipais ficam em `test_regulatorio_taxas_rag.ipynb`.

Gaps possíveis:
1. `regulatorio_lei_base.txt` ainda não tem ingest próprio (fonte oficial = L9696.html)
2. Grupo mistura `legal_article` + `legal_fees` — retrieval pode misturar
3. Se métricas baixas: filtrar por `chunk_type=legal_article` no RPC / pós-filtro
""",
        filename="test_regulatorio_lei_rag.ipynb",
    )

    print(f"OK {eng}")
    print(f"OK {lei}")


if __name__ == "__main__":
    main()
