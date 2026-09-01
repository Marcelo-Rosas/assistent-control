/**
 * Ingestão docs de inteligência de mercado → eros_knowledge_chunks (metadados only).
 *
 * Input:  *.pdf / *.md / *.txt / *.json em data/raw/Mercado/ (ou INPUT_PATH)
 * Run:    npm run ingest:mercado
 *
 * Env: SUPABASE_URL | VITE_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, MERCADO_GROUP_ID
 */
import fs from 'fs';
import path from 'path';
import { createHash } from 'crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import {
  DEFAULT_CHUNK_OVERLAP,
  DEFAULT_CHUNK_SIZE,
  normalizePdfText,
  recursiveCharacterTextSplit,
} from './lib/pdfTextChunk';

const CHUNK_SIZE = Number(process.env.CHUNK_SIZE || DEFAULT_CHUNK_SIZE);
const CHUNK_OVERLAP = Number(process.env.CHUNK_OVERLAP || DEFAULT_CHUNK_OVERLAP);
const BATCH_SIZE = Number(process.env.BATCH_SIZE || 50);
const ROOT = process.cwd();
const MERCADO_DIR = path.join(ROOT, 'data', 'raw', 'Mercado');
const CHUNKING_VERSION = 'chunking-v2-market-recursive';

const FORBIDDEN_GROUP_IDS = new Set([
  '553fa8d6-e3d2-440a-ba0b-867fb5363627',
  '4d1e2c40-217b-4a39-bc08-f9c3e90fd803',
  '6ab0c39b-bf81-4840-9dcc-ed5f5cc86117',
  'b7dad505-2d2a-49a9-bbaf-d4b9c4929dea',
]);

type DocMeta = {
  documentName: string;
  year: number | null;
};

type ChunkDraft = {
  group_id: string;
  tenant_id: string | null;
  chunk_id: string;
  chunk_type: 'market_report';
  text: string;
  meta: Record<string, unknown>;
  content_hash: string;
  embedding_model: string;
  embedding_version: string;
  document_version: string;
  access_level: 'public';
  source_kind: string;
  source_ref: string;
};

function loadDotEnv(filePath: string): void {
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) return;
  for (const line of fs.readFileSync(filePath, 'utf-8').split(/\r?\n/)) {
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
    if (process.env[key] === undefined) process.env[key] = value;
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
  const id =
    process.env.MERCADO_GROUP_ID?.trim() ||
    process.env.TARGET_GROUP_ID?.trim() ||
    '';
  if (!id) {
    console.error('Defina MERCADO_GROUP_ID. Não use IDs de outros domínios.');
    process.exit(1);
  }
  if (FORBIDDEN_GROUP_IDS.has(id.toLowerCase())) {
    console.error(`MERCADO_GROUP_ID=${id} é UUID de outro domínio.`);
    process.exit(1);
  }
  for (const envKey of [
    'WELLHUB_GROUP_ID',
    'GURUPASS_GROUP_ID',
    'TOTALPASS_GROUP_ID',
    'REGULATORIO_GROUP_ID',
    'RECEITA_GROUP_ID',
  ] as const) {
    const other = process.env[envKey]?.trim();
    if (other && id === other) {
      console.error(`MERCADO_GROUP_ID não pode ser igual a ${envKey}.`);
      process.exit(1);
    }
  }
  return id;
}

const TEXT_EXTS = new Set(['.pdf', '.md', '.txt', '.markdown', '.json']);

async function extractDocText(
  filePath: string,
): Promise<{ text: string; sourceKind: string }> {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.pdf') {
    const { PDFParse } = await import('pdf-parse');
    const buf = fs.readFileSync(filePath);
    const parser = new PDFParse({ data: buf });
    const result = await parser.getText();
    return { text: result.text || '', sourceKind: 'pdf_upload' };
  }
  if (ext === '.json') {
    const raw = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    if (!Array.isArray(raw)) throw new Error('JSON deve ser array');
    const blocks: string[] = [];
    for (const [i, item] of raw.entries()) {
      if (!item || typeof item !== 'object') continue;
      const row = item as Record<string, unknown>;
      const conteudo = String(row.conteudo ?? row.content ?? row.text ?? '').trim();
      if (!conteudo) continue;
      const titulo = String(row.titulo ?? row.title ?? `Registro ${i + 1}`).trim();
      blocks.push(`# ${titulo}\n\n${conteudo}`);
    }
    if (!blocks.length) throw new Error('JSON sem conteudo');
    return { text: blocks.join('\n\n---\n\n'), sourceKind: 'json_kb' };
  }
  return {
    text: fs.readFileSync(filePath, 'utf-8'),
    sourceKind: ext === '.md' || ext === '.markdown' ? 'md_upload' : 'txt_upload',
  };
}

function resolveDocPaths(): string[] {
  const input = process.env.INPUT_PATH?.trim();
  if (input) {
    const resolved = path.resolve(input);
    if (!fs.existsSync(resolved)) {
      console.error(`Arquivo não encontrado: ${resolved}`);
      process.exit(1);
    }
    return [resolved];
  }
  if (!fs.existsSync(MERCADO_DIR)) {
    console.error(`Pasta não encontrada: ${MERCADO_DIR}`);
    process.exit(1);
  }
  const docs = fs
    .readdirSync(MERCADO_DIR)
    .filter((f) => TEXT_EXTS.has(path.extname(f).toLowerCase()))
    .sort((a, b) => a.localeCompare(b, 'pt-BR'))
    .map((f) => path.join(MERCADO_DIR, f));
  if (!docs.length) {
    console.error(`Nenhum .pdf/.md/.txt em ${path.relative(ROOT, MERCADO_DIR)}`);
    process.exit(1);
  }
  return docs;
}

function contentHash(parts: string[]): string {
  return createHash('sha256').update(parts.join('|')).digest('hex');
}

function prepareChunks(
  groupId: string,
  tenantId: string | null,
  textChunks: string[],
  sourceRef: string,
  doc: DocMeta,
  sourceKind: string,
): ChunkDraft[] {
  const documentVersion = contentHash([doc.documentName, String(textChunks.length)]).slice(
    0,
    16,
  );
  return textChunks.map((chunkText, i) => {
    const hash = contentHash([
      groupId,
      'market_report',
      doc.documentName,
      String(i),
      chunkText,
    ]);
    return {
      group_id: groupId,
      tenant_id: tenantId,
      chunk_id: `mercado-${hash.substring(0, 16)}`,
      chunk_type: 'market_report' as const,
      text: chunkText,
      meta: {
        document_name: doc.documentName,
        chunk_index: i,
        total_chunks: textChunks.length,
        source_type: 'market_analysis',
        domain: 'market',
        year: doc.year,
        chunking: CHUNKING_VERSION,
        chunk_size: CHUNK_SIZE,
        chunk_overlap: CHUNK_OVERLAP,
        source_kind: sourceKind,
        source_ref: sourceRef,
      },
      content_hash: hash,
      embedding_model: 'pending',
      embedding_version: '0',
      document_version: documentVersion,
      access_level: 'public' as const,
      source_kind: sourceKind,
      source_ref: sourceRef,
    };
  });
}

async function deleteChunksForSource(
  supabase: SupabaseClient,
  groupId: string,
  sourceRef: string,
): Promise<number> {
  const { data, error } = await supabase
    .from('eros_knowledge_chunks')
    .delete()
    .eq('group_id', groupId)
    .eq('source_ref', sourceRef)
    .select('chunk_id');
  if (error) throw new Error(`Falha ao limpar source_ref=${sourceRef}: ${error.message}`);
  return data?.length ?? 0;
}

async function upsertDrafts(
  supabase: SupabaseClient,
  drafts: ChunkDraft[],
): Promise<{ success: number; failed: number; errors: string[] }> {
  let success = 0;
  let failed = 0;
  const errors: string[] = [];
  const totalBatches = Math.ceil(drafts.length / BATCH_SIZE) || 1;
  for (let i = 0; i < drafts.length; i += BATCH_SIZE) {
    const batch = drafts.slice(i, i + BATCH_SIZE);
    const n = Math.floor(i / BATCH_SIZE) + 1;
    process.stdout.write(`\r  Lote ${n}/${totalBatches}…`);
    const { error } = await supabase.from('eros_knowledge_chunks').upsert(batch, {
      onConflict: 'group_id,content_hash',
    });
    if (error) {
      failed += batch.length;
      errors.push(`Lote ${n}: ${error.message}`);
      console.error(`\n  Upsert lote ${n}: ${error.message}`);
    } else {
      success += batch.length;
    }
  }
  if (drafts.length) process.stdout.write('\n');
  return { success, failed, errors };
}

async function main(): Promise<void> {
  loadDotEnv(path.join(ROOT, '.env'));
  loadDotEnv(path.join(ROOT, '.env.local'));

  console.log('Ingestão Mercado Fitness (metadados only — sem embeddings)\n');
  console.log(`Chunking: ${CHUNKING_VERSION} size=${CHUNK_SIZE} overlap=${CHUNK_OVERLAP}\n`);

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
  const tenantRaw = process.env.TARGET_TENANT_ID?.trim() || '';
  const tenantId = tenantRaw.length ? tenantRaw : null;
  const docPaths = resolveDocPaths();
  const supabase = createClient(supabaseUrl, supabaseKey);

  console.log(`group_id=${groupId} tenant_id=${tenantId ?? 'null'}`);
  console.log(`Docs: ${docPaths.length}\n`);

  let totalSuccess = 0;
  let totalFailed = 0;
  const allErrors: string[] = [];

  for (const inputPath of docPaths) {
    const documentName = path.basename(inputPath);
    const yearMatch = documentName.match(/(20\d{2}|19\d{2})/);
    const doc: DocMeta = {
      documentName,
      year: yearMatch ? Number(yearMatch[1]) : null,
    };
    const rel = path.relative(ROOT, inputPath).replace(/\\/g, '/');
    console.log(`--- ${documentName} ---`);

    let rawText: string;
    let sourceKind: string;
    try {
      const extracted = await extractDocText(inputPath);
      rawText = extracted.text;
      sourceKind = extracted.sourceKind;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`Falha ao ler: ${msg}. Pulando.`);
      totalFailed += 1;
      allErrors.push(`${documentName}: ${msg}`);
      continue;
    }
    if (rawText.length < 100) {
      console.error(`Texto curto (${rawText.length}). Pulando.`);
      totalFailed += 1;
      continue;
    }

    const cleaned = normalizePdfText(rawText);
    console.log(`Texto: ${rawText.length} → ${cleaned.length} chars [${sourceKind}]`);
    const textChunks = recursiveCharacterTextSplit(cleaned, {
      chunkSize: CHUNK_SIZE,
      chunkOverlap: CHUNK_OVERLAP,
    });
    if (!textChunks.length) {
      console.error('Nenhum chunk. Pulando.');
      totalFailed += 1;
      continue;
    }
    console.log(`Chunks: ${textChunks.length}`);

    const deleted = await deleteChunksForSource(supabase, groupId, rel);
    if (deleted > 0) console.log(`Removidos ${deleted} chunks antigos (source_ref=${rel})`);

    const drafts = prepareChunks(groupId, tenantId, textChunks, rel, doc, sourceKind);
    const { success, failed, errors } = await upsertDrafts(supabase, drafts);
    totalSuccess += success;
    totalFailed += failed;
    allErrors.push(...errors.map((e) => `${documentName}: ${e}`));
  }

  const { count } = await supabase
    .from('eros_knowledge_chunks')
    .select('*', { count: 'exact', head: true })
    .eq('group_id', groupId);

  await supabase
    .from('eros_knowledge_agents')
    .update({
      chunk_count: count ?? totalSuccess,
      status: 'draft',
      last_error: allErrors.length ? allErrors.slice(0, 3).join(' | ') : null,
      updated_at: new Date().toISOString(),
    })
    .eq('group_id', groupId);

  console.log('\n=== Estatísticas ===');
  console.log(`Chunks OK: ${totalSuccess}`);
  console.log(`Chunks erro: ${totalFailed}`);
  console.log(`Total no grupo: ${count ?? 'n/a'}`);
  console.log('\nPróximo: npm run embed:mercado');
}

main().catch((err) => {
  console.error('Erro fatal:', err);
  process.exit(1);
});
