/** Shared knowledge types — train is domain-agnostic (agregadores, regulatório, raw). */

export type KnowledgeDomain =
  | 'gurupass'
  | 'totalpass'
  | 'wellhub'
  | 'regulatory'
  | 'generic'
  | 'mixed';

export type KnowledgeChunk = {
  chunk_id: string;
  chunk_type: string;
  text: string;
  meta?: Record<string, unknown>;
};

export const GLOBAL_SYSTEM = `Tu és agente GymSite Intelligence (viabilidade de academias).
Responde só com chunks indexados — não inventa fato.
Domínios possíveis: agregadores (Gurupass/TotalPass/Wellhub), regulatório (leis/normas), genérico.
Se o índice não tiver o domínio pedido, diga e sugira re-treinar com a fonte certa.`;
