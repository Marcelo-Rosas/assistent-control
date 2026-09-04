"""Ponte RAG do JARVIS-Q — recuperação de chunks reais quando o KG não sabe.

Papel no router: FONTE, não decisor. O grafo (`report()`, regras, playbook)
continua dono de toda pergunta que ele cobre; RAG só entra na etapa final,
quando nada mais respondeu — EXCETO penetração/bairro (RAG-first).

Cadeia local: embedding via Ollama (mxbai-embed-large, 1024d, MESMO modelo
que gerou os chunks — sem isso o espaço vetorial não bate) → RPC
`match_chunks` no Supabase (hybrid vector+FTS, service_role only).

SERVICE_ROLE_KEY só roda aqui, no processo do server local. Nunca expor este
módulo — nem a chave — ao HUD/browser: um fetch direto do JS vazaria a chave
de serviço para qualquer aba aberta.
"""
from __future__ import annotations

import json
import os
import re
import unicodedata
import urllib.error
import urllib.parse
import urllib.request
from collections import Counter
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]

try:
    from dotenv import load_dotenv

    load_dotenv(ROOT / ".env", override=False)
    load_dotenv(ROOT / ".env.local", override=True)
except ImportError:
    pass

# Embed JARVIS: Ollama NATIVO. NÃO reusa OLLAMA_BASE_URL do .env.local
# (gateway OpenAI-compat .../v1). No Windows, 127.0.0.1 e localhost podem
# apontar pra processos Ollama DIFERENTES (IPv4 vs IPv6) — preferir
# localhost, onde o `ollama pull` costuma registrar o modelo.
# Override: JARVIS_OLLAMA_URL=http://localhost:11434
def _ollama_native_base() -> str:
    raw = (
        os.environ.get("JARVIS_OLLAMA_URL")
        or os.environ.get("OLLAMA_EMBED_URL")
        or "http://localhost:11434"
    ).strip().rstrip("/")
    if raw.endswith("/v1"):
        raw = raw[: -len("/v1")]
    return raw


OLLAMA_URL = _ollama_native_base()
EMBED_MODEL = "mxbai-embed-large"  # tem de casar com embedding_model dos chunks

# Busca semântica (conteúdo de academia). RECEITA fica de fora aqui:
# é censo fiscal, não listing comercial.
_GRUPOS_CONTEUDO = ("MERCADO", "TOTALPASS", "WELLHUB", "GURUPASS")

# Penetração: coberturas + universo Receita (denominador).
_GRUPOS_PENETRACAO = ("TOTALPASS", "WELLHUB", "GURUPASS", "RECEITA")
_LABEL_CURTO = {
    "totalpass": "TP",
    "wellhub": "WH",
    "gurupass": "GP",
    "receita": "Receita",
}

MIN_SIMILARITY = 0.55
TOP_K_POR_GRUPO = 5
TOP_K_FINAL = 3
TIMEOUT_S = 12
# Censo por bairro: páginas PostgREST (não top-k semântico).
COUNT_PAGE = 1000
COUNT_MAX_PAGES = 20


class RagIndisponivel(RuntimeError):
    """Ollama fora, Supabase sem credencial, ou nenhum grupo configurado."""


# Bairros cujo slug aparece em muitas cidades — sem `cidade` não mesclar Brasil.
_BAIRROS_AMBIGUOS = frozenset(
    {
        "centro",
        "paraiso",
        "boa-vista",
        "bela-vista",
        "jardim-america",
        "jardim-paulista",
        "vila-nova",
        "vila-maria",
        "santo-antonio",
        "sao-jose",
        "sao-francisco",
        "industrial",
        "cidade-nova",
        "alto-da-boa-vista",
    }
)

# Canonical display for `meta->>cidade` (probe: Title Case com acento).
_CIDADE_CANON: dict[str, str] = {
    "sao paulo": "São Paulo",
    "rio de janeiro": "Rio de Janeiro",
    "belo horizonte": "Belo Horizonte",
    "curitiba": "Curitiba",
    "porto alegre": "Porto Alegre",
    "brasilia": "Brasília",
    "campinas": "Campinas",
    "guarulhos": "Guarulhos",
    "salvador": "Salvador",
    "fortaleza": "Fortaleza",
    "recife": "Recife",
    "goiania": "Goiânia",
    "belem": "Belém",
    "manaus": "Manaus",
    "florianopolis": "Florianópolis",
    "vitoria": "Vitória",
    "santos": "Santos",
    "niteroi": "Niterói",
    "sao bernardo do campo": "São Bernardo do Campo",
    "santo andre": "Santo André",
}


def _strip_accents(s: str) -> str:
    s = unicodedata.normalize("NFD", str(s or ""))
    return "".join(c for c in s if unicodedata.category(c) != "Mn")


def normalize_bairro_slug(bairro: str) -> str:
    """Slug kebab (agregadores): 'Paraíso' → 'paraiso', 'Bela Vista' → 'bela-vista'."""
    s = _strip_accents(bairro).casefold()
    s = re.sub(r"[^a-z0-9]+", "-", s).strip("-")
    return s


def normalize_bairro_receita(bairro: str) -> str:
    """Forma Receita (UPPER + espaço): 'paraíso' → 'PARAISO', 'bela-vista' → 'BELA VISTA'."""
    s = _strip_accents(bairro)
    s = s.replace("-", " ").replace("_", " ")
    s = re.sub(r"\s+", " ", s).strip().upper()
    return s


def bairro_filter_variants(bairro: str) -> list[str]:
    """Formas de `meta.bairro_normalizado` a tentar (slug kebab + UPPER espaço)."""
    out: list[str] = []
    for v in (normalize_bairro_slug(bairro), normalize_bairro_receita(bairro)):
        if v and v not in out:
            out.append(v)
    return out


def normalize_cidade_canon(cidade: str) -> str | None:
    """Display canônico de cidade para `meta->>cidade`, ou None se vazio."""
    raw = re.sub(r"\s+", " ", str(cidade or "").strip())
    if not raw:
        return None
    fold = _strip_accents(raw).casefold()
    if fold in _CIDADE_CANON:
        return _CIDADE_CANON[fold]
    # Title Case leve (mantém preposições curtas em minúsculo se já vierem assim).
    return raw[:1].upper() + raw[1:] if raw else None


def cidade_filter_variants(cidade: str) -> list[str]:
    """Variantes de `meta->>cidade` (probe: só `cidade`, sem cidade_normalizada)."""
    raw = re.sub(r"\s+", " ", str(cidade or "").strip())
    if not raw:
        return []
    out: list[str] = []
    canon = normalize_cidade_canon(raw)
    unaccent = _strip_accents(canon or raw)
    for v in (canon, raw, unaccent, unaccent.title() if unaccent else None):
        if v and v not in out:
            out.append(v)
    return out


def bairro_ambiguo(bairro: str) -> bool:
    """True se o slug do bairro colide em várias cidades sem filtro de cidade."""
    slug = normalize_bairro_slug(bairro)
    return bool(slug) and slug in _BAIRROS_AMBIGUOS


def _grupos_disponiveis(nomes: tuple[str, ...] = _GRUPOS_CONTEUDO) -> dict[str, str]:
    out = {}
    for nome in nomes:
        gid = os.environ.get(f"{nome}_GROUP_ID")
        if gid:
            out[nome.lower()] = gid
    return out


def disponivel() -> bool:
    if os.environ.get("JARVIS_RAG", "1") == "0":
        return False
    if not (os.environ.get("SUPABASE_URL") and os.environ.get("SUPABASE_SERVICE_ROLE_KEY")):
        return False
    return bool(_grupos_disponiveis())


def penetracao_disponivel() -> bool:
    """Pelo menos um agregador (TP/WH/GP) com GROUP_ID — Receita é opcional."""
    if os.environ.get("JARVIS_RAG", "1") == "0":
        return False
    if not (os.environ.get("SUPABASE_URL") and os.environ.get("SUPABASE_SERVICE_ROLE_KEY")):
        return False
    g = _grupos_disponiveis(("TOTALPASS", "WELLHUB", "GURUPASS", "RECEITA"))
    return any(k in g for k in ("totalpass", "wellhub", "gurupass"))


def _embed(texto: str) -> list[float]:
    """POST nativo ``/api/embeddings`` (não ``/v1/embeddings``)."""
    base = _ollama_native_base()
    body = json.dumps({"model": EMBED_MODEL, "prompt": texto}).encode("utf-8")
    req = urllib.request.Request(
        f"{base}/api/embeddings",
        data=body,
        headers={"Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT_S) as r:
            data = json.load(r)
    except (urllib.error.URLError, OSError) as exc:
        raise RagIndisponivel(
            f"Ollama indisponível em {base} (subir ollama local ou "
            f"JARVIS_OLLAMA_URL): {exc}"
        ) from exc
    vec = data.get("embedding")
    if not vec:
        raise RagIndisponivel("Ollama devolveu embedding vazio")
    if len(vec) != 1024:
        raise RagIndisponivel(
            f"dimensão {len(vec)} ≠ 1024 — modelo deve ser {EMBED_MODEL}"
        )
    return vec


def _match_chunks_grupo(
    embedding: list[float],
    group_id: str,
    query: str,
    *,
    match_bairro: str | None = None,
    match_k: int = TOP_K_POR_GRUPO,
) -> list[dict]:
    url = os.environ["SUPABASE_URL"].rstrip("/") + "/rest/v1/rpc/match_chunks"
    key = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
    payload: dict[str, Any] = {
        "query_embedding": embedding,
        "match_group_id": group_id,
        "match_k": match_k,
        "min_similarity": MIN_SIMILARITY,
        "match_query": query,
    }
    if match_bairro:
        payload["match_bairro"] = match_bairro
    body = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=body,
        headers={
            "apikey": key,
            "Authorization": f"Bearer {key}",
            "Content-Type": "application/json",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT_S) as r:
            return json.load(r)
    except (urllib.error.URLError, OSError):
        return []  # um grupo fora do ar não derruba a busca inteira


def buscar(
    query: str,
    *,
    top_k: int = TOP_K_FINAL,
    match_bairro: str | None = None,
) -> list[dict]:
    """Fan-out nos grupos de conteúdo, agregado por score, top_k final.

    Cada chunk vem com `_grupo` anexado — é o que popula `fontes` no
    AskResult, para o painel dizer de onde a resposta saiu.

    ``match_bairro`` filtra `meta.bairro_normalizado` na RPC (slug kebab).
    """
    if not disponivel():
        raise RagIndisponivel("RAG não configurado (grupo/credencial ausente)")

    embedding = _embed(query)
    grupos = _grupos_disponiveis()
    bairro = normalize_bairro_slug(match_bairro) if match_bairro else None

    achados: list[dict] = []
    with ThreadPoolExecutor(max_workers=len(grupos) or 1) as pool:
        futs = {
            pool.submit(
                _match_chunks_grupo, embedding, gid, query, match_bairro=bairro
            ): nome
            for nome, gid in grupos.items()
        }
        for fut in as_completed(futs):
            nome = futs[fut]
            for chunk in fut.result():
                chunk["_grupo"] = nome
                achados.append(chunk)

    achados.sort(
        key=lambda c: float(c.get("score") or c.get("similarity") or 0),
        reverse=True,
    )
    return achados[:top_k]


def academia_key(row: dict) -> str | None:
    """Chave estável p/ distinct: cnpj > gym_id > nome_academia > source_ref."""
    meta = row.get("meta") or {}
    for candidate in (
        meta.get("cnpj"),
        meta.get("gym_id"),
        meta.get("nome_academia"),
        row.get("source_ref"),
        meta.get("nome_fantasia"),
    ):
        if candidate is None:
            continue
        s = str(candidate).strip()
        if s:
            return s.casefold()
    return None


def _rest_get(path_qs: str, *, prefer: str | None = None) -> tuple[Any, dict]:
    base = os.environ["SUPABASE_URL"].rstrip("/")
    key = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
    headers = {
        "apikey": key,
        "Authorization": f"Bearer {key}",
    }
    if prefer:
        headers["Prefer"] = prefer
    req = urllib.request.Request(f"{base}{path_qs}", headers=headers)
    with urllib.request.urlopen(req, timeout=TIMEOUT_S) as resp:
        raw = resp.read().decode("utf-8")
        data = json.loads(raw) if raw else None
        return data, dict(resp.headers)


def _fetch_bairro_rows(
    group_id: str,
    bairro_norm: str,
    *,
    cidade: str | None = None,
    only_ativo: bool = False,
) -> list[dict]:
    """Página PostgREST: chunks do grupo com `bairro_normalizado` exato."""
    rows: list[dict] = []
    for page in range(COUNT_MAX_PAGES):
        start = page * COUNT_PAGE
        end = start + COUNT_PAGE - 1
        params = [
            "select=source_ref,meta",
            f"group_id=eq.{group_id}",
            f"meta->>bairro_normalizado=eq.{urllib.parse.quote(bairro_norm)}",
        ]
        if cidade:
            params.append(f"meta->>cidade=eq.{urllib.parse.quote(cidade)}")
        if only_ativo:
            params.append("meta->>is_ativo=eq.true")
        path = "/rest/v1/eros_knowledge_chunks?" + "&".join(params)
        base = os.environ["SUPABASE_URL"].rstrip("/")
        key = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
        req = urllib.request.Request(
            f"{base}{path}",
            headers={
                "apikey": key,
                "Authorization": f"Bearer {key}",
                "Range": f"{start}-{end}",
                "Prefer": "count=exact",
            },
        )
        try:
            with urllib.request.urlopen(req, timeout=TIMEOUT_S) as resp:
                raw = resp.read().decode("utf-8")
                batch = json.loads(raw) if raw else []
        except (urllib.error.URLError, OSError):
            break
        if not isinstance(batch, list) or not batch:
            break
        rows.extend(batch)
        if len(batch) < COUNT_PAGE:
            break
    return rows


def _rows_for_bairro_cidade(
    group_id: str,
    bairro_norm: str,
    *,
    cidade_variants: list[str] | None,
    only_ativo: bool = False,
) -> list[dict]:
    """Busca rows; se há variantes de cidade, tenta cada uma (sem fallback nacional)."""
    if not cidade_variants:
        return _fetch_bairro_rows(group_id, bairro_norm, only_ativo=only_ativo)
    best: list[dict] = []
    for civ in cidade_variants:
        rows = _fetch_bairro_rows(
            group_id, bairro_norm, cidade=civ, only_ativo=only_ativo
        )
        if len(rows) > len(best):
            best = rows
        if rows:
            break
    return best


def _distinct_count_for_group(
    group_id: str,
    bairro: str,
    *,
    cidade: str | None = None,
    receita: bool = False,
) -> tuple[int, Counter[str]]:
    """Distinct academias + histograma de plano_minimo (se houver)."""
    variants = bairro_filter_variants(bairro)
    # Receita: preferir UPPER; agregadores: preferir slug.
    if receita:
        variants = sorted(variants, key=lambda v: (0 if v.isupper() else 1, v))
    else:
        variants = sorted(
            variants, key=lambda v: (0 if "-" in v or v.islower() else 1, v)
        )
    cidade_vars = cidade_filter_variants(cidade) if cidade else None

    best_keys: set[str] = set()
    best_planos: Counter[str] = Counter()
    for variant in variants:
        rows = _rows_for_bairro_cidade(
            group_id,
            variant,
            cidade_variants=cidade_vars,
            only_ativo=receita,
        )
        if not rows and receita:
            # fallback: sem filtro is_ativo (alguns chunks sem flag)
            rows = _rows_for_bairro_cidade(
                group_id, variant, cidade_variants=cidade_vars
            )
        keys: set[str] = set()
        planos: Counter[str] = Counter()
        for row in rows:
            k = academia_key(row)
            if not k:
                continue
            if k in keys:
                continue
            keys.add(k)
            plano = (row.get("meta") or {}).get("plano_minimo")
            if plano:
                planos[str(plano)] += 1
        if len(keys) > len(best_keys):
            best_keys, best_planos = keys, planos
        if keys:
            break  # primeira variante de bairro com hit basta
    return len(best_keys), best_planos


def contar_penetracao(
    bairro: str,
    *,
    cidade: str | None = None,
) -> dict[str, Any]:
    """Censo distinct por agregador + Receita no bairro.

    Não usa `match_chunks` top-k — PostgREST filter + distinct em Python.
    Com `cidade`, filtra `meta->>cidade` (variantes); sem cidade + bairro
    ambíguo, o chamador deve pedir cidade — aqui só marca o escopo.
    """
    if not penetracao_disponivel():
        raise RagIndisponivel("penetração: grupo/credencial ausente")

    cidade_canon = normalize_cidade_canon(cidade) if cidade else None
    ambig = bairro_ambiguo(bairro)
    geo_scope = "cidade" if cidade_canon else ("ambiguidade" if ambig else "nacional")

    grupos = _grupos_disponiveis(_GRUPOS_PENETRACAO)
    counts: dict[str, int] = {}
    planos_top: dict[str, str | None] = {}

    # Ambíguo sem cidade: não mesclar Brasil — zeros + flag para narrar/perguntar.
    if geo_scope == "ambiguidade":
        for nome in ("totalpass", "wellhub", "gurupass", "receita"):
            counts[nome] = 0
            planos_top[nome] = None
        return {
            "bairro": bairro,
            "bairro_slug": normalize_bairro_slug(bairro),
            "cidade": None,
            "cidade_canon": None,
            "geo_scope": geo_scope,
            "mesmo_escopo": False,
            "counts": counts,
            "planos_top": planos_top,
        }

    def _one(nome: str, gid: str) -> tuple[str, int, Counter[str]]:
        n, planos = _distinct_count_for_group(
            gid, bairro, cidade=cidade_canon, receita=(nome == "receita")
        )
        return nome, n, planos

    with ThreadPoolExecutor(max_workers=len(grupos) or 1) as pool:
        futs = [pool.submit(_one, nome, gid) for nome, gid in grupos.items()]
        for fut in as_completed(futs):
            nome, n, planos = fut.result()
            counts[nome] = n
            planos_top[nome] = planos.most_common(1)[0][0] if planos else None

    for nome in ("totalpass", "wellhub", "gurupass", "receita"):
        counts.setdefault(nome, 0)
        planos_top.setdefault(nome, None)

    # % só faz sentido com filtro de cidade (mesmo escopo geo nos 4 grupos).
    mesmo_escopo = geo_scope == "cidade"

    return {
        "bairro": bairro,
        "bairro_slug": normalize_bairro_slug(bairro),
        "cidade": cidade_canon,
        "cidade_canon": cidade_canon,
        "geo_scope": geo_scope,
        "mesmo_escopo": mesmo_escopo,
        "counts": counts,
        "planos_top": planos_top,
    }


def narrar_penetracao(agg: dict[str, Any]) -> str:
    """Prosa curta: distinct TP/WH/GP (+ Receita), líder, plano top, WH% mercado."""
    counts: dict[str, int] = agg.get("counts") or {}
    planos: dict[str, str | None] = agg.get("planos_top") or {}
    bairro = agg.get("bairro") or "?"
    label = str(bairro).strip().title()
    cidade = agg.get("cidade_canon") or agg.get("cidade")
    geo_scope = agg.get("geo_scope") or ("cidade" if cidade else "nacional")
    mesmo_escopo = bool(agg.get("mesmo_escopo"))

    if geo_scope == "ambiguidade":
        return (
            f"O bairro {label} existe em várias cidades. "
            f"Qual cidade o senhor quer — por exemplo São Paulo ou Belo Horizonte?"
        )

    tp = int(counts.get("totalpass") or 0)
    wh = int(counts.get("wellhub") or 0)
    gp = int(counts.get("gurupass") or 0)
    rec = int(counts.get("receita") or 0)

    onde = f"{label} ({cidade})" if cidade else label
    partes = [
        f"No bairro {onde}: TotalPass {tp}, Wellhub {wh}, GuruPass {gp}"
    ]
    if geo_scope == "nacional":
        partes[0] += " (escopo nacional — sem cidade no pedido)"
    if rec > 0:
        partes[0] += f"; universo Receita {rec} academia(s) aberta(s)"
    partes[0] += "."

    cob = [("TotalPass", tp), ("Wellhub", wh), ("GuruPass", gp)]
    cob_pos = [(n, v) for n, v in cob if v > 0]
    if cob_pos:
        cob_pos.sort(key=lambda x: -x[1])
        lider, n_lider = cob_pos[0]
        partes.append(f"Maior cobertura: {lider} ({n_lider}).")
        key = {
            "TotalPass": "totalpass",
            "Wellhub": "wellhub",
            "GuruPass": "gurupass",
        }[lider]
        plano = planos.get(key)
        if plano:
            partes.append(f"Plano mais frequente em {lider}: {plano}.")
    else:
        partes.append("Sem cobertura de agregador indexada nesse bairro.")

    max_cob = max(tp, wh, gp)
    # Denom policy: % de mercado só com Receita ≥ max(TP,WH,GP) no mesmo
    # escopo. Se cobertura > censo RFB → counts crus + "cobertura vs censo",
    # sem alegar market share. União CNPJ Receita∪agregadores: não — meta
    # agregador tipicamente sem CNPJ confiável nos dois lados.
    if mesmo_escopo and rec > 0 and max_cob > rec:
        partes.append(
            f"Universo parcial (censo RFB/CNPJ): cobertura máx. {max_cob} "
            f"> Receita {rec} — gap de cadastro, geo incompleta no índice RAG "
            f"ou listagem fora do CNAE; % de mercado omitida. "
            f"Cobertura vs censo: {max_cob}/{rec}."
        )
    elif mesmo_escopo and rec > 0 and wh > 0:
        pct = 100.0 * wh / rec
        partes.append(
            f"Wellhub cobre cerca de {pct:.0f}% do universo Receita no bairro."
        )
    elif not mesmo_escopo and (tp or wh or gp or rec):
        partes.append(
            "Penetração % omitida: sem cidade o denominador Receita e as "
            "coberturas podem misturar praças diferentes."
        )
    elif rec == 0 and (tp or wh or gp):
        partes.append(
            "Universo Receita indisponível ou sem match de bairro "
            "(normalização UPPER≠slug); penetração % omitida."
        )

    return " ".join(partes)


def narrar(chunks: list[dict]) -> str:
    """Frase curta a partir do melhor chunk — não um dump do texto recuperado."""
    if not chunks:
        return ""
    top = chunks[0]
    meta = top.get("meta") or {}
    nome = meta.get("nome_academia")
    cidade = meta.get("cidade")
    if nome and cidade:
        extra = f" e mais {len(chunks) - 1}" if len(chunks) > 1 else ""
        return f"Achei {nome}, em {cidade}{extra}. Quer os detalhes?"
    trecho = str(top.get("text") or "")[:140].strip()
    return f"{trecho}… Quer que eu detalhe?" if trecho else ""
