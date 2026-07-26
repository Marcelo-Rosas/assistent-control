/// <reference path="../edge-runtime.d.ts" />
/**
 * Embedding provider — model/dimension from eros_config + env (never hardcoded UUIDs).
 * Schema column is vector(1024); providers must return that dim (OpenAI dimensions=1024).
 */

export type EmbeddingConfig = {
  provider: string;
  model: string;
  version: string;
  dimension: number;
  baseUrl?: string;
};

const DEFAULT_DIM = 1024;

function withTimeout(ms: number): AbortSignal {
  const ctrl = new AbortController();
  setTimeout(() => ctrl.abort(), ms);
  return ctrl.signal;
}

/** Prefer eros_config.embedding → env → voyage-4-large @ 1024 */
export async function resolveEmbeddingConfig(supabase: any): Promise<EmbeddingConfig> {
  const { data } = await supabase
    .from('eros_config')
    .select('value_json')
    .eq('key', 'embedding')
    .is('company_id', null)
    .maybeSingle();

  const cfg = (data?.value_json && typeof data.value_json === 'object' ? data.value_json : {}) as Record<
    string,
    unknown
  >;

  const provider = String(
    cfg.provider || Deno.env.get('EMBEDDING_PROVIDER') || 'voyage',
  ).toLowerCase();
  const model = String(
    cfg.model || Deno.env.get('EMBEDDING_MODEL') || 'voyage-4-large',
  );
  const version = String(cfg.version || Deno.env.get('EMBEDDING_VERSION') || '1');
  const dimension = Number(cfg.dimension || Deno.env.get('EMBEDDING_DIMENSION') || DEFAULT_DIM);
  const baseUrl = cfg.base_url
    ? String(cfg.base_url)
    : Deno.env.get('EMBEDDING_BASE_URL') || undefined;

  if (!Number.isFinite(dimension) || dimension <= 0) {
    throw new Error('invalid_embedding_dimension');
  }
  if (dimension !== DEFAULT_DIM) {
    throw new Error(`embedding_dimension_mismatch:expected_${DEFAULT_DIM}_got_${dimension}`);
  }

  return { provider, model, version, dimension, baseUrl };
}

export async function embedQuery(text: string, supabase: any): Promise<{
  embedding: number[];
  config: EmbeddingConfig;
}> {
  const config = await resolveEmbeddingConfig(supabase);
  const embedding = await embedText(text, config, 'query');
  if (embedding.length !== config.dimension) {
    throw new Error(
      `embedding_length_mismatch:expected_${config.dimension}_got_${embedding.length}`,
    );
  }
  return { embedding, config };
}

/** Batch document embeddings for ingest (Voyage input_type=document). */
export async function embedDocuments(
  texts: string[],
  supabase: any,
): Promise<{ embeddings: number[][]; config: EmbeddingConfig }> {
  const config = await resolveEmbeddingConfig(supabase);
  const embeddings: number[][] = [];
  const batchSize = 32;
  const maxChars = config.provider === 'ollama' ? 1000 : 8000;
  for (let i = 0; i < texts.length; i += batchSize) {
    const slice = texts.slice(i, i + batchSize).map((t) => t.slice(0, maxChars));
    const batch = await embedTextBatch(slice, config, 'document');
    embeddings.push(...batch);
  }
  for (const e of embeddings) {
    if (e.length !== config.dimension) {
      throw new Error(
        `embedding_length_mismatch:expected_${config.dimension}_got_${e.length}`,
      );
    }
  }
  return { embeddings, config };
}

async function embedText(
  text: string,
  config: EmbeddingConfig,
  inputType: 'query' | 'document',
): Promise<number[]> {
  // mxbai-embed-large (Ollama) ≈ 512 tokens; probe: 1000 OK / 1200+ fail
  const maxChars = config.provider === 'ollama' ? 1000 : 8000;
  const [vec] = await embedTextBatch([text.slice(0, maxChars)], config, inputType);
  return vec;
}

async function embedTextBatch(
  inputs: string[],
  config: EmbeddingConfig,
  inputType: 'query' | 'document',
): Promise<number[][]> {
  switch (config.provider) {
    case 'openai': {
      const vecs = await embedOpenAiCompatBatch({
        baseUrl: config.baseUrl || 'https://api.openai.com/v1',
        apiKey: Deno.env.get('OPENAI_API_KEY') || '',
        model: config.model,
        inputs,
        dimensions: config.dimension,
        label: 'openai',
      });
      return vecs;
    }
    case 'voyage':
      return embedVoyageBatch({
        apiKey: Deno.env.get('VOYAGE_API_KEY') || '',
        model: config.model,
        inputs,
        inputType,
      });
    case 'ollama':
      return embedOpenAiCompatBatch({
        baseUrl:
          (config.baseUrl || Deno.env.get('OLLAMA_BASE_URL') || 'http://127.0.0.1:11434').replace(
            /\/v1\/?$/,
            '',
          ) + '/v1',
        apiKey: Deno.env.get('OLLAMA_API_KEY') || 'ollama',
        model: config.model,
        inputs,
        dimensions: config.dimension,
        label: 'ollama',
      });
    default:
      throw new Error(`unsupported_embedding_provider:${config.provider}`);
  }
}

async function embedOpenAiCompatBatch(opts: {
  baseUrl: string;
  apiKey: string;
  model: string;
  inputs: string[];
  dimensions: number;
  label: string;
}): Promise<number[][]> {
  if (!opts.apiKey) throw new Error(`${opts.label}_api_key_missing`);
  const base = opts.baseUrl.replace(/\/$/, '');
  const body: Record<string, unknown> = {
    model: opts.model,
    input: opts.inputs.length === 1 ? opts.inputs[0] : opts.inputs,
  };
  if (opts.label === 'openai') body.dimensions = opts.dimensions;

  const resp = await fetch(`${base}/embeddings`, {
    method: 'POST',
    signal: withTimeout(120_000),
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${opts.apiKey}`,
    },
    body: JSON.stringify(body),
  });
  const json = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error(`${opts.label}_embed_error:${JSON.stringify(json)}`);
  const data = json?.data;
  if (!Array.isArray(data) || !data.length) throw new Error(`${opts.label}_embed_empty`);
  return data
    .sort((a: { index?: number }, b: { index?: number }) => (a.index ?? 0) - (b.index ?? 0))
    .map((row: { embedding?: unknown }) => {
      if (!Array.isArray(row.embedding)) throw new Error(`${opts.label}_embed_empty`);
      return row.embedding.map((n: unknown) => Number(n));
    });
}

async function embedVoyageBatch(opts: {
  apiKey: string;
  model: string;
  inputs: string[];
  inputType: 'query' | 'document';
}): Promise<number[][]> {
  if (!opts.apiKey) throw new Error('voyage_api_key_missing');
  const resp = await fetch('https://api.voyageai.com/v1/embeddings', {
    method: 'POST',
    signal: withTimeout(120_000),
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${opts.apiKey}`,
    },
    body: JSON.stringify({
      model: opts.model,
      input: opts.inputs.length === 1 ? opts.inputs[0] : opts.inputs,
      input_type: opts.inputType,
      output_dimension: 1024,
    }),
  });
  const json = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error(`voyage_embed_error:${JSON.stringify(json)}`);
  const data = json?.data;
  if (!Array.isArray(data) || !data.length) throw new Error('voyage_embed_empty');
  return data
    .sort((a: { index?: number }, b: { index?: number }) => (a.index ?? 0) - (b.index ?? 0))
    .map((row: { embedding?: unknown }) => {
      if (!Array.isArray(row.embedding)) throw new Error('voyage_embed_empty');
      return row.embedding.map((n: unknown) => Number(n));
    });
}
