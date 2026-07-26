/**
 * Pipeline de ingestão TotalPass — chunking granular por modalidade.
 * APENAS preparação + upsert de metadados/texto.
 * Sem embedding API, sem retrieval, sem LLM (AGENTS.md regra 2).
 *
 * Input: data/processed/totalpass-sp-capital-enriched.json
 */
import { createHash } from 'crypto';
import { normalizeBairro, PLANO_RANK } from '../lib/modalityClassifier';

export type ModalidadeExtraida = {
  nome: string;
  plano_minimo: string;
  descricao_extra?: string;
};

export type AcademiaEnriquecida = {
  nome: string;
  cidade: string;
  bairro: string;
  endereco: string;
  distancia?: string; // descartada — relativa
  plano_minimo?: string;
  valor_plano_minimo?: string;
  totalpass_url?: string;
  modalidades_extraidas?: ModalidadeExtraida[];
  descricao_curta?: string;
  enriquecimento_status?: 'success' | 'failed' | 'skipped';
};

export type TpChunk = {
  group_id: string;
  tenant_id: string | null;
  chunk_id: string;
  chunk_type: 'gym_modality' | 'gym_listing';
  text: string;
  embedding_content: string;
  meta: Record<string, unknown>;
  content_hash: string;
  embedding_model: string;
  embedding_version: string;
  document_version: string;
  access_level: 'public';
};

function generateContentHash(parts: string[]): string {
  return createHash('sha256').update(parts.join('|')).digest('hex');
}

function buildChunkText(ac: AcademiaEnriquecida, mod: ModalidadeExtraida | null): string {
  const base = [ac.nome, `Bairro: ${ac.bairro}`, `Endereço: ${ac.endereco}, ${ac.cidade}`];

  if (mod) {
    base.push(`Modalidade: ${mod.nome}`);
    base.push(`Plano mínimo para esta modalidade: ${mod.plano_minimo}`);
    if (mod.descricao_extra) base.push(`Observação: ${mod.descricao_extra}`);
  } else {
    if (ac.plano_minimo) base.push(`Plano mínimo TotalPass: ${ac.plano_minimo}`);
    if (ac.valor_plano_minimo) base.push(`Valor: ${ac.valor_plano_minimo}`);
  }

  if (ac.descricao_curta && ac.descricao_curta.length > 20) {
    const descLimpa = ac.descricao_curta
      .replace(/informações incorretas\. Caso hajam dúvidas.*$/i, '')
      .trim();
    if (descLimpa) base.push(`Descrição: ${descLimpa}`);
  }

  return base.join('\n');
}

function buildEmbeddingContent(ac: AcademiaEnriquecida, mod: ModalidadeExtraida | null): string {
  const partes = [
    `Academia ${ac.nome} no bairro ${ac.bairro}, ${ac.cidade}, endereço ${ac.endereco}.`,
  ];

  if (mod) {
    partes.push(`Oferece a modalidade ${mod.nome}.`);
    partes.push(`O plano TotalPass mínimo necessário para ${mod.nome} é ${mod.plano_minimo}.`);
    if (mod.descricao_extra) partes.push(mod.descricao_extra);
  } else if (ac.plano_minimo) {
    partes.push(`Aceita TotalPass a partir do plano ${ac.plano_minimo}.`);
  }

  return partes.join(' ');
}

function modalidadeParaMeta(nome: string): string {
  return nome
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '');
}

/**
 * 1 academia × N modalidades = N chunks (`gym_modality`).
 * Sem modalidades / failed = 1 `gym_listing` fallback.
 */
export function prepareTpChunks(
  groupId: string,
  tenantId: string | null,
  academias: AcademiaEnriquecida[],
): TpChunk[] {
  const chunks: TpChunk[] = [];
  const documentVersion = new Date().toISOString().slice(0, 10);
  const embeddingModel = process.env.EMBEDDING_MODEL || 'voyage-4-large';
  const embeddingVersion = process.env.EMBEDDING_VERSION || '1';

  for (const ac of academias) {
    const bairroNorm = normalizeBairro(ac.bairro);
    const modalidades = ac.modalidades_extraidas ?? [];

    if (modalidades.length === 0) {
      const contentHash = generateContentHash([groupId, ac.nome, ac.endereco]);
      const chunkId = `tp-fallback-${contentHash.substring(0, 16)}`;

      chunks.push({
        group_id: groupId,
        tenant_id: tenantId,
        chunk_id: chunkId,
        chunk_type: 'gym_listing',
        text: buildChunkText(ac, null),
        embedding_content: buildEmbeddingContent(ac, null),
        meta: {
          nome_academia: ac.nome,
          cidade: ac.cidade,
          bairro: ac.bairro,
          bairro_normalizado: bairroNorm,
          endereco: ac.endereco,
          plano_minimo: ac.plano_minimo ?? null,
          plano_minimo_rank: ac.plano_minimo ? (PLANO_RANK[ac.plano_minimo] ?? 99) : 99,
          modalidade: 'academia_geral',
          modalidade_confidence: 0,
          modalidade_method: 'fallback',
          modalidades_secundarias: [],
          source_kind: 'json_fallback',
          source_ref: ac.totalpass_url ?? null,
          chunking: 'chunking-v1-modality-granular',
        },
        content_hash: contentHash,
        embedding_model: embeddingModel,
        embedding_version: embeddingVersion,
        document_version: documentVersion,
        access_level: 'public',
      });
      continue;
    }

    for (const mod of modalidades) {
      const planoRank = PLANO_RANK[mod.plano_minimo] ?? 99;
      const contentHash = generateContentHash([
        groupId,
        ac.nome,
        mod.nome,
        ac.endereco,
        mod.plano_minimo,
      ]);
      const chunkId = `tp-${contentHash.substring(0, 16)}`;

      chunks.push({
        group_id: groupId,
        tenant_id: tenantId,
        chunk_id: chunkId,
        chunk_type: 'gym_modality',
        text: buildChunkText(ac, mod),
        embedding_content: buildEmbeddingContent(ac, mod),
        meta: {
          nome_academia: ac.nome,
          cidade: ac.cidade,
          bairro: ac.bairro,
          bairro_normalizado: bairroNorm,
          endereco: ac.endereco,
          modalidade: modalidadeParaMeta(mod.nome),
          modalidade_label: mod.nome,
          modalidade_confidence: 1,
          modalidade_method: 'enriched',
          modalidades_secundarias: modalidades
            .filter((m) => m.nome !== mod.nome)
            .map((m) => modalidadeParaMeta(m.nome)),
          plano_minimo: mod.plano_minimo,
          plano_minimo_rank: planoRank,
          source_kind: 'json_enriched',
          source_ref: ac.totalpass_url ?? null,
          chunking: 'chunking-v1-modality-granular',
        },
        content_hash: contentHash,
        embedding_model: embeddingModel,
        embedding_version: embeddingVersion,
        document_version: documentVersion,
        access_level: 'public',
      });
    }
  }

  return chunks;
}

/** Alias explícito do chunking granular. */
export const prepareTpChunksGranulares = prepareTpChunks;

/**
 * Upsert em lotes de 50. Remove `embedding_content` (não é coluna).
 * Embedding vector fica para job/Edge separado — este módulo não chama API de embed.
 */
export async function ingestTpChunks(
  supabase: { from: (t: string) => any },
  chunks: TpChunk[],
): Promise<{ inserted: number; errors: string[] }> {
  if (chunks.length === 0) return { inserted: 0, errors: [] };

  const errors: string[] = [];
  const BATCH_SIZE = 50;
  let inserted = 0;

  for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
    const batch = chunks.slice(i, i + BATCH_SIZE);
    const rows = batch.map(({ embedding_content: _embeddingContent, ...row }) => ({
      ...row,
      source_kind: row.meta?.source_kind ?? 'json_enriched',
      source_ref: row.meta?.source_ref ?? null,
    }));

    const { error } = await supabase.from('eros_knowledge_chunks').upsert(rows, {
      onConflict: 'group_id,content_hash',
    });

    if (error) {
      errors.push(`Batch ${Math.floor(i / BATCH_SIZE) + 1}: ${error.message}`);
    } else {
      inserted += batch.length;
    }
  }

  return { inserted, errors };
}
