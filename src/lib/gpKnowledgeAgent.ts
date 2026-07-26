/**
 * Deterministic Gurupass knowledge agent — answers from accept_list / chunks.
 * Used by UI Teste after Treinar & Publicar (no LLM required).
 */

import type { KnowledgeChunk } from './knowledgeTypes';

export type { KnowledgeChunk };

export type GpGym = {
  name: string;
  bairro?: string | null;
  cidade?: string | null;
  uf?: string | null;
  plano_minimo?: string | null;
  creditos_minimos?: number | null;
  valor_mensal_brl?: number | null;
  modalidades?: string[];
};

export const GP_AGENT_SYSTEM = `Tu és agente GymSite — Agregadores / Gurupass.
Regras:
- Responde só com dados indexados (não inventa academia).
- Gate: creditos_minimos <= user_credits quando o usuário informar plano.
- Preço = valor_mensal_brl do plano_minimo da academia.
- Se bairro sem hit, diga 0.
- Fonte: buscar-academias Gurupass.`;

export function parseCreditsFromPlan(planName: string | null | undefined): number | null {
  if (planName == null || planName === '') return null;
  const m = String(planName).match(/(\d+)/);
  return m ? Number(m[1]) : null;
}

export function extractUserCredits(question: string): number | null {
  const ql = question.toLowerCase();
  const named = ql.match(/ilimitado\s*(\d+)/i);
  if (named) return Number(named[1]);
  const cred = ql.match(/(\d+)\s*cr[eé]ditos?/i);
  if (cred) return Number(cred[1]);
  return null;
}

export function gymsFromChunks(chunks: KnowledgeChunk[]): GpGym[] {
  const gyms: GpGym[] = [];
  for (const c of chunks) {
    const meta = c.meta || {};
    if (meta.gym && typeof meta.gym === 'object') {
      gyms.push(meta.gym as GpGym);
      continue;
    }
    if (c.chunk_type === 'gp_gym' || meta.plano_minimo) {
      gyms.push({
        name: String(meta.name || c.chunk_id),
        bairro: (meta.bairro as string) || null,
        cidade: (meta.cidade as string) || null,
        uf: (meta.uf as string) || null,
        plano_minimo: (meta.plano_minimo as string) || null,
        creditos_minimos:
          typeof meta.creditos_minimos === 'number'
            ? meta.creditos_minimos
            : parseCreditsFromPlan(String(meta.plano_minimo || '')),
        valor_mensal_brl:
          typeof meta.valor_mensal_brl === 'number' ? meta.valor_mensal_brl : null,
        modalidades: Array.isArray(meta.modalidades) ? (meta.modalidades as string[]) : [],
      });
    }
  }
  return gyms;
}

function fmt(i: GpGym) {
  return `• ${i.name} (${i.bairro || '?'}) — ${i.plano_minimo || '?'} / R$${i.valor_mensal_brl ?? '?'}`;
}

/** Ilimitado N → R$ (R$4,95 / crédito; catálogo nacional GP). */
export function priceForCredits(credits: number): number {
  return Math.round(credits * 4.95 * 100) / 100;
}

function gymHasPlan(g: GpGym) {
  return (
    g.plano_minimo != null ||
    g.creditos_minimos != null ||
    g.valor_mensal_brl != null
  );
}

function filterByCredits(gyms: GpGym[], credits: number | null) {
  if (credits == null) return gyms;
  return gyms.filter((g) => {
    const c = g.creditos_minimos ?? parseCreditsFromPlan(g.plano_minimo);
    return c != null && c <= credits;
  });
}

export function answerFromGymKnowledge(
  question: string,
  chunks: KnowledgeChunk[],
): { text: string; provider: string } {
  const gyms = gymsFromChunks(chunks);
  const ql = question.toLowerCase();
  const userCredits = extractUserCredits(question);
  const withPlan = gyms.filter(gymHasPlan);
  const missingPlans = gyms.length > 0 && withPlan.length === 0;

  if (!gyms.length) {
    return {
      text: 'Agente publicado sem academias indexadas. Rode Treinar & Publicar (seed Fortaleza).',
      provider: 'local-gp',
    };
  }

  if (missingPlans) {
    return {
      text: `Índice inválido para planos: ${gyms.length} academias SEM plano_minimo/preço (seed sintético Cocó?).\nRe-treine: Treinar & Publicar SEM upload — usa /knowledge/gp-accept-fortaleza.json\nNomes no índice agora: ${gyms.map((g) => g.name).join('; ')}`,
      provider: 'local-gp',
    };
  }

  // "Qual o valor do plano Ilimitado 35?" → preço do produto, não filtro de academia
  if (/valor|pre[cç]o|custa|quanto/.test(ql) && userCredits != null && !/academ|aceit|lista|quais/.test(ql)) {
    const fromGym = withPlan.find(
      (g) => (g.creditos_minimos ?? parseCreditsFromPlan(g.plano_minimo)) === userCredits,
    );
    const brl = fromGym?.valor_mensal_brl ?? priceForCredits(userCredits);
    return {
      text: `Ilimitado ${userCredits} = R$${brl.toFixed(2)}/mês${fromGym ? ` (visto em ${fromGym.name})` : ' (tabela R$4,95/crédito)'}.`,
      provider: 'local-gp',
    };
  }

  const list = filterByCredits(withPlan, userCredits);

  if (/coco|cocó/.test(ql)) {
    const hits = list.filter((i) => /coco/i.test(i.bairro || ''));
    return {
      text: hits.length
        ? hits.map(fmt).join('\n')
        : 'Nenhuma academia indexada com bairro Cocó neste agente. Snapshot atual é Fortaleza city-wide.',
      provider: 'local-gp',
    };
  }

  if (/barat|mais barat|menor pre/.test(ql)) {
    const sorted = [...list].sort(
      (a, b) => (a.valor_mensal_brl ?? 9e9) - (b.valor_mensal_brl ?? 9e9),
    );
    const t = sorted[0];
    return {
      text: t
        ? `Mais barata no filtro${userCredits != null ? ` (≤${userCredits} créditos)` : ''}:\n${fmt(t)}`
        : 'Nenhuma academia no filtro do seu plano.',
      provider: 'local-gp',
    };
  }

  if (/crossfit aldeota/.test(ql)) {
    const g = gyms.find((x) => /crossfit aldeota/i.test(x.name));
    if (!g) return { text: 'Crossfit Aldeota não está no índice.', provider: 'local-gp' };
    const need = g.creditos_minimos ?? parseCreditsFromPlan(g.plano_minimo) ?? 70;
    if (userCredits != null && userCredits < need) {
      return {
        text: `Crossfit Aldeota exige ${g.plano_minimo} (R$${g.valor_mensal_brl}). Seu plano (${userCredits} créditos) NÃO cobre.`,
        provider: 'local-gp',
      };
    }
    return { text: fmt(g), provider: 'local-gp' };
  }

  if (/quais|lista|aceit|gurupass|academ/.test(ql) || userCredits != null) {
    const header =
      userCredits != null
        ? `Gurupass com ≤${userCredits} créditos: ${list.length}/${withPlan.length} academias`
        : `Gurupass indexado: ${list.length} academias`;
    return {
      text: list.length
        ? `${header}\n${list.map(fmt).join('\n')}`
        : `${header}\n(nenhuma no filtro)`,
      provider: 'local-gp',
    };
  }

  const ragHint = chunks
    .filter((c) => c.chunk_type === 'gp_accept_plan_geo' || c.chunk_type === 'summary')
    .map((c) => c.text)
    .slice(0, 2)
    .join('\n');
  return {
    text: ragHint || 'Pergunte: lista Gurupass, bairro, plano (ex. Ilimitado 35), ou academia específica.',
    provider: 'local-gp',
  };
}

/** Build chunks from page export or ingest artifact. */
export function chunksFromGpPayload(payload: unknown, sourceRef: string): KnowledgeChunk[] {
  const doc = payload as Record<string, unknown>;
  const chunks: KnowledgeChunk[] = [];

  // Ingest artifact shape
  if (Array.isArray(doc.accept_list)) {
    const list = doc.accept_list as GpGym[];
    for (const g of list) {
      const credits = g.creditos_minimos ?? parseCreditsFromPlan(g.plano_minimo);
      chunks.push({
        chunk_id: `gp-gym-${slug(g.name)}`,
        chunk_type: 'gp_gym',
        text: `${g.name} | ${g.bairro || '?'} | ${g.plano_minimo} | R$${g.valor_mensal_brl} | créditos≥${credits}`,
        meta: { ...g, gym: { ...g, creditos_minimos: credits }, source_ref: sourceRef },
      });
    }
    if (Array.isArray(doc.rag_chunks)) {
      for (const r of doc.rag_chunks as Array<{ id?: string; type?: string; text?: string }>) {
        if (!r?.text) continue;
        chunks.push({
          chunk_id: r.id || `rag-${chunks.length}`,
          chunk_type: r.type || 'rag',
          text: r.text,
          meta: { source_ref: sourceRef },
        });
      }
    }
    return chunks;
  }

  // Page export { academias: [...] }
  const academias = (doc.academias || doc.items) as Array<Record<string, unknown>> | undefined;
  if (Array.isArray(academias)) {
    for (const raw of academias) {
      const name = String(raw.nome || raw.name || 'sem-nome');
      const plano = (raw.plano_minimo as string) || null;
      const credits = parseCreditsFromPlan(plano);
      const gym: GpGym = {
        name,
        bairro: (raw.bairro as string) || parseBairro(String(raw.endereco || raw.address || '')),
        cidade: 'Fortaleza',
        uf: 'CE',
        plano_minimo: plano,
        creditos_minimos: credits,
        valor_mensal_brl:
          raw.valor_mensal_brl != null ? Number(raw.valor_mensal_brl) : null,
        modalidades: Array.isArray(raw.modalidades) ? (raw.modalidades as string[]) : [],
      };
      chunks.push({
        chunk_id: `gp-gym-${slug(name)}`,
        chunk_type: 'gp_gym',
        text: `${gym.name} | ${gym.bairro || '?'} | ${gym.plano_minimo} | R$${gym.valor_mensal_brl}`,
        meta: { ...gym, gym, source_ref: sourceRef },
      });
    }
    chunks.push({
      chunk_id: 'gp-summary-fortaleza',
      chunk_type: 'summary',
      text: `Gurupass Fortaleza: ${academias.length} academias indexadas (plano_minimo + preço).`,
      meta: { source_ref: sourceRef },
    });
  }

  return chunks;
}

function slug(s: string) {
  return String(s)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function parseBairro(endereco: string) {
  const m = endereco.match(/,\s*([^,]+?)\s*(?:-|\,)\s*Fortaleza\b/i);
  return m ? m[1].trim() : null;
}
