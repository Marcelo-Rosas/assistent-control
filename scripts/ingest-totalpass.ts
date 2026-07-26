/**
 * Ingestão TotalPass → eros_knowledge_chunks (+ embeddings 1024).
 *
 * Pré-req: data/processed/totalpass-sp-capital-enriched.json
 * Run: npx tsx scripts/ingest-totalpass.ts
 *
 * Env (sem UUID hardcoded no código):
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *   EMBEDDING_PROVIDER=ollama|voyage|openai  (default: ollama)
 *   EMBEDDING_MODEL=mxbai-embed-large
 *   OLLAMA_BASE_URL=https://ollama2.vectracargo.com.br  (túnel; Edge alcança)
 *   EMBEDDING_API_KEY | VOYAGE_API_KEY | OPENAI_API_KEY  (só voyage/openai)
 *   TARGET_GROUP_ID  (opcional — cria grupo "TotalPass SP Capital" se omitido)
 *   TARGET_TENANT_ID (opcional — null = global)
 */
import fs from 'fs/promises';
import path from 'path';
import { createClient } from '@supabase/supabase-js';
import {
  prepareTpChunks,
  type AcademiaEnriquecida,
  type TpChunk,
} from '../src/services/totalpassIngestService';

function requireEnv(name: string): string {
  const v = process.env[name]?.trim();
  if (!v) {
    console.error(`Variável ausente: ${name}`);
    process.exit(1);
  }
  return v;
}

function embeddingApiKey(): string {
  return (
    process.env.EMBEDDING_API_KEY ||
    process.env.VOYAGE_API_KEY ||
    process.env.OPENAI_API_KEY ||
    ''
  );
}

const supabaseUrl = requireEnv('SUPABASE_URL');
const supabaseKey = requireEnv('SUPABASE_SERVICE_ROLE_KEY');
const embeddingProvider = (
  process.env.EMBEDDING_PROVIDER ||
  'ollama'
).toLowerCase();

function resolveEmbeddingModel(provider: string): string {
  const fromEnv = process.env.EMBEDDING_MODEL?.trim();
  if (provider === 'ollama') {
    // Ignore leftover Voyage/OpenAI model names in shell env
    if (
      !fromEnv ||
      /voyage|text-embedding|openai/i.test(fromEnv)
    ) {
      return 'mxbai-embed-large';
    }
    return fromEnv;
  }
  return fromEnv || 'voyage-4-large';
}

const embeddingModel = resolveEmbeddingModel(embeddingProvider);
const embeddingVersion = process.env.EMBEDDING_VERSION || '1';
const ollamaBase = (
  process.env.OLLAMA_BASE_URL ||
  process.env.EMBEDDING_BASE_URL ||
  'https://ollama2.vectracargo.com.br'
).replace(/\/v1\/?$/, '');

const apiKey = embeddingApiKey();
if (embeddingProvider !== 'ollama' && !apiKey) {
  console.error('Defina EMBEDDING_API_KEY ou VOYAGE_API_KEY ou OPENAI_API_KEY');
  process.exit(1);
}

const targetTenantRaw = process.env.TARGET_TENANT_ID?.trim() || '';
const targetTenantId = targetTenantRaw.length ? targetTenantRaw : null;

const supabase = createClient(supabaseUrl, supabaseKey);

async function generateEmbedding(text: string): Promise<number[]> {
  const input = text.slice(0, 8000);

  if (embeddingProvider === 'ollama') {
    // Native Ollama embeddings API (reliable locally)
    const res = await fetch(`${ollamaBase}/api/embeddings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: embeddingModel, prompt: input }),
    });
    if (!res.ok) throw new Error(`Ollama ${res.status}: ${await res.text()}`);
    const data = (await res.json()) as { embedding?: number[] };
    const vec = data.embedding;
    if (!vec?.length) throw new Error('ollama_embed_empty');
    if (vec.length !== 1024) {
      throw new Error(`ollama_dim_mismatch:expected_1024_got_${vec.length}`);
    }
    return vec;
  }

  if (embeddingProvider === 'voyage' || embeddingModel.toLowerCase().includes('voyage')) {
    const res = await fetch('https://api.voyageai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        input: [input],
        model: embeddingModel,
        input_type: 'document',
        output_dimension: 1024,
      }),
    });
    if (!res.ok) throw new Error(`Voyage ${res.status}: ${await res.text()}`);
    const data = (await res.json()) as { data?: Array<{ embedding: number[] }> };
    const vec = data.data?.[0]?.embedding;
    if (!vec?.length) throw new Error('voyage_embed_empty');
    return vec;
  }

  const res = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      input,
      model: embeddingModel,
      dimensions: 1024,
    }),
  });
  if (!res.ok) throw new Error(`OpenAI ${res.status}: ${await res.text()}`);
  const data = (await res.json()) as { data?: Array<{ embedding: number[] }> };
  const vec = data.data?.[0]?.embedding;
  if (!vec?.length) throw new Error('openai_embed_empty');
  return vec;
}

async function resolveGroupId(): Promise<string> {
  const fromEnv = process.env.TARGET_GROUP_ID?.trim();
  if (fromEnv) return fromEnv;

  const { data: existing } = await supabase
    .from('eros_knowledge_groups')
    .select('id, name')
    .ilike('name', '%totalpass%')
    .limit(1)
    .maybeSingle();

  if (existing?.id) {
    console.log(`Grupo existente: ${existing.name} (${existing.id})`);
    return existing.id;
  }

  const { data: created, error } = await supabase
    .from('eros_knowledge_groups')
    .insert({
      name: 'TotalPass SP Capital',
      company_id: targetTenantId,
    })
    .select('id, name')
    .single();

  if (error || !created) {
    console.error('Falha ao criar grupo:', error?.message);
    process.exit(1);
  }
  console.log(`Grupo criado: ${created.name} (${created.id})`);
  return created.id;
}

async function main() {
  console.log('Ingestão TotalPass…\n');

  const groupId = await resolveGroupId();
  const inputPath = path.join(process.cwd(), 'data/processed/totalpass-sp-capital-enriched.json');

  let academias: AcademiaEnriquecida[];
  try {
    academias = JSON.parse(await fs.readFile(inputPath, 'utf-8'));
  } catch {
    console.error(`Leia primeiro: ${inputPath}`);
    console.error('Rode: npx tsx scripts/enrich-totalpass.ts');
    process.exit(1);
  }

  console.log(`${academias.length} academias`);
  console.log(
    `Provider: ${embeddingProvider} · modelo: ${embeddingModel}@${embeddingVersion} dim=1024`,
  );
  if (embeddingProvider === 'ollama') {
    console.log(`Ollama: ${ollamaBase}`);
  }
  console.log(`tenant_id: ${targetTenantId ?? 'null (global)'}\n`);

  const prepared = prepareTpChunks(groupId, targetTenantId, academias).map((c) => ({
    ...c,
    embedding_model: embeddingModel,
    embedding_version: embeddingVersion,
  }));

  console.log(`Chunks: ${prepared.length}`);
  console.log(
    `  gym_modality: ${prepared.filter((c) => c.chunk_type === 'gym_modality').length}`,
  );
  console.log(
    `  gym_listing:  ${prepared.filter((c) => c.chunk_type === 'gym_listing').length}\n`,
  );

  const BATCH = 10;
  let success = 0;
  let failed = 0;

  for (let i = 0; i < prepared.length; i += BATCH) {
    const batch = prepared.slice(i, i + BATCH);
    const n = Math.floor(i / BATCH) + 1;
    const total = Math.ceil(prepared.length / BATCH);
    process.stdout.write(`\rLote ${n}/${total}…`);

    const rows: Array<Omit<TpChunk, 'embedding_content'> & { embedding: number[] }> = [];

    for (const chunk of batch) {
      try {
        const embedding = await generateEmbedding(chunk.embedding_content);
        const { embedding_content: _ec, ...rest } = chunk;
        rows.push({
          ...rest,
          embedding,
          source_kind: String(rest.meta?.source_kind || 'json_enriched'),
          source_ref: (rest.meta?.source_ref as string) || null,
        } as Omit<TpChunk, 'embedding_content'> & {
          embedding: number[];
          source_kind: string;
          source_ref: string | null;
        });
      } catch (err) {
        failed += 1;
        console.error(`\nChunk ${chunk.chunk_id}:`, err instanceof Error ? err.message : err);
      }
    }

    if (rows.length) {
      const { error } = await supabase.from('eros_knowledge_chunks').upsert(rows, {
        onConflict: 'group_id,content_hash',
      });
      if (error) {
        console.error(`\nUpsert lote ${n}:`, error.message);
        failed += rows.length;
      } else {
        success += rows.length;
      }
    }

    if (i + BATCH < prepared.length) {
      await new Promise((r) => setTimeout(r, 50));
    }
  }

  console.log(`\n\nOK inseridos/atualizados: ${success}`);
  console.log(`Falhas: ${failed}`);

  const { count } = await supabase
    .from('eros_knowledge_chunks')
    .select('*', { count: 'exact', head: true })
    .eq('group_id', groupId);

  const chunkCount = count ?? success;

  await supabase.from('eros_knowledge_agents').upsert(
    {
      group_id: groupId,
      name: 'TotalPass SP Capital',
      status: 'published',
      system_prompt: null,
      chunk_count: chunkCount,
      last_trained_at: new Date().toISOString(),
      last_error: null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'group_id' },
  );

  // Persist embedding config so Edge query uses same model (needs reachable URL from Edge)
  const embCfg = {
    provider: embeddingProvider,
    model: embeddingModel,
    version: embeddingVersion,
    dimension: 1024,
    ...(embeddingProvider === 'ollama' ? { base_url: ollamaBase } : {}),
  };
  const { data: embRow } = await supabase
    .from('eros_config')
    .select('id')
    .eq('key', 'embedding')
    .is('company_id', null)
    .maybeSingle();
  if (embRow?.id) {
    await supabase.from('eros_config').update({ value_json: embCfg }).eq('id', embRow.id);
  } else {
    await supabase.from('eros_config').insert({
      key: 'embedding',
      company_id: null,
      value_json: embCfg,
    });
  }

  console.log(`Agente published · chunk_count=${chunkCount}`);
  console.log(`TARGET_GROUP_ID=${groupId}`);
  if (embeddingProvider === 'ollama') {
    console.log(`Embedding config: ${embeddingProvider}/${embeddingModel} @ ${ollamaBase}`);
  }
}

main().catch((err) => {
  console.error('Erro fatal:', err);
  process.exit(1);
});
