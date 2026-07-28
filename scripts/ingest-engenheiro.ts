/**
 * Ingestão refs de engenharia de obra → eros_knowledge_chunks (metadados only).
 *
 * Input:  *.txt em data/raw/engenheiro/ (ou INPUT_PATH para um arquivo)
 * Run:    npm run ingest:engenheiro
 *
 * Env:
 *   SUPABASE_URL | VITE_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *   ENGENHEIRO_GROUP_ID
 *   TARGET_TENANT_ID (opcional)
 *   INPUT_PATH | BATCH_SIZE
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
const ENGENHEIRO_DIR = path.join(ROOT, 'data', 'raw', 'engenheiro');
const CHUNKING_VERSION = 'chunking-v2-engenheiro-recursive';

const FORBIDDEN_GROUP_IDS = new Set([
  '553fa8d6-e3d2-440a-ba0b-867fb5363627',
  '4d1e2c40-217b-4a39-bc08-f9c3e90fd803',
  '6ab0c39b-bf81-4840-9dcc-ed5f5cc86117',
  'b7dad505-2d2a-49a9-bbaf-d4b9c4929dea',
]);

type DocMeta = {
  documentName: string;
  tema: string;
};

type ChunkDraft = {
  group_id: string;
  tenant_id: string | null;
  chunk_id: string;
  chunk_type: 'engineering_reference';
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

const TEMA_BY_FILE: Record<string, string> = {
  engenharia_climatizacao_academia_ref: 'climatizacao',
  engenharia_dimensionamento_academia_ref: 'dimensionamento',
  engenharia_layout_academia_ref: 'layout',
  engenharia_obra_academia_ref: 'obra',
};

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
    process.env.ENGENHEIRO_GROUP_ID?.trim() ||
    process.env.TARGET_GROUP_ID?.trim() ||
    '';
  if (!id) {
    console.error('Defina ENGENHEIRO_GROUP_ID (npm run setup:engenheiro).');
    process.exit(1);
  }
  if (FORBIDDEN_GROUP_IDS.has(id.toLowerCase())) {
    console.error(`ENGENHEIRO_GROUP_ID=${id} é UUID de outro domínio. Rode setup:engenheiro.`);
    process.exit(1);
  }
  for (const envKey of [
    'WELLHUB_GROUP_ID',
    'GURUPASS_GROUP_ID',
    'TOTALPASS_GROUP_ID',
    'REGULATORIO_GROUP_ID',
    'MERCADO_GROUP_ID',
  ] as const) {
    const other = process.env[envKey]?.trim();
    if (other && id === other) {
      console.error(`ENGENHEIRO_GROUP_ID não pode ser igual a ${envKey}.`);
      process.exit(1);
    }
  }
  return id;
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

  if (!fs.existsSync(ENGENHEIRO_DIR)) {
    console.error(`Pasta não encontrada: ${ENGENHEIRO_DIR}`);
    process.exit(1);
  }

  const docs = fs
    .readdirSync(ENGENHEIRO_DIR)
    .filter((f) => path.extname(f).toLowerCase() === '.txt')
    .sort((a, b) => a.localeCompare(b, 'pt-BR'))
    .map((f) => path.join(ENGENHEIRO_DIR, f));

  if (docs.length === 0) {
    console.error(`Nenhum .txt em ${path.relative(ROOT, ENGENHEIRO_DIR)}`);
    process.exit(1);
  }
  return docs;
}

function inferDocMeta(filePath: string): DocMeta {
  const documentName = path.basename(filePath);
  const stem = path.basename(filePath, path.extname(filePath));
  const tema = TEMA_BY_FILE[stem] ?? 'geral';
  return { documentName, tema };
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
): ChunkDraft[] {
  const documentVersion = new Date().toISOString().slice(0, 10);

  return textChunks.map((chunkText, i) => {
    const hash = contentHash([
      groupId,
      'engineering_reference',
      doc.documentName,
      String(i),
      chunkText,
    ]);
    const chunkId = `eng-${hash.substring(0, 16)}`;

    return {
      group_id: groupId,
      tenant_id: tenantId,
      chunk_id: chunkId,
      chunk_type: 'engineering_reference' as const,
      text: chunkText,
      meta: {
        document_name: doc.documentName,
        tema: doc.tema,
        chunk_index: i,
        total_chunks: textChunks.length,
        source_type: 'engineering_guide',
        domain: 'engineering',
        chunking: CHUNKING_VERSION,
        chunk_size: CHUNK_SIZE,
        chunk_overlap: CHUNK_OVERLAP,
        source_kind: 'txt_upload',
        source_ref: sourceRef,
      },
      content_hash: hash,
      embedding_model: 'pending',
      embedding_version: '0',
      document_version: documentVersion,
      access_level: 'public' as const,
      source_kind: 'txt_upload',
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

  if (error) {
    throw new Error(`Falha ao limpar source_ref=${sourceRef}: ${error.message}`);
  }
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

  console.log('Ingestão Engenharia de Obra (metadados only — sem embeddings)\n');
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
  const perFile: { name: string; chunks: number; chars: number; deleted: number; tema: string }[] =
    [];

  for (const inputPath of docPaths) {
    const doc = inferDocMeta(inputPath);
    const rel = path.relative(ROOT, inputPath).replace(/\\/g, '/');
    console.log(`--- ${doc.documentName} (tema=${doc.tema}) ---`);

    const rawText = (await fs.promises.readFile(inputPath, 'utf-8')).trim();
    if (rawText.length < 50) {
      console.error(`Texto muito curto (${rawText.length} chars). Pulando.`);
      totalFailed += 1;
      allErrors.push(`${doc.documentName}: texto curto`);
      continue;
    }

    const cleaned = normalizePdfText(rawText);
    console.log(`Texto: ${rawText.length} → ${cleaned.length} chars`);

    const textChunks = recursiveCharacterTextSplit(cleaned, {
      chunkSize: CHUNK_SIZE,
      chunkOverlap: CHUNK_OVERLAP,
    });
    if (textChunks.length === 0) {
      console.error('Nenhum chunk gerado. Pulando.');
      totalFailed += 1;
      allErrors.push(`${doc.documentName}: nenhum chunk`);
      continue;
    }
    console.log(`Chunks: ${textChunks.length}`);

    const deleted = await deleteChunksForSource(supabase, groupId, rel);
    if (deleted > 0) {
      console.log(`Removidos ${deleted} chunks antigos (source_ref=${rel})`);
    }

    const drafts = prepareChunks(groupId, tenantId, textChunks, rel, doc);
    const { success, failed, errors } = await upsertDrafts(supabase, drafts);
    totalSuccess += success;
    totalFailed += failed;
    allErrors.push(...errors.map((e) => `${doc.documentName}: ${e}`));
    perFile.push({
      name: doc.documentName,
      tema: doc.tema,
      chunks: textChunks.length,
      chars: cleaned.length,
      deleted,
    });
  }

  const { count } = await supabase
    .from('eros_knowledge_chunks')
    .select('*', { count: 'exact', head: true })
    .eq('group_id', groupId);

  const { error: agentError } = await supabase
    .from('eros_knowledge_agents')
    .update({
      chunk_count: count ?? totalSuccess,
      status: 'draft',
      last_error: allErrors.length ? allErrors.slice(0, 3).join(' | ') : null,
      updated_at: new Date().toISOString(),
    })
    .eq('group_id', groupId);

  if (agentError) {
    console.error('Falha ao atualizar agente:', agentError.message);
  }

  console.log('\n=== Por arquivo ===');
  for (const f of perFile) {
    console.log(
      `  ${f.name} [${f.tema}]: ${f.chunks} chunks (${f.chars} chars)${f.deleted ? ` · −${f.deleted} antigos` : ''}`,
    );
  }
  console.log('\n=== Estatísticas ===');
  console.log(`Chunks OK: ${totalSuccess}`);
  console.log(`Chunks erro: ${totalFailed}`);
  console.log(`Total no grupo: ${count ?? 'n/a'}`);
  console.log('\nPróximo: npm run embed:engenheiro');
  console.log('Smoke:   LIMIT=5 npm run embed:engenheiro');
  if (allErrors.length) {
    for (const e of allErrors.slice(0, 8)) console.log(`  - ${e}`);
  }
}

main().catch((err) => {
  console.error('Erro fatal:', err);
  process.exit(1);
});
