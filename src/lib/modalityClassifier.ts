/**
 * Classificador de modalidade TotalPass — camadas: regras → tipo → preço → llm_fallback.
 * Função pura (sem I/O). Taxonomia fechada.
 */

export const MODALITY_TAXONOMY = {
  MUSCULACAO: 'musculacao',
  FUNCIONAL: 'funcional',
  JIU_JITSU: 'jiu_jitsu',
  MUAY_THAI: 'muay_thai',
  CAPOEIRA: 'capoeira',
  LUTAS: 'lutas',
  DANCA: 'danca',
  POLE_DANCE: 'pole_dance',
  PILATES: 'pilates',
  YOGA: 'yoga',
  FISIOTERAPIA: 'fisioterapia',
  NATACAO: 'natacao',
  SPA: 'spa',
  MASSOTERAPIA: 'massoterapia',
  ESTETICA: 'estetica',
  TENIS: 'tenis',
  BEACH_TENNIS: 'beach_tennis',
  MEDITACAO: 'meditacao',
  ACADEMIA_GERAL: 'academia_geral',
  CLINICA: 'clinica',
  DESCONHECIDA: 'desconhecida',
} as const;

export type Modality = (typeof MODALITY_TAXONOMY)[keyof typeof MODALITY_TAXONOMY];

export type ClassificationResult = {
  modality: Modality;
  confidence: number;
  method: 'rule' | 'llm_fallback';
};

type Rule = { patterns: RegExp[]; modality: Modality; priority: number };

/** Prioridade: lutas/especializadas > dança/pilates > academia_geral */
const RULES: Rule[] = [
  { patterns: [/jiu[-\s]?jitsu/i, /bjj/i, /gracie/i], modality: 'jiu_jitsu', priority: 95 },
  { patterns: [/muay[-\s]?thai/i, /thai[-\s]?boxe/i, /thaitonns/i], modality: 'muay_thai', priority: 95 },
  { patterns: [/capoeira/i], modality: 'capoeira', priority: 95 },
  { patterns: [/pole\s*dance/i, /poledance/i], modality: 'pole_dance', priority: 95 },
  { patterns: [/pilates/i], modality: 'pilates', priority: 90 },
  { patterns: [/yoga/i, /yogashala/i], modality: 'yoga', priority: 90 },
  { patterns: [/swim/i, /nata[çc][aã]o/i, /piscina/i], modality: 'natacao', priority: 90 },
  {
    patterns: [/dance\s*studio/i, /dança/i, /danca/i, /corpo\s*de\s*baile/i, /samba/i],
    modality: 'danca',
    priority: 85,
  },
  { patterns: [/\bspa\b/i], modality: 'spa', priority: 85 },
  { patterns: [/massoterapia/i, /massagem/i], modality: 'massoterapia', priority: 85 },
  {
    patterns: [/fisioterap/i, /fisi[oô]/i, /reabilita[çc][aã]o/i, /quiroprax/i, /reab\s*clin/i],
    modality: 'fisioterapia',
    priority: 85,
  },
  { patterns: [/beach\s*tennis/i, /\bptc\b/i], modality: 'beach_tennis', priority: 85 },
  {
    patterns: [/dojo/i, /dojô/i, /artes\s*marciais/i, /fight\s*center/i, /moudak/i, /boxe/i],
    modality: 'lutas',
    priority: 80,
  },
  { patterns: [/t[eê]nis/i], modality: 'tenis', priority: 80 },
  { patterns: [/funcional/i, /treinamento\s*funcional/i], modality: 'funcional', priority: 80 },
  { patterns: [/medita[çc][aã]o/i, /mindfulness/i], modality: 'meditacao', priority: 75 },
  { patterns: [/est[eé]tica/i, /dermatolog/i], modality: 'estetica', priority: 75 },
  { patterns: [/cl[ií]nica/i], modality: 'clinica', priority: 70 },
  {
    patterns: [/academia/i, /\bfit\b/i, /\bgym\b/i, /smart\s*fit/i, /target\s*fit/i, /pro\s*\d+/i],
    modality: 'academia_geral',
    priority: 50,
  },
];

/**
 * Camada 1: regex por nome (prioridade).
 * Camada 2: tipo (studio / espaço bem-estar).
 * Camada 3: preço (>=500 spa, <=80 academia_geral).
 * Camada 4: desconhecida + method llm_fallback (LLM externo).
 */
export function classifyModality(
  nome: string,
  endereco: string,
  valorNumerico: number,
): ClassificationResult {
  const haystack = `${nome} ${endereco || ''}`;

  // Camada 1 — regras por nome (e endereço se útil)
  const matches = RULES.filter((r) => r.patterns.some((p) => p.test(haystack))).sort(
    (a, b) => b.priority - a.priority,
  );

  if (matches.length > 0 && matches[0].priority >= 70) {
    return {
      modality: matches[0].modality,
      confidence: matches[0].priority / 100,
      method: 'rule',
    };
  }

  // Camada 1b — academia_geral só se prioridade 50 e nada mais forte
  if (matches.length > 0 && matches[0].modality === 'academia_geral') {
    return {
      modality: 'academia_geral',
      confidence: matches[0].priority / 100,
      method: 'rule',
    };
  }

  // Camada 2 — refinamento por tipo no nome
  if (/\bstudio\b/i.test(nome)) {
    return { modality: 'pilates', confidence: 0.6, method: 'rule' };
  }
  if (/\bespa[çc]o\b/i.test(nome) && /bem[\s-]?estar/i.test(nome)) {
    return { modality: 'pilates', confidence: 0.5, method: 'rule' };
  }

  // Camada 3 — preço (heurística fraca)
  if (Number.isFinite(valorNumerico) && valorNumerico >= 500) {
    return { modality: 'spa', confidence: 0.4, method: 'rule' };
  }
  if (Number.isFinite(valorNumerico) && valorNumerico > 0 && valorNumerico <= 80) {
    return { modality: 'academia_geral', confidence: 0.4, method: 'rule' };
  }

  // Camada 4 — LLM externo (lote / edge); aqui só sinaliza
  return { modality: 'desconhecida', confidence: 0, method: 'llm_fallback' };
}

/** TP plan → numeric rank for `match_plano_rank` filter (<=). */
export const PLANO_RANK: Record<string, number> = {
  'TP GO': 1,
  'TP 1': 2,
  'TP 1+': 3,
  'TP 2': 4,
  'TP 3': 5,
  'TP 4': 6,
  'TP 5': 7,
  'TP 5+': 8,
  'TP 6': 9,
  'TP 7': 10,
};

export function parseValor(valorStr: string): number {
  const match = String(valorStr || '').match(/[\d.,]+/);
  if (!match) return 0;
  return parseFloat(match[0].replace(/\./g, '').replace(',', '.'));
}

/** Strip accents + slug bairro for meta.bairro_normalizado */
export function normalizeBairro(bairro: string): string {
  return String(bairro || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

/** Slug modality label → taxonomy-ish key (muay_thai). */
export function modalityToMetaKey(nome: string): string {
  return String(nome || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '');
}
