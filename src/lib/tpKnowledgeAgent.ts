/** TotalPass local Q&A from tp_partner chunks. */

import type { KnowledgeChunk } from './knowledgeTypes';

export type TpPartner = {
  name: string;
  bairro?: string | null;
  plan_minimo?: string | null;
  price_brl_month?: number | null;
  slug?: string;
  url?: string;
};

const TP_RANK: Record<string, number> = {
  'tp free': 0,
  free: 0,
  'tp go': 1,
  go: 1,
  tp1: 2,
  'tp 1': 2,
  'tp1+': 3,
  'tp 1+': 3,
  tp2: 4,
  'tp 2': 4,
  tp3: 5,
  'tp 3': 5,
  tp4: 6,
  'tp 4': 6,
  tp5: 7,
  'tp 5': 7,
  'tp5+': 8,
  'tp 5+': 8,
  tp6: 9,
  'tp 6': 9,
  tp7: 10,
  'tp 7': 10,
};

export function normalizeTpPlan(plan: string | null | undefined): string {
  if (!plan) return '';
  return String(plan)
    .toLowerCase()
    .replace(/total\s*pass/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function tpRank(plan: string | null | undefined): number {
  const n = normalizeTpPlan(plan);
  if (TP_RANK[n] != null) return TP_RANK[n];
  const m = n.match(/tp\s*(\d+)/);
  if (m) return 1 + Number(m[1]); // rough
  return 99;
}

export function extractUserTpPlan(question: string): string | null {
  const ql = question.toLowerCase();
  const m = ql.match(/\btp\s*(\d+\+?)\b/i) || ql.match(/\btp\s*(go|free)\b/i);
  if (!m) return null;
  const raw = m[1].toLowerCase();
  if (raw === 'go' || raw === 'free') return `TP ${raw.toUpperCase() === 'GO' ? 'GO' : 'Free'}`;
  return `TP ${raw.toUpperCase()}`;
}

export function partnersFromChunks(chunks: KnowledgeChunk[]): TpPartner[] {
  const out: TpPartner[] = [];
  for (const c of chunks) {
    if (c.chunk_type !== 'tp_partner') continue;
    const p = c.meta?.partner as TpPartner | undefined;
    if (p?.name) out.push(p);
  }
  return out;
}

function fmt(p: TpPartner) {
  return `• ${p.name}${p.bairro ? ` (${p.bairro})` : ''} — ${p.plan_minimo || '?'} / R$${p.price_brl_month ?? '?'}`;
}

export function answerFromTpKnowledge(
  question: string,
  chunks: KnowledgeChunk[],
): { text: string; provider: string } {
  const partners = partnersFromChunks(chunks);
  const ql = question.toLowerCase();
  const userPlan = extractUserTpPlan(question);
  let list = partners.filter((p) => p.plan_minimo);

  if (!partners.length) {
    return {
      text: 'Sem partners TotalPass no índice. Faça upload de tp-partner-enrich-*.json ou artefato ingest TP.',
      provider: 'local-tp',
    };
  }

  if (userPlan) {
    const ur = tpRank(userPlan);
    list = list.filter((p) => tpRank(p.plan_minimo) <= ur);
  }

  if (/coco|cocó/.test(ql)) {
    const hits = list.filter((p) => /coco/i.test(p.bairro || p.name || ''));
    // Cocó enrich often has no bairro on partner — list all if question is TP+Cocó
    if (!hits.length && /total\s*pass|tp\b/.test(ql)) {
      return {
        text: `TotalPass (fixture Cocó / partners): ${list.length} academias${userPlan ? ` com ≤${userPlan}` : ''}\n${list.map(fmt).join('\n')}`,
        provider: 'local-tp',
      };
    }
    return {
      text: hits.length ? hits.map(fmt).join('\n') : 'Nenhum partner TP com bairro Cocó no meta.',
      provider: 'local-tp',
    };
  }

  if (/barat|mais barat|menor pre/.test(ql)) {
    const sorted = [...list].sort(
      (a, b) => (a.price_brl_month ?? 9e9) - (b.price_brl_month ?? 9e9),
    );
    const t = sorted[0];
    return {
      text: t ? `Mais barata no filtro:\n${fmt(t)}` : 'Nenhuma no filtro.',
      provider: 'local-tp',
    };
  }

  const catalog = chunks.find((c) => c.chunk_type === 'tp_catalog');
  if (/valor|pre[cç]o|tabela|cat[aá]logo/.test(ql) && catalog) {
    return { text: catalog.text, provider: 'local-tp' };
  }

  if (/quais|lista|aceit|total\s*pass|\btp\b|academ/.test(ql) || userPlan) {
    const header = userPlan
      ? `TotalPass com ≤${userPlan}: ${list.length}/${partners.length}`
      : `TotalPass indexado: ${list.length} academias`;
    return {
      text: list.length ? `${header}\n${list.map(fmt).join('\n')}` : `${header}\n(nenhuma)`,
      provider: 'local-tp',
    };
  }

  return {
    text: catalog?.text || 'Pergunte: lista TotalPass, TP3, Cocó, ou preço tabela.',
    provider: 'local-tp',
  };
}
