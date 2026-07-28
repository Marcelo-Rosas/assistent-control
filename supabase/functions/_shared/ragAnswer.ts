/**
 * WellhubRagAgent — formata resultados RAG em resposta legível.
 *
 * Objetivo: transformar chunks recuperados (match_chunks) em listagem por
 * modalidade + resumo por plano mínimo, corrigindo modalidade quando o nome
 * da academia contradiz o metadado do chunk (ex.: B.YOGAA → Yoga, não Musculação).
 *
 * Fontes: meta dos chunks (nome_academia, modalidade, plano_minimo, bairro, …)
 * e filtros da query (município).
 *
 * Pipeline: Percepção → Raciocínio → Memória (estado da requisição) → Ação.
  */

// =============================================================================
// Tipos
// =============================================================================

export type RagChunkMeta = Record<string, unknown>;

export type RagChunkLike = {
  chunk_id: string;
  meta: RagChunkMeta | null;
  score?: number;
  similarity?: number;
};

export type AgentInput = {
  chunks: RagChunkLike[];
  municipio?: string | null;
  aggregator?: 'wellhub' | 'totalpass' | 'unknown';
};

export type PerceivedGym = {
  gymId: string;
  nome: string;
  bairro: string | null;
  chunkModality: string;
  plano: string;
  planRank: number;
  valor: string | null;
  horario: string | null;
  score: number;
};

export type PerceivedContext = {
  aggregator: 'wellhub' | 'totalpass' | 'unknown';
  municipio: string | null;
  gyms: PerceivedGym[];
};

export type ResolvedGym = PerceivedGym & {
  effectiveModality: string;
  modalitySource: 'name' | 'chunk';
};

export type PlanBucket = {
  plan: string;
  rank: number;
  count: number;
  valor: string | null;
};

export type AgentMemory = {
  uniqueGyms: Map<string, ResolvedGym>;
  byModality: Map<string, Map<string, ResolvedGym>>;
  planBuckets: Map<string, PlanBucket>;
};

export type ReasonedState = {
  memory: AgentMemory;
  totalUnique: number;
};

// =============================================================================
// Utilitários
// =============================================================================

function metaStr(meta: RagChunkMeta, key: string): string | null {
  const v = meta[key];
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

function metaNum(meta: RagChunkMeta, key: string): number | null {
  const v = meta[key];
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim()) {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function chunkScore(c: RagChunkLike): number {
  return Number(c.similarity ?? c.score ?? 0);
}

function horarioFromWarning(warning: string | null): string | null {
  if (!warning) return null;
  const m = warning.match(/Horário:\s*([^|]+)/i);
  return m?.[1]?.trim() || null;
}

// =============================================================================
// Raciocínio — modalidade pelo nome (prioridade sobre chunk)
// =============================================================================

/** Regras nome → modalidade. Ordem = prioridade decrescente. */
const NAME_MODALITY_RULES: Array<{ test: (name: string) => boolean; modality: string }> = [
  { test: (n) => /\byogaa?\b/i.test(n) || /\.yoga/i.test(n) || /\byoga\b/i.test(n), modality: 'yoga' },
  { test: (n) => /\bpilates\b/i.test(n), modality: 'pilates' },
  { test: (n) => /\bcross\s*fit\b|\bcrossfit\b/i.test(n), modality: 'crossfit' },
  { test: (n) => /\bmuay\s*thai\b/i.test(n), modality: 'muay_thai' },
  { test: (n) => /\bjiu[-\s]?jitsu\b|\bbjj\b/i.test(n), modality: 'jiu_jitsu' },
  { test: (n) => /\bboxe\b/i.test(n), modality: 'boxe' },
  { test: (n) => /\bnata[cç][aã]o\b/i.test(n), modality: 'natacao' },
  { test: (n) => /\bdance\b|\bdança\b|\bdanca\b/i.test(n), modality: 'danca' },
  { test: (n) => /\bfuncional\b/i.test(n), modality: 'funcional' },
  { test: (n) => /\bspinning\b/i.test(n), modality: 'spinning' },
];

export function inferModalityFromName(gymName: string): string | null {
  const normalized = gymName.normalize('NFD').replace(/\p{M}/gu, '');
  for (const rule of NAME_MODALITY_RULES) {
    if (rule.test(normalized)) return rule.modality;
  }
  return null;
}

export function resolveEffectiveModality(
  nome: string,
  chunkModality: string,
): { modality: string; source: 'name' | 'chunk' } {
  const fromName = inferModalityFromName(nome);
  const chunk = chunkModality.toLowerCase() || 'academia_geral';

  if (fromName && fromName !== chunk) {
    return { modality: fromName, source: 'name' };
  }
  return { modality: chunk, source: 'chunk' };
}

// =============================================================================
// Labels e ordenação
// =============================================================================

const MODALITY_LABELS: Record<string, string> = {
  musculacao: 'Musculação',
  funcional: 'Funcional',
  pilates: 'Pilates',
  yoga: 'Yoga',
  crossfit: 'CrossFit',
  muay_thai: 'Muay Thai',
  jiu_jitsu: 'Jiu-Jitsu',
  boxe: 'Boxe',
  natacao: 'Natação',
  danca: 'Dança',
  spinning: 'Spinning',
  academia_geral: 'Academia',
};

const MODALITY_ORDER = [
  'musculacao',
  'funcional',
  'crossfit',
  'pilates',
  'yoga',
  'muay_thai',
  'jiu_jitsu',
  'boxe',
  'natacao',
  'danca',
  'spinning',
  'academia_geral',
];

function modalityLabel(key: string): string {
  const k = key.toLowerCase().replace(/[^a-z0-9_]/g, '_');
  return MODALITY_LABELS[k] || key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function modalitySortIndex(key: string): number {
  const i = MODALITY_ORDER.indexOf(key);
  return i === -1 ? 99 : i;
}

// =============================================================================
// Agregador de planos (memória + raciocínio)
// =============================================================================

function upsertGym(
  map: Map<string, ResolvedGym>,
  gym: ResolvedGym,
): void {
  const prev = map.get(gym.gymId);
  if (!prev || gym.score > prev.score) map.set(gym.gymId, gym);
}

function buildPlanBuckets(uniqueGyms: Iterable<ResolvedGym>): Map<string, PlanBucket> {
  const buckets = new Map<string, PlanBucket>();
  for (const g of uniqueGyms) {
    const cur = buckets.get(g.plano) ?? {
      plan: g.plano,
      rank: g.planRank,
      count: 0,
      valor: null,
    };
    cur.count += 1;
    cur.rank = Math.min(cur.rank, g.planRank);
    if (g.valor && g.valor !== 'N/A') cur.valor = g.valor;
    buckets.set(g.plano, cur);
  }
  return buckets;
}

// =============================================================================
// WellhubRagAgent
// =============================================================================

export class WellhubRagAgent {
  /** Percepção: chunks → estrutura normalizada. */
  perceive(input: AgentInput): PerceivedContext {
    const aggregator = input.aggregator ?? detectAggregator(input.chunks);
    const gyms: PerceivedGym[] = [];

    for (const c of input.chunks) {
      const meta = c.meta || {};
      const gymId = metaStr(meta, 'gym_id') || metaStr(meta, 'nome_academia') || c.chunk_id;
      const nome = metaStr(meta, 'nome_academia') || gymId;

      gyms.push({
        gymId,
        nome,
        bairro: metaStr(meta, 'bairro'),
        chunkModality: (metaStr(meta, 'modalidade') || 'academia_geral').toLowerCase(),
        plano: metaStr(meta, 'plano_minimo') || 'Plano não informado',
        planRank: metaNum(meta, 'plano_minimo_rank') ?? 99,
        valor: metaStr(meta, 'valor_plano_minimo'),
        horario: horarioFromWarning(metaStr(meta, 'warning_message')),
        score: chunkScore(c),
      });
    }

    return {
      aggregator,
      municipio: input.municipio?.trim() || null,
      gyms,
    };
  }

  /** Raciocínio: resolve modalidade + monta memória de agrupamento. */
  reason(ctx: PerceivedContext): ReasonedState {
    const byModality = new Map<string, Map<string, ResolvedGym>>();
    const uniqueGyms = new Map<string, ResolvedGym>();

    for (const g of ctx.gyms) {
      const { modality, source } = resolveEffectiveModality(g.nome, g.chunkModality);
      const resolved: ResolvedGym = { ...g, effectiveModality: modality, modalitySource: source };

      if (!byModality.has(modality)) byModality.set(modality, new Map());
      upsertGym(byModality.get(modality)!, resolved);

      const prevUnique = uniqueGyms.get(g.gymId);
      if (!prevUnique || g.planRank < prevUnique.planRank) {
        uniqueGyms.set(g.gymId, resolved);
      }
    }

    const planBuckets = buildPlanBuckets(uniqueGyms.values());

    return {
      memory: { uniqueGyms, byModality, planBuckets },
      totalUnique: uniqueGyms.size,
    };
  }

  /** Ação: renderiza texto final. */
  act(ctx: PerceivedContext, state: ReasonedState): string {
    if (!ctx.gyms.length) {
      return 'Não encontrei academias Wellhub no catálogo para essa busca.';
    }

    const intro = ctx.municipio
      ? `Academias em ${ctx.municipio} que aceitam Wellhub (resultados recuperados):`
      : 'Academias que aceitam Wellhub (resultados recuperados):';

    const sections: string[] = [intro, '', formatPlanSummary(state), ''];

    const modKeys = [...state.memory.byModality.keys()].sort(
      (a, b) => modalitySortIndex(a) - modalitySortIndex(b),
    );

    for (const modKey of modKeys) {
      const gyms = [...(state.memory.byModality.get(modKey)?.values() ?? [])].sort((a, b) =>
        a.nome.localeCompare(b.nome, 'pt-BR'),
      );
      if (!gyms.length) continue;

      sections.push(modalityLabel(modKey));
      for (const g of gyms) {
        const local = g.bairro ? ` (${g.bairro})` : '';
        const hor = g.horario ? ` | Horário: ${g.horario}` : '';
        sections.push(`${g.nome}${local} — ${g.plano}${hor}`);
      }
      sections.push('');
    }

    return sections.join('\n').trim();
  }

  /** Pipeline completo: percepção → raciocínio → ação. */
  run(input: AgentInput): string {
    const perceived = this.perceive(input);
    const reasoned = this.reason(perceived);
    return this.act(perceived, reasoned);
  }
}

function formatPlanSummary(state: ReasonedState): string {
  const sorted = [...state.memory.planBuckets.values()].sort((a, b) => a.rank - b.rank);
  const lines = sorted.map((b) => {
    const price = b.valor && b.valor !== 'N/A' ? ` (valor referência: ${b.valor})` : '';
    return `${b.plan}: ${b.count} academia(s)${price}`;
  });

  return [
    `Total: ${state.totalUnique} academia(s) única(s) nos resultados recuperados.`,
    'Por plano mínimo Wellhub:',
    ...lines,
  ].join('\n');
}

// =============================================================================
// API pública (compatibilidade knowledge-ask)
// =============================================================================

export function detectAggregator(chunks: RagChunkLike[]): 'wellhub' | 'totalpass' | 'unknown' {
  for (const c of chunks) {
    const agg = metaStr(c.meta || {}, 'aggregator');
    if (agg === 'wellhub') return 'wellhub';
    if (agg === 'totalpass' || metaStr(c.meta || {}, 'domain') === 'totalpass') return 'totalpass';
  }
  return 'unknown';
}

export function buildRetrievalSummary(chunks: RagChunkLike[]): string {
  const agent = new WellhubRagAgent();
  const perceived = agent.perceive({ chunks, aggregator: 'wellhub' });
  const reasoned = agent.reason(perceived);
  return formatPlanSummary(reasoned);
}

export function buildWellhubAnswer(
  chunks: RagChunkLike[],
  opts?: { municipio?: string | null },
): string {
  return new WellhubRagAgent().run({ chunks, municipio: opts?.municipio });
}

export const WELLHUB_FORMAT_RULES = `
FORMATO DE RESPOSTA WELLHUB (obrigatório, texto puro):
Resumo por plano + lista por modalidade. Sem markdown.`;

export const TOTALPASS_FORMAT_RULES = `
FORMATO DE RESPOSTA TOTALPASS (texto puro):
1. Nome da Academia
Município: ... | Modalidade: ...
Endereço: ...
Planos: ...
Sem markdown, asteriscos, colchetes ou links.`;

// =============================================================================
// Testes embutidos (rodar: npx tsx scripts/validate-rag-answer.ts)
// =============================================================================

export type RagAnswerTestCase = {
  name: string;
  nome: string;
  chunkModality: string;
  expectedModality: string;
  expectedSource: 'name' | 'chunk';
};

export const MODALITY_RESOLVER_TESTS: RagAnswerTestCase[] = [
  {
    name: 'B.YOGAA não é musculação',
    nome: 'B.YOGAA',
    chunkModality: 'musculacao',
    expectedModality: 'yoga',
    expectedSource: 'name',
  },
  {
    name: 'Gaviões mantém musculação do chunk',
    nome: 'Academia Gaviões - Paulista',
    chunkModality: 'musculacao',
    expectedModality: 'musculacao',
    expectedSource: 'chunk',
  },
  {
    name: 'Studio Pilates pelo nome',
    nome: 'Studio Core Pilates',
    chunkModality: 'musculacao',
    expectedModality: 'pilates',
    expectedSource: 'name',
  },
  {
    name: 'Poz-E Dance pelo nome',
    nome: 'Poz-E Dance Studio',
    chunkModality: 'academia_geral',
    expectedModality: 'danca',
    expectedSource: 'name',
  },
];

export function runModalityResolverTests(): { ok: number; fail: number; errors: string[] } {
  let ok = 0;
  let fail = 0;
  const errors: string[] = [];

  for (const tc of MODALITY_RESOLVER_TESTS) {
    const { modality, source } = resolveEffectiveModality(tc.nome, tc.chunkModality);
    if (modality === tc.expectedModality && source === tc.expectedSource) {
      ok += 1;
    } else {
      fail += 1;
      errors.push(
        `${tc.name}: esperado ${tc.expectedModality}/${tc.expectedSource}, obteve ${modality}/${source}`,
      );
    }
  }
  return { ok, fail, errors };
}
