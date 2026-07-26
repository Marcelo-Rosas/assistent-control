/**
 * Answer router — escolhe domínio pelo índice + pergunta.
 */
import { answerFromGymKnowledge } from './gpKnowledgeAgent';
import { answerFromTpKnowledge } from './tpKnowledgeAgent';
import { domainsInChunks } from './knowledgeIndex';
import type { KnowledgeChunk } from './knowledgeTypes';

function scoreChunks(question: string, chunks: KnowledgeChunk[], limit = 6): KnowledgeChunk[] {
  const terms = question
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 2);
  const scored = chunks.map((c) => {
    const hay = c.text.toLowerCase();
    let s = 0;
    for (const t of terms) if (hay.includes(t)) s += 1;
    return { c, s };
  });
  return scored
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s)
    .slice(0, limit)
    .map((x) => x.c);
}

export function answerFromKnowledge(
  question: string,
  chunks: KnowledgeChunk[],
): { text: string; provider: string } {
  const ql = question.toLowerCase();
  const domains = domainsInChunks(chunks);
  const hasGp = chunks.some((c) => c.chunk_type === 'gp_gym' || c.meta?.domain === 'gurupass');
  const hasTp = chunks.some((c) => c.chunk_type === 'tp_partner' || c.meta?.domain === 'totalpass');
  const hasLaw = chunks.some(
    (c) => c.chunk_type === 'law_chunk' || c.meta?.domain === 'regulatory',
  );

  const wantGp = /gurupass|ilimitado|cr[eé]dito/.test(ql);
  const wantTp = /total\s*pass|\btp\s*\d|\btp\s*go|\btp\b/.test(ql);
  const wantLaw = /lei|alvar[aá]|regul|norma|decreto|codigo|código|bombeiro|vigil[aâ]ncia/.test(
    ql,
  );

  if (wantTp && hasTp) return answerFromTpKnowledge(question, chunks);
  if (wantGp && hasGp) return answerFromGymKnowledge(question, chunks);
  if (wantLaw && hasLaw) {
    const hits = scoreChunks(question, chunks.filter((c) => c.chunk_type === 'law_chunk'));
    if (!hits.length) {
      return {
        text: 'Índice regulatório sem trecho relevante. Faça upload de JSON `{ "domain":"regulatory", "pages":[{ "title", "text" }] }`.',
        provider: 'local-regulatory',
      };
    }
    return {
      text: hits.map((h) => h.text).join('\n---\n'),
      provider: 'local-regulatory',
    };
  }

  // Preferências por conteúdo do índice
  if (hasTp && !hasGp) return answerFromTpKnowledge(question, chunks);
  if (hasGp && !hasTp) return answerFromGymKnowledge(question, chunks);
  if (hasTp && hasGp) {
    // ambíguo: se menciona academia/bairro sem agregador, lista ambos resumos
    if (/aceit|agregador/.test(ql)) {
      const tp = answerFromTpKnowledge(question, chunks);
      const gp = answerFromGymKnowledge(question, chunks);
      return {
        text: `=== TotalPass ===\n${tp.text}\n\n=== Gurupass ===\n${gp.text}`,
        provider: 'local-mixed',
      };
    }
    return answerFromTpKnowledge(question, chunks);
  }

  if (hasLaw) {
    const hits = scoreChunks(question, chunks);
    return {
      text: hits.length
        ? hits.map((h) => h.text).join('\n---\n')
        : 'Sem match nos documentos indexados.',
      provider: 'local-regulatory',
    };
  }

  const hits = scoreChunks(question, chunks);
  if (hits.length) {
    return { text: hits.map((h) => h.text).join('\n---\n'), provider: 'local-generic' };
  }

  return {
    text: `Índice: domínios [${domains.join(', ') || 'vazio'}]. Pergunte sobre TotalPass, Gurupass, ou o tema dos docs indexados.`,
    provider: 'local-generic',
  };
}
