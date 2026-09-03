"""
Trainer de viabilidade municipal (Vectra Cargo)
===============================================
Treina o ViabilityReasoner sobre a base municipal de academia.train.json e
mede honestamente se o raciocínio relacional agrega valor sobre um baseline
flat — evitando o "número sem validação".

Granularidade: MUNICIPAL (645 cidades, já agregadas por ibge). Blocker gym->ibge
não se aplica aqui — os dados já vêm por município.

Label REAL: `recomendacao` (subconjunto de cidades flagado pelo negócio).
Não-circular entre eixos: demanda (renda/empresas IBGE) x oferta (gap de aggregator).

Provas anti-circularidade (ambas reportadas):
  1. BASELINE flat: logística sobre features cruas. Se o reasoner não bate o
     baseline, o grafo não agrega — e dizemos isso.
  2. MASKING: esconde as arestas de faixa (renda+gap) das cidades de validação
     e mede se o modelo ainda prevê via contexto relacional (região/aggregator).
     Se a AUC desaba pro nível do acaso, o valor relacional é nulo — reportado.

Uso: python notebooks/train_viabilidade.py [caminho_json]
"""
from __future__ import annotations

# pyright: reportIndexIssue=false, reportOperatorIssue=false
# pyright: reportReturnType=false, reportOptionalCall=false, reportArgumentType=false

import json
import sys

import numpy as np
import tensorflow as tf

from reasoning_neuron_viabilidade import (
    KnowledgeGraph,
    ViabilityReasoner,
    set_seed,
)

DEFAULT_JSON = "data/academia.train.json"
AGGREGATORS = ("wellhub", "totalpass", "gurupass")
AGG_TOKEN = {"WH": "wellhub", "TP": "totalpass", "GP": "gurupass"}


# ----------------------------------------------------------------------------
# 1. Carregar dados municipais
# ----------------------------------------------------------------------------
def load_cidades(path: str) -> tuple[list[dict], set[str]]:
    d = json.load(open(path, encoding="utf-8"))
    cidades = d["cidades"]
    rec_set = {r["ibge"] for r in d.get("recomendacoes", [])}
    return cidades, rec_set


def _quartil_faixa(valores: np.ndarray) -> np.ndarray:
    """Mapeia valores contínuos em 0..3 por quartil (NaN -> quartil 0)."""
    v = np.array(valores, dtype=np.float64)
    finite = v[np.isfinite(v)]
    if finite.size == 0:
        return np.zeros(len(v), dtype=int)
    qs = np.quantile(finite, [0.25, 0.5, 0.75])
    out = np.zeros(len(v), dtype=int)
    for i, x in enumerate(v):
        if not np.isfinite(x):
            out[i] = 0
        else:
            out[i] = int(np.searchsorted(qs, x, side="right"))
    return out


# ----------------------------------------------------------------------------
# 1b. TensorBoard — instrumentacao opcional (--tb)
# ----------------------------------------------------------------------------
LOGDIR = "runs"


_LOGDIR_ATUAL = ""


def _tb_writer(nome: str):
    import datetime

    global _LOGDIR_ATUAL
    stamp = datetime.datetime.now().strftime("%Y%m%d-%H%M%S")
    _LOGDIR_ATUAL = f"{LOGDIR}/{stamp}-{nome}"
    return tf.summary.create_file_writer(_LOGDIR_ATUAL)


def _tb_projector(logdir: str, H, kg, labels, city_ids, cidades) -> None:
    """Embeddings das cidades para a aba Projector.

    Grava o formato que o Projector espera: checkpoint TF + metadata.tsv com
    uma linha de cabecalho e uma por vetor, na MESMA ordem do tensor.

    O metadata leva nome, UF, regiao, gap e pattern — nao o codigo IBGE. Sao
    as colunas pelas quais se colore a nuvem; so com o codigo a aba fica
    ilegivel (numero de 7 digitos nao diz nada a quem olha).
    """
    import os

    from tensorboard.plugins import projector

    os.makedirs(logdir, exist_ok=True)
    ids = [int(i) for i in city_ids]
    # city_ids segue a ordem de `cidades` (ambos vem do mesmo loop em build_kg).
    assert len(ids) == len(cidades), "ordem de city_ids e cidades divergiu"

    with open(os.path.join(logdir, "metadata.tsv"), "w", encoding="utf-8") as f:
        f.write("cidade\tuf\tregiao\tgap_agg\tpattern\trecomendada\n")
        for i, c in enumerate(cidades):
            nome = str(c.get("cidade") or c.get("ibge") or "?").replace("\t", " ")
            f.write(
                f"{nome}\t{c.get('uf','?')}\t{c.get('region','?')}\t"
                f"{int(c.get('gap_agg') or 0)}\t{c.get('pattern','?')}\t"
                f"{int(labels[i])}\n"
            )

    emb = tf.Variable(tf.gather(H, ids), name="cidades")
    ckpt = tf.train.Checkpoint(embedding=emb)
    ckpt.save(os.path.join(logdir, "embedding.ckpt"))

    cfg = projector.ProjectorConfig()
    e = cfg.embeddings.add()
    # Nome que o plugin procura no checkpoint (sufixo fixo do Checkpoint API).
    e.tensor_name = "embedding/.ATTRIBUTES/VARIABLE_VALUE"
    e.metadata_path = "metadata.tsv"
    projector.visualize_embeddings(logdir, cfg)


# ----------------------------------------------------------------------------
# 2. Montar KG + labels + features flat
# ----------------------------------------------------------------------------
def build_kg(cidades: list[dict], rec_set: set[str]):
    entity2id: dict[str, int] = {}

    def eid(name: str) -> int:
        return entity2id.setdefault(name, len(entity2id))

    # Nós de faixa/região/aggregator (fixos)
    for q in range(4):
        eid(f"renda_q{q}")
        eid(f"pop_q{q}")
    for g in range(4):
        eid(f"gap_{g}")
    for agg in AGGREGATORS:
        eid(f"aggr:{agg}")

    def num(c: dict, *keys, default=np.nan):
        cur = c
        for k in keys:
            cur = (cur or {}).get(k) if isinstance(cur, dict) else None
        return cur if isinstance(cur, (int, float)) else default

    renda = np.array([num(c, "mercado", "renda_pc_mediana") for c in cidades])
    pop = np.array([num(c, "pop") for c in cidades])
    indice = np.array([num(c, "mercado", "indice_formal") for c in cidades])
    emp_mil = np.array([num(c, "mercado", "empresas_por_mil") for c in cidades])
    gap = np.array([int(c.get("gap_agg") or 0) for c in cidades])

    renda_q = _quartil_faixa(renda)
    pop_q = _quartil_faixa(pop)

    relation2id = {
        "na_regiao": 0, "faixa_renda": 1, "faixa_pop": 2,
        "faixa_gap": 3, "presente_em": 4,
    }
    triples: list[tuple[int, int, int]] = []
    city_ids: list[int] = []
    labels: list[int] = []
    masked_relations = {relation2id["faixa_renda"], relation2id["faixa_gap"]}

    for i, c in enumerate(cidades):
        cid = eid(f"cidade:{c['ibge']}")
        city_ids.append(cid)
        labels.append(1 if c["ibge"] in rec_set else 0)

        triples.append((cid, relation2id["na_regiao"], eid(f"regiao:{c.get('region','?')}")))
        triples.append((cid, relation2id["faixa_renda"], entity2id[f"renda_q{renda_q[i]}"]))
        triples.append((cid, relation2id["faixa_pop"], entity2id[f"pop_q{pop_q[i]}"]))
        triples.append((cid, relation2id["faixa_gap"], entity2id[f"gap_{min(gap[i],3)}"]))
        present = str(c.get("aggregators_present") or c.get("pattern") or "")
        for tok, agg in AGG_TOKEN.items():
            if tok in present:
                triples.append((cid, relation2id["presente_em"], entity2id[f"aggr:{agg}"]))

    kg = KnowledgeGraph(entity2id, relation2id, triples)

    # features flat para o baseline (demanda + oferta), padronizadas
    def fill(v):
        v = np.array(v, dtype=np.float64)
        m = np.nanmedian(v[np.isfinite(v)]) if np.isfinite(v).any() else 0.0
        v[~np.isfinite(v)] = m
        return v

    feats = np.stack([fill(renda), fill(pop), fill(indice), fill(emp_mil), gap.astype(float)], axis=1)
    feats = (feats - feats.mean(0)) / (feats.std(0) + 1e-8)

    return kg, np.array(city_ids), np.array(labels), feats, masked_relations


# ----------------------------------------------------------------------------
# 3. Métricas + baseline
# ----------------------------------------------------------------------------
def auc(y: np.ndarray, s: np.ndarray) -> float:
    y = np.asarray(y)
    pos, neg = np.sum(y == 1), np.sum(y == 0)
    if pos == 0 or neg == 0:
        return float("nan")
    order = np.argsort(s)
    ranks = np.empty(len(s), dtype=np.float64)
    ranks[order] = np.arange(1, len(s) + 1)
    return float((ranks[y == 1].sum() - pos * (pos + 1) / 2) / (pos * neg))


def logistic_baseline(Xtr, ytr, Xva, epochs=400, lr=0.1):
    """Logística numpy pura (sem sklearn) — baseline flat honesto."""
    w = np.zeros(Xtr.shape[1])
    b = 0.0
    for _ in range(epochs):
        z = Xtr @ w + b
        p = 1 / (1 + np.exp(-z))
        gw = Xtr.T @ (p - ytr) / len(ytr)
        gb = float(np.mean(p - ytr))
        w -= lr * gw
        b -= lr * gb
    return 1 / (1 + np.exp(-(Xva @ w + b)))


# ----------------------------------------------------------------------------
# 4. Treino + avaliação honesta
# ----------------------------------------------------------------------------
def main(path: str = DEFAULT_JSON) -> None:
    try:
        sys.stdout.reconfigure(encoding="utf-8")  # console Windows = cp1252
    except Exception:
        pass
    # `default_rng(42)` ja fixava split e negativos, mas NAO o init dos pesos
    # (glorot_uniform le o RNG global do TF). Sem isto o AUC sob masking — o
    # unico numero informativo deste experimento — variava entre execucoes:
    # medido 0.904 / 0.912 / 0.923 nos mesmos dados.
    set_seed()
    rng = np.random.default_rng(42)
    usar_tb = "--tb" in sys.argv
    writer = _tb_writer("viabilidade") if usar_tb else None
    cidades, rec_set = load_cidades(path)
    kg, city_ids, labels, feats, masked_rel = build_kg(cidades, rec_set)
    n = len(city_ids)
    print(f"cidades={n} positivos(recomendacao)={int(labels.sum())} "
          f"entidades={kg.num_entities} relacoes_base={kg.num_base_relations}")

    # split estratificado 80/20
    idx = rng.permutation(n)
    va = np.concatenate([
        idx[labels[idx] == 1][: max(1, int(0.2 * (labels == 1).sum()))],
        idx[labels[idx] == 0][: max(1, int(0.2 * (labels == 0).sum()))],
    ])
    tr = np.setdiff1d(idx, va)
    ytr, yva = labels[tr], labels[va]

    # baseline flat
    base_va = logistic_baseline(feats[tr], ytr.astype(float), feats[va])
    auc_base = auc(yva, base_va)

    # reasoner
    model = ViabilityReasoner(kg, embedding_dim=32, max_hops=2)
    pos = np.array(kg.triples, dtype=np.int64)
    opt = tf.keras.optimizers.Adam(5e-3)
    ctr = city_ids[tr].astype(np.int64)
    ltr = tf.constant(ytr, tf.float32)

    for step in range(300):
        neg = pos.copy()
        neg[:, 2] = rng.integers(0, kg.num_entities, size=len(pos))
        with tf.GradientTape() as tape:
            H, _ = model.reason()
            l_kge = model.kge_loss(H, pos, neg)
            l_viab = model.viability_loss(H, ctr, ltr)
            loss = l_kge + l_viab
        grads = tape.gradient(loss, model.trainable_variables)
        opt.apply_gradients(zip(grads, model.trainable_variables))

        if writer is not None and step % 5 == 0:
            s_va_step = tf.nn.sigmoid(
                model.viability_logit(H, city_ids[va].astype(np.int64))
            ).numpy()
            with writer.as_default(step=step):
                tf.summary.scalar("loss/total", float(loss))
                tf.summary.scalar("loss/kge", float(l_kge))
                tf.summary.scalar("loss/viabilidade", float(l_viab))
                tf.summary.scalar("auc/held_out", float(auc(yva, s_va_step)))
                tf.summary.histogram("embeddings/cidades", tf.gather(H, city_ids))
                tf.summary.histogram("score/held_out", s_va_step)

    # AUC held-out sem masking
    H, _ = model.reason()
    s_va = tf.nn.sigmoid(model.viability_logit(H, city_ids[va].astype(np.int64))).numpy()
    auc_full = auc(yva, s_va)

    # AUC held-out COM masking (esconde faixa_renda+faixa_gap das cidades de val)
    val_city_set = set(city_ids[va].tolist())
    masked_triples = [
        t for t in kg.triples
        if not (t[0] in val_city_set and t[1] in masked_rel)
    ]
    kg_masked = KnowledgeGraph(kg.entity2id, kg.relation2id, masked_triples)
    model.adj = kg_masked.build_adjacencies()
    Hm, _ = model.reason()
    s_mask = tf.nn.sigmoid(model.viability_logit(Hm, city_ids[va].astype(np.int64))).numpy()
    auc_mask = auc(yva, s_mask)
    model.adj = kg.build_adjacencies()  # restaura

    # ---- veredito honesto ----
    print("\n=== Avaliação (held-out) ===")
    print(f"AUC baseline flat (logística) : {auc_base:.3f}")
    print(f"AUC reasoner (sem masking)    : {auc_full:.3f}")
    print(f"AUC reasoner (com masking)    : {auc_mask:.3f}")
    delta = auc_full - auc_base
    print("\n=== Veredito ===")
    if not np.isfinite(auc_full):
        print("INCONCLUSIVO: val sem classes suficientes.")
    elif delta < 0.02:
        print(f"Reasoner NÃO supera baseline (Δ={delta:+.3f}). Grafo agrega ~nada "
              f"além do flat; valor = trace explicável, não predição melhor.")
    elif auc_mask < 0.6:
        print(f"Reasoner bate baseline (Δ={delta:+.3f}) MAS desaba sob masking "
              f"({auc_mask:.3f}) → depende da feature direta, generalização "
              f"relacional fraca. Reportar com essa ressalva.")
    else:
        print(f"Reasoner supera baseline (Δ={delta:+.3f}) E sustenta sob masking "
              f"({auc_mask:.3f}) → há valor relacional real. Liberado p/ relatório.")

    print(f"\nCheckpoint salvável via model.save_weights(). N={n} é pequeno — "
          f"tratar como scoring estruturado + explicabilidade, não deep learning.")

    if writer is not None:
        # Vazamento medido: `recomendacao` e identica a (gap_agg > 0) nas 645
        # cidades. Vai para a aba Text junto dos numeros — quem abrir o
        # dashboard tem de ler o AUC 1.000 ja com essa ressalva ao lado.
        gap_raw = np.array([int(c.get("gap_agg") or 0) for c in cidades])
        vazou = bool(((gap_raw > 0).astype(int) == labels).all())
        with writer.as_default(step=0):
            tf.summary.text(
                "00_leia_primeiro",
                "## Vazamento de label\n\n"
                f"`recomendacao == (gap_agg > 0)`: **{vazou}** "
                f"({int(((gap_raw > 0).astype(int) != labels).sum())} discordancias "
                f"em {n} cidades).\n\n"
                "O label E a feature. Por isso baseline e reasoner empatam em "
                "AUC 1.000 — a tarefa e trivial, nao ha valor relacional sendo "
                "medido. **O unico numero informativo aqui e o AUC sob masking**, "
                "onde as arestas de renda e gap sao escondidas.\n\n"
                "Para medir de verdade, o label precisa vir de fora do eixo de "
                "oferta: contrato fechado, academia aberta, receita.",
            )
            tf.summary.text(
                "01_resultados",
                f"| metrica | valor |\n|---|---|\n"
                f"| AUC baseline flat | {auc_base:.3f} |\n"
                f"| AUC reasoner | {auc_full:.3f} |\n"
                f"| AUC reasoner (masking) | {auc_mask:.3f} |\n"
                f"| delta vs baseline | {delta:+.3f} |\n"
                f"| cidades | {n} |\n"
                f"| positivos | {int(labels.sum())} "
                f"({100 * labels.mean():.1f}%) |",
            )
            tf.summary.scalar("auc/baseline_flat", auc_base)
            tf.summary.scalar("auc/reasoner", auc_full)
            tf.summary.scalar("auc/reasoner_masking", auc_mask)
            # PR curve pede labels booleanos + predicoes no held-out.
            try:
                from tensorboard.plugins.pr_curve import summary as pr_summary

                tf.summary.experimental.write_raw_pb(
                    pr_summary.pb(
                        "pr/held_out",
                        yva.astype(bool),
                        s_va.astype(np.float32),
                        num_thresholds=127,
                    ).SerializeToString(),
                    step=0,
                )
            except Exception as exc:  # noqa: BLE001 — PR curve e acessorio
                print(f"aviso: PR curve nao gravada ({exc})")
        writer.flush()

        _tb_projector(_LOGDIR_ATUAL, H, kg, labels, city_ids, cidades)
        print(f"\nTensorBoard: tensorboard --logdir {LOGDIR}")


if __name__ == "__main__":
    # Flags nao sao caminho: sem isso "--tb" era lido como o JSON de entrada.
    _args = [a for a in sys.argv[1:] if not a.startswith("-")]
    main(_args[0] if _args else DEFAULT_JSON)
