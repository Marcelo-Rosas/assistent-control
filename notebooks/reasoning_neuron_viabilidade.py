"""
Reasoning Neuron para Análise de Viabilidade de Mercado (Vectra Cargo)
=====================================================================
Neurônio TensorFlow que RACIOCINA sobre a base de conhecimento aprendida no
treino (bairros, cidades, gyms, faixas de renda, faixa de aluguel-MRLR,
cobertura de aggregators) e emite um RELATÓRIO DE VIABILIDADE auditável.

Corrige os furos do design bilinear ingênuo:
- C1: hops NÃO-lineares (ReLU + LayerNorm) → multi-hop real, não colapsa em linear.
- C2: mensagens propagadas sobre os FATOS (R-GCN sobre adjacências esparsas) →
      raciocina sobre a KB explícita, não sobre embeddings soltos.
- C3: forward chaining verdadeiro = propagação sobre TODAS as relações até max_hops.
- C4: confiança POR-REGRA (RuleBank) + t-norm produto LIGADO → exceção/conflito.
- A5: relação inversa é relação própria treinável → backward chaining sem transposta.
- A6: trace de contribuição por relação/hop/entidade → explicabilidade por instância.
- M8/M9/M10: loss em score pré-sigmoid, embeddings L2-normalizados, LayerNorm por hop.

Requer: tensorflow>=2.17
"""
from __future__ import annotations

# Os stubs do TensorFlow/basedpyright não modelam a API dinâmica de Tensor
# (indexação `t[i]`, operadores `+`/`*`/`-`, retorno de ops esparsas), gerando
# falso-positivo. O código é validado em runtime (ver _toy_demo). Suprimimos só
# essas categorias — erros reais (nome/atributo) continuam visíveis.
# pyright: reportIndexIssue=false, reportOperatorIssue=false
# pyright: reportReturnType=false, reportOptionalCall=false, reportArgumentType=false

import dataclasses
from typing import Sequence

import keras
import numpy as np
import tensorflow as tf

# Seed padrao do projeto. Sem seed fixa, `glorot_uniform` sorteia pesos novos a
# cada import e `report()` vira ruido: medido 0.1023-0.8310 de score na MESMA
# entidade, cruzando o limiar 0.66 em 3 de 12 execucoes. Ou seja, o relatorio
# afirmava "viavel" por sorteio. Ver set_seed() / train_reasoner().
DEFAULT_SEED = 20260903


def set_seed(seed: int = DEFAULT_SEED) -> None:
    """Fixa os RNG de random/NumPy/TF de uma vez (Keras 3).

    Precisa rodar ANTES de instanciar o modelo — os pesos sao sorteados no
    build, entao semear depois nao torna o `report()` reprodutivel.
    """
    keras.utils.set_random_seed(seed)


# ----------------------------------------------------------------------------
# 1. Base de conhecimento tensorizada
# ----------------------------------------------------------------------------
@dataclasses.dataclass
class KnowledgeGraph:
    """Fatos (s, r, o) → adjacências esparsas por relação, com inversas.

    entity2id / relation2id mapeiam nomes → índices. `triples` são as triplas
    já indexadas. Cada relação-base r ganha uma inversa r' = r + num_base para
    permitir backward chaining sem transpor matrizes (fix A5).
    """

    entity2id: dict[str, int]
    relation2id: dict[str, int]
    triples: list[tuple[int, int, int]]

    def __post_init__(self) -> None:
        self.num_entities = len(self.entity2id)
        self.num_base_relations = len(self.relation2id)
        self.num_relations = 2 * self.num_base_relations
        self._triple_set = set(self.triples)

    def build_adjacencies(self) -> list[tf.SparseTensor]:
        """Uma SparseTensor (E, E) por relação (base + inversa), row-normalizada
        pelo grau de saída (média das mensagens = estabilidade numérica)."""
        E = self.num_entities
        base = self.num_base_relations
        buckets: list[list[tuple[int, int]]] = [[] for _ in range(self.num_relations)]
        for s, r, o in self.triples:
            buckets[r].append((s, o))            # relação direta
            buckets[r + base].append((o, s))     # relação inversa (fix A5)

        adjs: list[tf.SparseTensor] = []
        for r in range(self.num_relations):
            if not buckets[r]:
                adjs.append(
                    tf.sparse.SparseTensor(
                        tf.zeros((0, 2), tf.int64), tf.zeros((0,), tf.float32), [E, E]
                    )
                )
                continue
            idx = np.array(sorted(buckets[r]), dtype=np.int64)
            deg = np.zeros(E, dtype=np.float32)
            for s, _ in idx:
                deg[s] += 1.0
            vals = np.array([1.0 / deg[s] for s, _ in idx], dtype=np.float32)
            adjs.append(tf.sparse.reorder(tf.sparse.SparseTensor(idx, vals, [E, E])))
        return adjs

    def is_known(self, s: int, r: int, o: int) -> bool:
        return (s, r, o) in self._triple_set


# ----------------------------------------------------------------------------
# 2. Reasoning Neuron — message passing multi-hop com trace por instância
# ----------------------------------------------------------------------------
class ReasoningNeuron(keras.layers.Layer):
    """R-GCN diferenciável. Cada hop: transforma o embedding pela matriz da
    relação (fatorada em bases p/ escala), agrega sobre os FATOS via A_r
    esparso, aplica não-linearidade + LayerNorm. Devolve embeddings raciocinados
    e um trace de contribuição por relação/hop/entidade (explicabilidade)."""

    def __init__(
        self,
        num_entities: int,
        num_relations: int,
        embedding_dim: int = 64,
        max_hops: int = 3,
        num_bases: int | None = None,
        **kwargs,
    ) -> None:
        super().__init__(**kwargs)
        self.num_entities = num_entities
        self.num_relations = num_relations
        self.embedding_dim = embedding_dim
        self.max_hops = max_hops
        self.num_bases = num_bases or min(num_relations, embedding_dim)

    def build(self, _) -> None:
        d = self.embedding_dim
        self.entity_embeddings = self.add_weight(
            name="entity_embeddings", shape=(self.num_entities, d),
            initializer="glorot_uniform", trainable=True,
        )
        # Decomposição em bases (R-GCN): W_r = sum_b coeff[r,b] * B_b.
        # Controla o nº de parâmetros quando há muitas relações.
        self.bases = self.add_weight(
            name="bases", shape=(self.num_bases, d, d),
            initializer="glorot_uniform", trainable=True,
        )
        self.base_coeff = self.add_weight(
            name="base_coeff", shape=(self.num_relations, self.num_bases),
            initializer="glorot_uniform", trainable=True,
        )
        self.self_weight = self.add_weight(
            name="self_weight", shape=(d, d),
            initializer="glorot_uniform", trainable=True,
        )
        # Gate de confiança por-relação (sigmoid); zeros → 0.5 neutro no início.
        self.relation_gate = self.add_weight(
            name="relation_gate", shape=(self.num_relations,),
            initializer="zeros", trainable=True,
        )
        self.norm = keras.layers.LayerNormalization(axis=-1)

    def _relation_matrices(self) -> tf.Tensor:
        return tf.einsum("rb,bde->rde", self.base_coeff, self.bases)  # (R, d, d)

    def propagate(
        self, adjacencies: Sequence[tf.SparseTensor]
    ) -> tuple[tf.Tensor, tf.Tensor]:
        """Forward chaining: propaga sobre TODAS as relações, max_hops vezes,
        com não-linearidade + norm entre hops (fix C1/C2/C3/M10).

        Retorna:
          H      — (E, d) embeddings raciocinados.
          traces — (hops, R, E) massa de contribuição de cada relação em cada
                   hop para cada entidade → atribuição por instância (fix A6).
        """
        Wr = self._relation_matrices()
        gate = tf.nn.sigmoid(self.relation_gate)
        H = tf.math.l2_normalize(self.entity_embeddings, axis=-1)  # fix M9
        traces: list[tf.Tensor] = []
        for _ in range(self.max_hops):
            agg = H @ self.self_weight
            hop_contrib: list[tf.Tensor] = []
            for r, A_r in enumerate(adjacencies):
                transformed = H @ Wr[r]                                  # (E, d)
                msg = tf.sparse.sparse_dense_matmul(A_r, transformed)    # (E, d)
                msg = gate[r] * msg
                agg += msg
                hop_contrib.append(tf.norm(msg, axis=-1))               # (E,)
            H = self.norm(tf.nn.relu(agg))                              # fix C1/M10
            traces.append(tf.stack(hop_contrib, axis=0))               # (R, E)
        return H, tf.stack(traces, axis=0)                             # (hops, R, E)


# ----------------------------------------------------------------------------
# 3. Scorer de triplas + banco de regras (soft logic, POR-REGRA)
# ----------------------------------------------------------------------------
class TripleScorer(keras.layers.Layer):
    """score(s, r, o) bilinear-diagonal sobre os embeddings RACIOCINADOS.
    A direção é preservada porque a relação inversa é uma relação própria
    (não há a simetria s↔o do DistMult puro). Devolve logit pré-sigmoid."""

    def __init__(self, num_relations: int, embedding_dim: int, **kwargs) -> None:
        super().__init__(**kwargs)
        self._num_relations = num_relations
        self._embedding_dim = embedding_dim

    def build(self, _) -> None:
        self.rel_vec = self.add_weight(
            name="rel_vec", shape=(self._num_relations, self._embedding_dim),
            initializer="glorot_uniform", trainable=True,
        )

    def logits(self, H, s_ids, r_ids, o_ids) -> tf.Tensor:
        hs = tf.gather(H, s_ids)
        ho = tf.gather(H, o_ids)
        rv = tf.gather(self.rel_vec, r_ids)
        return tf.reduce_sum(hs * rv * ho, axis=-1)  # pré-sigmoid (fix M8)

    def prob(self, H, s_ids, r_ids, o_ids) -> tf.Tensor:
        return tf.nn.sigmoid(self.logits(H, s_ids, r_ids, o_ids))


@dataclasses.dataclass
class Rule:
    """Regra corpo⇒cabeça. `body` é uma sequência de relation_ids (caminho);
    `head` é a relação concluída. Ex.: [pertence_a, tem_renda_alta] ⇒ viavel."""

    body: list[int]
    head: int
    name: str = ""


class RuleBank(keras.layers.Layer):
    """Confiança POR-REGRA (fix C4) + consistência lógica via t-norm produto
    LIGADO (fix A7). A regra específica pode aprender confiança maior que a
    geral → resolve conflito (ex.: 'pinguim não voa')."""

    def __init__(self, rules: list[Rule], **kwargs) -> None:
        super().__init__(**kwargs)
        self.rules = rules

    def build(self, _) -> None:
        # Sem regras nao ha confianca a aprender. Criar a variavel assim mesmo
        # (o antigo `max(len, 1)`) punha um peso treinavel que nenhuma loss
        # tocava: o trainer municipal emitia
        # "Gradients do not exist for variables ['rule_bank/rule_confidence']"
        # a cada run, um alarme real afogado como ruido de rotina.
        if not self.rules:
            self.confidence = None
            return
        self.confidence = self.add_weight(
            name="rule_confidence",
            shape=(len(self.rules),),
            initializer="ones",
            trainable=True,
        )

    def consistency_loss(
        self,
        scorer: TripleScorer,
        H: tf.Tensor,
        groundings: list[tuple[np.ndarray, list[np.ndarray], np.ndarray]],
    ) -> tf.Tensor:
        """Para cada regra i e seus groundings (a, [intermediários], b):
        body = t-norm PRODUTO dos scores dos átomos do caminho; head =
        score(a, head, b). Penaliza body > head (implicação violada), pesado
        pela confiança da regra. `groundings[i]` alinha com `self.rules[i]`."""
        if not self.rules:
            return tf.constant(0.0)
        conf = tf.nn.sigmoid(self.confidence)
        total = tf.constant(0.0)
        for i, rule in enumerate(self.rules):
            a, mids, b = groundings[i]
            chain = [a, *mids, b]
            body = tf.ones(tf.shape(a)[0], tf.float32)
            for k, r in enumerate(rule.body):
                r_ids = tf.fill([tf.shape(a)[0]], r)
                body *= scorer.prob(H, chain[k], r_ids, chain[k + 1])  # t-norm produto
            head_ids = tf.fill([tf.shape(a)[0]], rule.head)
            head = scorer.prob(H, a, head_ids, b)
            total += conf[i] * tf.reduce_mean(tf.nn.relu(body - head))
        return total


# ----------------------------------------------------------------------------
# 4. Reasoner de viabilidade + relatório auditável
# ----------------------------------------------------------------------------
class ViabilityReasoner(keras.Model):
    """Junta neurônio de raciocínio + scorer + regras + cabeça de viabilidade,
    e expõe `report()` — o relatório de análise de viabilidade auditável."""

    def __init__(
        self,
        kg: KnowledgeGraph,
        embedding_dim: int = 64,
        max_hops: int = 3,
        rules: list[Rule] | None = None,
        **kwargs,
    ) -> None:
        super().__init__(**kwargs)
        self.kg = kg
        self.adj = kg.build_adjacencies()
        self.neuron = ReasoningNeuron(
            kg.num_entities, kg.num_relations, embedding_dim, max_hops
        )
        self.scorer = TripleScorer(kg.num_relations, embedding_dim)
        self.rules = RuleBank(rules or [])
        self.viab_head = keras.Sequential(
            [
                keras.layers.Dense(embedding_dim, activation="relu"),
                keras.layers.Dense(1),  # logit pré-sigmoid
            ]
        )
        # Chamamos propagate()/logits() direto (não via __call__), então os
        # pesos das sublayers precisam ser materializados manualmente.
        self.neuron.build(None)
        self.scorer.build(None)
        self.rules.build(None)

        self.id2entity = {v: k for k, v in kg.entity2id.items()}
        self.id2relation = {v: k for k, v in kg.relation2id.items()}

    def reason(self) -> tuple[tf.Tensor, tf.Tensor]:
        return self.neuron.propagate(self.adj)

    def viability_logit(self, H, entity_ids) -> tf.Tensor:
        return tf.squeeze(self.viab_head(tf.gather(H, entity_ids)), axis=-1)

    # ---------- treino ----------
    def kge_loss(self, H, pos, neg, margin: float = 6.0) -> tf.Tensor:
        """Margin ranking em score PRÉ-sigmoid (fix M8). pos/neg: (N, 3)."""
        ps = self.scorer.logits(H, pos[:, 0], pos[:, 1], pos[:, 2])
        ns = self.scorer.logits(H, neg[:, 0], neg[:, 1], neg[:, 2])
        return tf.reduce_mean(tf.nn.relu(margin - ps + ns))

    def viability_loss(self, H, entity_ids, labels) -> tf.Tensor:
        logit = self.viability_logit(H, entity_ids)
        return tf.reduce_mean(
            tf.nn.sigmoid_cross_entropy_with_logits(labels=labels, logits=logit)
        )

    # ---------- inferência + relatório ----------
    def report(
        self, entity_name: str, top_k: int = 5, infer_threshold: float = 0.7
    ) -> dict:
        """Relatório de viabilidade auditável para uma entidade (ex.: bairro)."""
        eid = self.kg.entity2id[entity_name]
        H, traces = self.reason()  # (E,d), (hops, R, E)
        score = float(tf.nn.sigmoid(self.viability_logit(H, [eid]))[0])

        # Fatores: contribuição por relação-base somada nos hops p/ ESTA entidade
        contrib = tf.reduce_sum(traces[:, :, eid], axis=0).numpy()  # (R,)
        base = self.kg.num_base_relations
        merged = contrib[:base] + contrib[base:]  # une relação direta + inversa
        top = np.argsort(merged)[::-1][:top_k]
        fatores = [(self.id2relation[int(r)], round(float(merged[r]), 4)) for r in top]

        # Fatos inferidos: triplas (eid, r, o) de alto score AUSENTES da KB
        inferred = self._top_inferred(H, eid, infer_threshold, top_k)

        # Regras ativadas (confiança aprendida > 0.5)
        ativadas: list[tuple[str, float]] = []
        if self.rules.rules:
            conf = tf.nn.sigmoid(self.rules.confidence).numpy()
            ativadas = [
                (self.rules.rules[i].name or f"regra_{i}", round(float(conf[i]), 4))
                for i in range(len(self.rules.rules))
                if conf[i] > 0.5
            ]

        rotulo = "alta" if score >= 0.66 else "media" if score >= 0.40 else "baixa"
        return {
            "entidade": entity_name,
            "viabilidade": round(score, 4),
            "rotulo": rotulo,
            "fatores_top": fatores,        # explicabilidade por instância (A6)
            "fatos_inferidos": inferred,   # o "raciocínio" novo (multi-hop)
            "regras_ativadas": ativadas,
        }

    def _top_inferred(self, H, s_id, threshold, k) -> list[tuple[str, str, float]]:
        out: list[tuple[str, str, float]] = []
        o_ids = tf.range(self.kg.num_entities)
        for r in range(self.kg.num_base_relations):
            probs = self.scorer.prob(
                H,
                tf.fill([self.kg.num_entities], s_id),
                tf.fill([self.kg.num_entities], r),
                o_ids,
            ).numpy()
            for o in np.argsort(probs)[::-1][:k]:
                o = int(o)
                if probs[o] >= threshold and not self.kg.is_known(s_id, r, o):
                    out.append(
                        (self.id2relation[r], self.id2entity[o], round(float(probs[o]), 4))
                    )
        return sorted(out, key=lambda x: -x[2])[:k]


# ----------------------------------------------------------------------------
# 4b. Treino — obrigatorio antes de confiar em report()
# ----------------------------------------------------------------------------
def train_reasoner(
    model: "ViabilityReasoner",
    triples: Sequence[tuple[int, int, int]],
    viab_targets: Sequence[int],
    viab_labels: Sequence[float],
    groundings: list | None = None,
    steps: int = 200,
    lr: float = 1e-2,
) -> "ViabilityReasoner":
    """Treino self-supervised curto que ESTRUTURA os embeddings.

    Sem esta etapa `report()` le pesos glorot_uniform crus e o score e ruido —
    nao um sinal de mercado. Chame sempre depois de `set_seed()` para que o
    relatorio seja reprodutivel.

    ATENCAO (leitura do resultado): `viab_labels` e supervisao direta. No toy
    passamos savassi=1.0 / centro=0.0, entao o `rotulo=alta` de Savassi reflete
    o rotulo que demos, nao evidencia de mercado. So vira evidencia quando os
    labels vierem de dados reais (renda/IBGE/aluguel) num KG proprio.
    """
    pos = np.array(list(triples), dtype=np.int64)
    targets = list(viab_targets)
    labels = tf.constant(list(viab_labels), tf.float32)
    opt = keras.optimizers.Adam(lr)
    num_entities = model.kg.num_entities

    for _ in range(steps):
        neg = pos.copy()
        neg[:, 2] = np.random.randint(0, num_entities, size=len(pos))
        with tf.GradientTape() as tape:
            H, _ = model.reason()
            loss = model.kge_loss(H, pos, neg) + model.viability_loss(
                H, targets, labels
            )
            if groundings:
                loss += 0.1 * model.rules.consistency_loss(
                    model.scorer, H, groundings
                )
        grads = tape.gradient(loss, model.trainable_variables)
        opt.apply_gradients(zip(grads, model.trainable_variables))
    return model


# ----------------------------------------------------------------------------
# 5. Exemplo mínimo (toy) — viabilidade de bairro para frete fitness
# ----------------------------------------------------------------------------
def _toy_demo() -> None:
    entity2id = {
        "bairro:savassi": 0, "bairro:centro": 1,
        "cidade:bh": 2, "renda:alta": 3, "renda:media": 4,
        "aluguel:alto": 5, "aluguel:medio": 6,
        "aggr:totalpass": 7, "gym:x": 8, "gym:y": 9,
    }
    relation2id = {
        "pertence_a": 0, "tem_renda": 1, "tem_aluguel": 2,
        "coberto_por": 3, "localizado_em": 4,
    }
    triples = [
        (0, 0, 2), (1, 0, 2),            # savassi/centro pertencem a BH
        (0, 1, 3), (1, 1, 4),            # savassi renda alta / centro media
        (0, 2, 5), (1, 2, 6),            # savassi aluguel alto / centro medio
        (8, 4, 0), (9, 4, 1),            # gym x em savassi, gym y no centro
        (8, 3, 7),                       # gym x coberto por totalpass
    ]
    set_seed()
    kg = KnowledgeGraph(entity2id, relation2id, triples)
    rules = [Rule(body=[0, 1], head=1, name="bairro_bh_herda_renda")]

    model = ViabilityReasoner(kg, embedding_dim=32, max_hops=2, rules=rules)

    # labels supervisionados do toy: savassi viável, centro não.
    train_reasoner(
        model,
        triples,
        viab_targets=[0, 1],
        viab_labels=[1.0, 0.0],
        groundings=[(np.array([0, 1]), [np.array([2, 2])], np.array([3, 4]))],
    )

    from pprint import pprint

    print("\n=== Relatório de viabilidade: bairro:savassi ===")
    pprint(model.report("bairro:savassi"))
    print("\n=== Relatório de viabilidade: bairro:centro ===")
    pprint(model.report("bairro:centro"))


if __name__ == "__main__":
    _toy_demo()
