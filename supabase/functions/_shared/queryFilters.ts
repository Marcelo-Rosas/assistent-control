/**
 * Heuristic query filter extraction for TotalPass RAG (Orchestrated Workflow stage 1).
 * Pure — no I/O. Self-contained for Edge bundling.
 */

export type QueryFilters = {
  municipio: string | null;
  modalidade: string | null;
  plano_rank: number | null;
  confidence: number;
};

// Longer aliases first to avoid partial matches (e.g., "sao jose" before "sao")
const MUNICIPIOS: Array<{ alias: string; label: string; wholeWord?: boolean }> = [
  { alias: 'sao jose dos campos', label: 'São José dos Campos' },
  { alias: 'sao jose do rio preto', label: 'São José do Rio Preto' },
  { alias: 'sao bernardo do campo', label: 'São Bernardo do Campo' },
  { alias: 'rio de janeiro', label: 'Rio de Janeiro' },
  { alias: 'belo horizonte', label: 'Belo Horizonte' },
  { alias: 'porto alegre', label: 'Porto Alegre' },
  { alias: 'campo grande', label: 'Campo Grande' },
  { alias: 'joao pessoa', label: 'João Pessoa' },
  { alias: 'boa vista', label: 'Boa Vista' },
  { alias: 'rio branco', label: 'Rio Branco' },
  { alias: 'santo andre', label: 'Santo André' },
  { alias: 'ribeirao preto', label: 'Ribeirão Preto' },
  { alias: 'sao paulo', label: 'São Paulo' },
  { alias: 'sao luis', label: 'São Luís' },
  { alias: 'florianopolis', label: 'Florianópolis' },
  { alias: 'campinas', label: 'Campinas' },
  { alias: 'curitiba', label: 'Curitiba' },
  { alias: 'salvador', label: 'Salvador' },
  { alias: 'fortaleza', label: 'Fortaleza' },
  { alias: 'recife', label: 'Recife' },
  { alias: 'brasilia', label: 'Brasília' },
  { alias: 'goiania', label: 'Goiânia' },
  { alias: 'manaus', label: 'Manaus' },
  { alias: 'belem', label: 'Belém' },
  { alias: 'vitoria', label: 'Vitória' },
  { alias: 'teresina', label: 'Teresina' },
  { alias: 'natal', label: 'Natal' },
  { alias: 'maceio', label: 'Maceió' },
  { alias: 'aracaju', label: 'Aracaju' },
  { alias: 'cuiaba', label: 'Cuiabá' },
  { alias: 'palmas', label: 'Palmas' },
  { alias: 'macapa', label: 'Macapá' },
  { alias: 'sorocaba', label: 'Sorocaba' },
  { alias: 'santos', label: 'Santos' },
  { alias: 'osasco', label: 'Osasco' },
  { alias: 'guarulhos', label: 'Guarulhos' },
  { alias: 'piracicaba', label: 'Piracicaba' },
  { alias: 'bauru', label: 'Bauru' },
  { alias: 'jundiai', label: 'Jundiaí' },
  { alias: 'sampa', label: 'São Paulo' },
  { alias: 'floripa', label: 'Florianópolis' },
  // Short aliases — whole word only
  { alias: 'cps', label: 'Campinas', wholeWord: true },
  { alias: 'sjc', label: 'São José dos Campos', wholeWord: true },
  { alias: 'poa', label: 'Porto Alegre', wholeWord: true },
  { alias: 'ssa', label: 'Salvador', wholeWord: true },
  { alias: 'bsb', label: 'Brasília', wholeWord: true },
  { alias: 'gyn', label: 'Goiânia', wholeWord: true },
  { alias: 'bh', label: 'Belo Horizonte', wholeWord: true },
  { alias: 'rj', label: 'Rio de Janeiro', wholeWord: true },
  { alias: 'rp', label: 'Ribeirão Preto', wholeWord: true },
  { alias: 'sp', label: 'São Paulo', wholeWord: true },
];

const MODALIDADES: Array<{ re: RegExp; label: string }> = [
  { re: /\bmuay\s*thai\b/i, label: 'muay_thai' },
  { re: /\bjiu[-\s]?jitsu\b|\bbjj\b/i, label: 'jiu_jitsu' },
  { re: /\bpole\s*dance\b|\bpole\b/i, label: 'pole_dance' },
  { re: /\bcross\s*fit\b|\bcrossfit\b/i, label: 'crossfit' },
  { re: /\bmuscula/i, label: 'musculacao' },
  { re: /\bspinning\b/i, label: 'spinning' },
  { re: /\bpilates\b/i, label: 'pilates' },
  { re: /\bnata[cç][aã]o\b|\bswim\b/i, label: 'natacao' },
  { re: /\bfuncional\b/i, label: 'funcional' },
  { re: /\byoga\b/i, label: 'yoga' },
  { re: /\bboxe\b/i, label: 'boxe' },
  { re: /\bdan[cç]a\b/i, label: 'danca' },
  { re: /\bbeach\s*tennis\b/i, label: 'beach_tennis' },
  { re: /\bfisio/i, label: 'fisioterapia' },
  { re: /\bspa\b/i, label: 'spa' },
];

const PLANOS: Array<{ alias: string; rank: number }> = [
  { alias: 'tp go', rank: 1 },
  { alias: 'tp5+', rank: 8 },
  { alias: 'tp 5+', rank: 8 },
  { alias: 'tp1+', rank: 3 },
  { alias: 'tp 1+', rank: 3 },
  { alias: 'tp2+', rank: 4 },
  { alias: 'tp 2+', rank: 4 },
  { alias: 'tp0', rank: 1 },
  { alias: 'tp7', rank: 10 },
  { alias: 'tp 7', rank: 10 },
  { alias: 'tp6', rank: 9 },
  { alias: 'tp 6', rank: 9 },
  { alias: 'tp5', rank: 7 },
  { alias: 'tp 5', rank: 7 },
  { alias: 'tp4', rank: 6 },
  { alias: 'tp 4', rank: 6 },
  { alias: 'tp3', rank: 5 },
  { alias: 'tp 3', rank: 5 },
  { alias: 'tp2', rank: 4 },
  { alias: 'tp 2', rank: 4 },
  { alias: 'tp1', rank: 2 },
  { alias: 'tp 1', rank: 2 },
];

function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function hasAlias(q: string, alias: string, wholeWord?: boolean): boolean {
  if (!wholeWord) return q.includes(alias);
  const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`(?:^|[^a-z0-9])${escaped}(?:[^a-z0-9]|$)`);
  return re.test(q);
}

export function extractQueryFilters(
  query: string,
  overrides?: {
    municipio?: string | null;
    modalidade?: string | null;
    plano_rank?: number | null;
  },
): QueryFilters {
  const q = normalize(query);

  let municipio: string | null = overrides?.municipio?.trim() || null;
  let modalidade: string | null = overrides?.modalidade?.trim() || null;
  let plano_rank: number | null =
    overrides?.plano_rank != null && Number.isFinite(Number(overrides.plano_rank))
      ? Number(overrides.plano_rank)
      : null;

  if (!municipio) {
    const interiorUf = /\binterior\s+de\s+(sp|rj|mg|pr|rs|ba|pe|ce|go|df)\b/.test(q);

    for (const { alias, label, wholeWord } of MUNICIPIOS) {
      if (interiorUf && (alias === 'sp' || alias === 'rj')) continue;
      if (hasAlias(q, alias, wholeWord)) {
        municipio = label;
        break;
      }
    }

    if (!municipio && /\bcapital\b/.test(q)) {
      if (/\bsp\b/.test(q) || /sao paulo/.test(q) || !/\b[a-z]{2}\b/.test(q.replace(/capital/g, ''))) {
        municipio = 'São Paulo';
      }
    }
  }

  if (!modalidade) {
    for (const { re, label } of MODALIDADES) {
      if (re.test(query)) {
        modalidade = label;
        break;
      }
    }
  }

  if (plano_rank == null) {
    if (/\btp\s*5\+/.test(q) || /\btp5\+/.test(q)) plano_rank = 8;
    else if (/\btp\s*1\+/.test(q) || /\btp1\+/.test(q)) plano_rank = 3;
    else if (/\btp\s*go\b/.test(q)) plano_rank = 1;
    else {
      for (const { alias, rank } of PLANOS) {
        if (hasAlias(q, alias, true) || q.includes(alias)) {
          if (
            alias.endsWith('+') ||
            !PLANOS.some((p) => p.alias !== alias && p.alias.startsWith(alias) && q.includes(p.alias))
          ) {
            plano_rank = rank;
            break;
          }
        }
      }
    }
  }

  const filled = [municipio, modalidade, plano_rank].filter((x) => x != null).length;
  const confidence = filled === 0 ? 0.1 : filled === 1 ? 0.6 : filled === 2 ? 0.75 : 0.9;

  return { municipio, modalidade, plano_rank, confidence };
}
