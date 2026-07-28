/**
 * Vetorização em lote — preenche `embedding` (1024) nos chunks pending.
 * Separado da ingestão de metadados (AGENTS.md regra 2).
 *
 * Fonte do texto: coluna `text` (embedding_content não é coluna / foi stripado no ingest).
 *
 * Run: npx tsx scripts/generate-embeddings.ts --group=regulatorio|wellhub|tp|gurupass|mercado|engenheiro
 *   or: npm run embed:regulatorio | embed:wellhub | embed:tp | embed:gurupass | embed:mercado | embed:engenheiro
 *
 * Env:
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *   WELLHUB_GROUP_ID | TOTALPASS_GROUP_ID | GURUPASS_GROUP_ID | REGULATORIO_GROUP_ID | MERCADO_GROUP_ID | ENGENHEIRO_GROUP_ID | TARGET_GROUP_ID
 *   EMBED_GROUP=regulatorio|wellhub|tp|gurupass|mercado|engenheiro   (alt to --group / npm script name)
 *   EMBEDDING_PROVIDER=ollama|voyage|openai   (default: ollama)
 *   EMBEDDING_MODEL=mxbai-embed-large
 *   EMBEDDING_VERSION=1
 *   OLLAMA_BASE_URL=https://ollama2.vectracargo.com.br
 *   EMBEDDING_API_KEY | VOYAGE_API_KEY | OPENAI_API_KEY  (voyage/openai)
 *   BATCH_SIZE=10
 *   DELAY_MS=200
 *   PAGE_SIZE=500
 *   LIMIT=0                 # 0 = todos pending; >0 = teto (teste)
 */
import fs from 'fs';
import path from 'path';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

type PendingChunk = {
  id: string;
  chunk_id: string;
  text: string;
  embedding_model: string | null;
};

const DEFAULT_DIM = 1024;

function loadDotEnv(filePath: string): void {
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) return;
  const raw = fs.readFileSync(filePath, 'utf-8');
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    const hashIdx = value.search(/\s+#/);
    if (hashIdx >= 0) value = value.slice(0, hashIdx).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

function requireEnv(name: string): string {
  const v = process.env[name]?.trim();
  if (!v) {
    console.error(`Variável ausente: ${name}`);
    process.exit(1);
  }
  return v;
}

function resolveGroupId(): string {
  // Prefer explicit CLI / EMBED_GROUP (reliable on Windows npm) over lifecycle.
  const argvGroup = (() => {
    const arg = process.argv.find((a) => a.startsWith('--group='));
    if (arg) return arg.slice('--group='.length).trim().toLowerCase();
    const idx = process.argv.indexOf('--group');
    if (idx >= 0 && process.argv[idx + 1]) return process.argv[idx + 1].trim().toLowerCase();
    return '';
  })();
  const script = process.env.npm_lifecycle_event || '';
  const hint =
    process.env.EMBED_GROUP?.trim().toLowerCase() ||
    argvGroup ||
    (script.startsWith('embed:') ? script.slice('embed:'.length) : '');

  if (hint === 'wellhub') {
    const wh = process.env.WELLHUB_GROUP_ID?.trim();
    if (wh) return wh;
    console.error('Defina WELLHUB_GROUP_ID (npm run setup:wellhub)');
    process.exit(1);
  }
  if (hint === 'tp' || hint === 'totalpass') {
    const tp = process.env.TOTALPASS_GROUP_ID?.trim();
    if (tp) return tp;
    console.error('Defina TOTALPASS_GROUP_ID');
    process.exit(1);
  }
  if (hint === 'gurupass' || hint === 'gp') {
    const gp = process.env.GURUPASS_GROUP_ID?.trim();
    if (gp) return gp;
    console.error('Defina GURUPASS_GROUP_ID (npm run setup:gurupass)');
    process.exit(1);
  }
  if (hint === 'regulatorio' || hint === 'law' || hint === 'legal') {
    const reg = process.env.REGULATORIO_GROUP_ID?.trim();
    if (reg) return reg;
    console.error('Defina REGULATORIO_GROUP_ID (npm run setup:regulatorio)');
    process.exit(1);
  }
  if (hint === 'mercado' || hint === 'market') {
    const mk = process.env.MERCADO_GROUP_ID?.trim();
    if (mk) return mk;
    console.error('Defina MERCADO_GROUP_ID (npm run setup:mercado)');
    process.exit(1);
  }
  if (hint === 'engenheiro' || hint === 'engenharia' || hint === 'obra') {
    const eng = process.env.ENGENHEIRO_GROUP_ID?.trim();
    if (eng) return eng;
    console.error('Defina ENGENHEIRO_GROUP_ID (npm run setup:engenheiro)');
    process.exit(1);
  }

  const explicit = process.env.TARGET_GROUP_ID?.trim();
  if (explicit) return explicit;

  const id =
    process.env.WELLHUB_GROUP_ID?.trim() ||
    process.env.TOTALPASS_GROUP_ID?.trim() ||
    process.env.GURUPASS_GROUP_ID?.trim() ||
    process.env.REGULATORIO_GROUP_ID?.trim() ||
    process.env.MERCADO_GROUP_ID?.trim() ||
    process.env.ENGENHEIRO_GROUP_ID?.trim() ||
    '';
  if (!id) {
    console.error(
      'Defina WELLHUB_GROUP_ID, TOTALPASS_GROUP_ID, REGULATORIO_GROUP_ID, MERCADO_GROUP_ID, ENGENHEIRO_GROUP_ID ou TARGET_GROUP_ID',
    );
    process.exit(1);
  }
  return id;
}

function embeddingApiKey(): string {
  return (
    process.env.EMBEDDING_API_KEY ||
    process.env.VOYAGE_API_KEY ||
    process.env.OPENAI_API_KEY ||
    ''
  );
}

function resolveProvider(): string {
  return (process.env.EMBEDDING_PROVIDER || 'ollama').toLowerCase();
}

function resolveModel(provider: string): string {
  const fromEnv = process.env.EMBEDDING_MODEL?.trim();
  if (provider === 'ollama') {
    if (!fromEnv || /voyage|text-embedding|openai/i.test(fromEnv)) {
      return 'mxbai-embed-large';
    }
    return fromEnv;
  }
  if (provider === 'openai') return fromEnv || 'text-embedding-3-small';
  return fromEnv || 'voyage-4-large';
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function withRetry<T>(fn: () => Promise<T>, label: string, maxAttempts = 3): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const msg = err instanceof Error ? err.message : String(err);
      const retryable = /429|5\d\d|rate|timeout|fetch failed|ECONNRESET/i.test(msg);
      if (!retryable || attempt === maxAttempts) break;
      const backoff = 500 * 2 ** (attempt - 1);
      console.warn(`  retry ${attempt}/${maxAttempts} ${label}: ${msg} wait=${backoff}ms`);
      await sleep(backoff);
    }
  }
  throw lastErr;
}

async function embedText(
  text: string,
  provider: string,
  model: string,
  ollamaBase: string,
  apiKey: string,
): Promise<number[]> {
  // mxbai-embed-large no Ollama: ~512 tokens. Dense tables/TOC can exceed at 1000 chars.
  const maxChars = provider === 'ollama' ? Number(process.env.OLLAMA_EMBED_MAX_CHARS || 800) : 8000;
  let input = text.slice(0, maxChars).trim();
  if (!input) throw new Error('empty_embed_input');

  if (provider === 'ollama') {
    let lastErr = '';
    for (let attempt = 0; attempt < 4; attempt++) {
      const res = await fetch(`${ollamaBase}/api/embeddings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, prompt: input }),
      });
      if (res.ok) {
        const data = (await res.json()) as { embedding?: number[] };
        const vec = data.embedding;
        if (!vec?.length) throw new Error('ollama_embed_empty');
        if (vec.length !== DEFAULT_DIM) {
          throw new Error(`ollama_dim_mismatch:expected_${DEFAULT_DIM}_got_${vec.length}`);
        }
        return vec;
      }
      lastErr = await res.text();
      if (/context length/i.test(lastErr) && input.length > 200) {
        input = input.slice(0, Math.floor(input.length * 0.7)).trim();
        continue;
      }
      throw new Error(`Ollama ${res.status}: ${lastErr}`);
    }
    throw new Error(`Ollama embed failed after shrink: ${lastErr}`);
  }

  if (provider === 'voyage' || model.toLowerCase().includes('voyage')) {
    const res = await fetch('https://api.voyageai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        input: [input],
        model,
        input_type: 'document',
        output_dimension: DEFAULT_DIM,
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
      model,
      dimensions: DEFAULT_DIM,
    }),
  });
  if (!res.ok) throw new Error(`OpenAI ${res.status}: ${await res.text()}`);
  const data = (await res.json()) as { data?: Array<{ embedding: number[] }> };
  const vec = data.data?.[0]?.embedding;
  if (!vec?.length) throw new Error('openai_embed_empty');
  return vec;
}

async function fetchPendingChunks(
  supabase: SupabaseClient,
  groupId: string,
  pageSize: number,
  hardLimit: number,
): Promise<PendingChunk[]> {
  const out: PendingChunk[] = [];
  let from = 0;

  while (true) {
    const to = from + pageSize - 1;
    // pending = model pending OR embedding null (PostgREST)
    const { data, error } = await supabase
      .from('eros_knowledge_chunks')
      .select('id, chunk_id, text, embedding_model')
      .eq('group_id', groupId)
      .or('embedding.is.null,embedding_model.eq.pending')
      .order('created_at', { ascending: true })
      .range(from, to);

    if (error) throw new Error(`fetch_pending: ${error.message}`);
    const rows = (data || []) as PendingChunk[];
    if (!rows.length) break;

    out.push(...rows);
    if (hardLimit > 0 && out.length >= hardLimit) {
      return out.slice(0, hardLimit);
    }
    if (rows.length < pageSize) break;
    from += pageSize;
  }

  return out;
}

async function main(): Promise<void> {
  loadDotEnv(path.join(process.cwd(), '.env'));
  loadDotEnv(path.join(process.cwd(), '.env.local'));

  console.log('Generate embeddings (pending chunks)\n');

  const supabaseUrl =
    process.env.SUPABASE_URL?.trim() ||
    process.env.VITE_SUPABASE_URL?.trim() ||
    '';
  if (!supabaseUrl) {
    console.error('Variável ausente: SUPABASE_URL (ou VITE_SUPABASE_URL)');
    process.exit(1);
  }
  const supabaseKey = requireEnv('SUPABASE_SERVICE_ROLE_KEY');
  const groupId = resolveGroupId();
  const provider = resolveProvider();
  const model = resolveModel(provider);
  const version = process.env.EMBEDDING_VERSION || '1';
  const apiKey = embeddingApiKey();
  const ollamaBase = (
    process.env.OLLAMA_BASE_URL ||
    process.env.EMBEDDING_BASE_URL ||
    'https://ollama2.vectracargo.com.br'
  ).replace(/\/v1\/?$/, '');

  if (provider !== 'ollama' && !apiKey) {
    console.error('Defina EMBEDDING_API_KEY / VOYAGE_API_KEY / OPENAI_API_KEY');
    process.exit(1);
  }

  const batchSize = Number(process.env.BATCH_SIZE || 10);
  const delayMs = Number(process.env.DELAY_MS || 200);
  const pageSize = Number(process.env.PAGE_SIZE || 500);
  const hardLimit = Number(process.env.LIMIT || 0);

  console.log(`group_id=${groupId}`);
  console.log(`provider=${provider} model=${model}@${version} dim=${DEFAULT_DIM}`);
  if (provider === 'ollama') console.log(`ollama=${ollamaBase}`);
  console.log(`BATCH_SIZE=${batchSize} DELAY_MS=${delayMs}\n`);

  const supabase = createClient(supabaseUrl, supabaseKey);
  const pending = await fetchPendingChunks(supabase, groupId, pageSize, hardLimit);

  console.log(`Pending: ${pending.length}\n`);
  if (!pending.length) {
    console.log('Nada a vetorizar.');
    return;
  }

  let success = 0;
  let failed = 0;
  const errors: string[] = [];
  const totalBatches = Math.ceil(pending.length / batchSize);

  for (let i = 0; i < pending.length; i += batchSize) {
    const batch = pending.slice(i, i + batchSize);
    const n = Math.floor(i / batchSize) + 1;
    console.log(`Processando lote ${n}/${totalBatches} (${batch.length} chunks)…`);

    for (const chunk of batch) {
      const label = chunk.chunk_id.slice(0, 12);
      try {
        if (!chunk.text?.trim()) {
          throw new Error('empty_text');
        }

        const embedding = await withRetry(
          () => embedText(chunk.text, provider, model, ollamaBase, apiKey),
          label,
        );

        const { error } = await supabase
          .from('eros_knowledge_chunks')
          .update({
            embedding,
            embedding_model: model,
            embedding_version: version,
          })
          .eq('id', chunk.id);

        if (error) throw new Error(error.message);
        success += 1;
      } catch (err) {
        failed += 1;
        const msg = err instanceof Error ? err.message : String(err);
        errors.push(`${label}: ${msg}`);
        console.warn(`  FAIL ${label}: ${msg}`);
      }
    }

    if (i + batchSize < pending.length) {
      await sleep(delayMs);
    }
  }

  // Reconta pending neste grupo
  const stillPending = await fetchPendingChunks(supabase, groupId, pageSize, 0);
  const allDone = stillPending.length === 0;

  const { count } = await supabase
    .from('eros_knowledge_chunks')
    .select('*', { count: 'exact', head: true })
    .eq('group_id', groupId);

  await supabase
    .from('eros_knowledge_agents')
    .update({
      status: allDone ? 'published' : 'training',
      chunk_count: count ?? success,
      last_trained_at: allDone ? new Date().toISOString() : null,
      last_error: errors.length ? errors.slice(0, 3).join(' | ') : null,
      updated_at: new Date().toISOString(),
    })
    .eq('group_id', groupId);

  console.log('\n=== Estatísticas ===');
  console.log(`OK: ${success}`);
  console.log(`Falhas: ${failed}`);
  console.log(`Ainda pending: ${stillPending.length}`);
  console.log(`Agente: ${allDone ? 'published' : 'training'}`);
  if (errors.length) {
    console.log('Erros (até 8):');
    for (const e of errors.slice(0, 8)) console.log(`  - ${e}`);
  }
}

main().catch((err) => {
  console.error('Erro fatal:', err);
  process.exit(1);
});
