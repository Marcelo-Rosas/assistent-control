/**
 * Ingestão docs curados Vertex → eros_knowledge_chunks (metadados only).
 *
 * Input (data/raw/Regulatorio/):
 *   regulatorio_anuidades_processo_2026.txt
 *   regulatorio_abertura_academia_ref.txt
 *   mapa_uf_cref_registro.txt
 *
 * Run:    npm run ingest:regulatorio-curado
 * Depois: npm run embed:regulatorio
 *
 * Env:
 *   SUPABASE_URL | VITE_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *   REGULATORIO_GROUP_ID
 *   TARGET_TENANT_ID (opcional)
 *   BATCH_SIZE
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
const REG_DIR = path.join(ROOT, 'data', 'raw', 'Regulatorio');
const CHUNKING_VERSION = 'chunking-v1-regulatorio-curado';
const WELLHUB_UUID_PREFIX = '553fa8d6';

const CURATED_DOCS: { file: string; tema: string; chunkType: string }[] = [
  {
    file: 'regulatorio_anuidades_processo_2026.txt',
    tema: 'anuidades_cref_2026',
    chunkType: 'legal_reference',
  },
  {
    file: 'regulatorio_abertura_academia_ref.txt',
    tema: 'abertura_academia',
    chunkType: 'legal_reference',
  },
  {
    file: 'mapa_uf_cref_registro.txt',
    tema: 'mapa_uf_cref',
    chunkType: 'legal_reference',
  },
  {
    file: 'regulatorio_cip_digital_2026.txt',
    tema: 'cip_digital',
    chunkType: 'legal_reference',
  },
  {
    file: 'regulatorio_fiscalizacao_protocolos_2026.txt',
    tema: 'fiscalizacao_protocolos',
    chunkType: 'legal_reference',
  },
];

type ChunkDraft = {
  group_id: string;
  tenant_id: string | null;
  chunk_id: string;
  chunk_type: string;
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
    process.env.REGULATORIO_GROUP_ID?.trim() ||
    process.env.TARGET_GROUP_ID?.trim() ||
    '';
  if (!id) {
    console.error(
      'Defina REGULATORIO_GROUP_ID (npm run setup:regulatorio). Não use WELLHUB_GROUP_ID.',
    );
    process.exit(1);
  }
  if (id.toLowerCase().startsWith(WELLHUB_UUID_PREFIX)) {
    console.error('REGULATORIO_GROUP_ID inválido (parece Wellhub). Rode setup:regulatorio.');
    process.exit(1);
  }
  const wellhub = process.env.WELLHUB_GROUP_ID?.trim();
  if (wellhub && id === wellhub) {
    console.error(
      'REGULATORIO_GROUP_ID não pode ser igual a WELLHUB_GROUP_ID. Rode npm run setup:regulatorio.',
    );
    process.exit(1);
  }
  return id;
}

function contentHash(parts: string[]): string {
  return createHash('sha256').update(parts.join('|')).digest('hex');
}

/** Prefer section / Q&A boundaries before generic recursive split. */
function splitCurated(text: string, tema: string): string[] {
  if (tema === 'mapa_uf_cref') {
    const parts = text
      .split(/(?=PERGUNTA:\s)/)
      .map((p) => p.trim())
      .filter((p) => p.length >= 40);
    if (parts.length >= 5) return parts;
  }

  if (tema === 'anuidades_cref_2026' || tema === 'abertura_academia') {
    const parts = text
      .split(/\n={5,}\n/)
      .map((p) => p.trim())
      .filter((p) => p.length >= 40);
    if (parts.length >= 2) {
      // Keep header glued to first section if header is short.
      const out: string[] = [];
      for (let i = 0; i < parts.length; i++) {
        const p = parts[i]!;
        if (i === 0 && p.length < 200 && parts[i + 1]) {
          out.push(`${p}\n\n${parts[i + 1]}`);
          i += 1;
          continue;
        }
        out.push(p);
      }
      // Section with full CREF table may exceed chunk size — recurse only then.
      return out.flatMap((block) => {
        if (block.length <= CHUNK_SIZE * 1.4) return [block];
        return recursiveCharacterTextSplit(block, {
          chunkSize: CHUNK_SIZE,
          chunkOverlap: CHUNK_OVERLAP,
          separators: ['\n- CREF', '\n\n', '\n', '. ', ' ', ''],
        });
      });
    }
  }

  return recursiveCharacterTextSplit(normalizePdfText(text), {
    chunkSize: CHUNK_SIZE,
    chunkOverlap: CHUNK_OVERLAP,
  });
}

function prepareChunks(
  groupId: string,
  tenantId: string | null,
  textChunks: string[],
  sourceRef: string,
  documentName: string,
  tema: string,
  chunkType: string,
): ChunkDraft[] {
  const documentVersion = new Date().toISOString().slice(0, 10);

  return textChunks.map((chunkText, i) => {
    const hash = contentHash([groupId, chunkType, documentName, String(i), chunkText]);
    const chunkId = `reg-curado-${hash.substring(0, 16)}`;

    return {
      group_id: groupId,
      tenant_id: tenantId,
      chunk_id: chunkId,
      chunk_type: chunkType,
      text: chunkText,
      meta: {
        document_name: documentName,
        tema,
        chunk_index: i,
        total_chunks: textChunks.length,
        domain: 'regulatory',
        topic: tema,
        curated_from: 'vertex_gymsite_regulatorio',
        chunking: CHUNKING_VERSION,
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

  console.log('Ingestão Regulatório — docs curados Vertex (metadados only)\n');
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

  const supabase = createClient(supabaseUrl, supabaseKey);

  console.log(`group_id=${groupId} tenant_id=${tenantId ?? 'null'}\n`);

  let totalSuccess = 0;
  let totalFailed = 0;
  const allErrors: string[] = [];
  const perFile: {
    name: string;
    chunks: number;
    chars: number;
    deleted: number;
    tema: string;
  }[] = [];

  for (const doc of CURATED_DOCS) {
    const inputPath = path.join(REG_DIR, doc.file);
    if (!fs.existsSync(inputPath)) {
      console.error(`✗ Ausente: ${inputPath}`);
      totalFailed += 1;
      allErrors.push(`${doc.file}: arquivo ausente`);
      continue;
    }

    const rel = path.relative(ROOT, inputPath).replace(/\\/g, '/');
    console.log(`--- ${doc.file} (tema=${doc.tema}) ---`);

    const rawText = (await fs.promises.readFile(inputPath, 'utf-8')).trim();
    if (rawText.length < 50) {
      console.error(`Texto muito curto (${rawText.length} chars). Pulando.`);
      totalFailed += 1;
      allErrors.push(`${doc.file}: texto curto`);
      continue;
    }

    console.log(`Texto: ${rawText.length} chars`);
    const textChunks = splitCurated(rawText, doc.tema);
    if (textChunks.length === 0) {
      console.error('Nenhum chunk gerado. Pulando.');
      totalFailed += 1;
      allErrors.push(`${doc.file}: nenhum chunk`);
      continue;
    }
    console.log(`Chunks: ${textChunks.length}`);

    const hasCref3 = textChunks.some((c) => /CREF3|Santa Catarina/i.test(c));
    const hasBase = textChunks.some((c) => /1\.569,68|1569,68/.test(c));
    if (doc.tema === 'anuidades_cref_2026') {
      console.log(`Smoke texto: CREF3=${hasCref3} base_1569=${hasBase}`);
      if (!hasCref3 || !hasBase) {
        allErrors.push(`${doc.file}: smoke CREF3/base falhou antes do upsert`);
      }
    }

    const deleted = await deleteChunksForSource(supabase, groupId, rel);
    if (deleted > 0) {
      console.log(`Removidos ${deleted} chunks antigos (source_ref=${rel})`);
    }

    const drafts = prepareChunks(
      groupId,
      tenantId,
      textChunks,
      rel,
      doc.file,
      doc.tema,
      doc.chunkType,
    );
    const { success, failed, errors } = await upsertDrafts(supabase, drafts);
    totalSuccess += success;
    totalFailed += failed;
    allErrors.push(...errors.map((e) => `${doc.file}: ${e}`));
    perFile.push({
      name: doc.file,
      tema: doc.tema,
      chunks: textChunks.length,
      chars: rawText.length,
      deleted,
    });
  }

  const { count } = await supabase
    .from('eros_knowledge_chunks')
    .select('*', { count: 'exact', head: true })
    .eq('group_id', groupId);

  const { count: pending } = await supabase
    .from('eros_knowledge_chunks')
    .select('*', { count: 'exact', head: true })
    .eq('group_id', groupId)
    .eq('embedding_model', 'pending');

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
  console.log(`Pending embed: ${pending ?? 'n/a'}`);
  console.log('\nPróximo: npm run embed:regulatorio');
  if (allErrors.length) {
    for (const e of allErrors.slice(0, 8)) console.log(`  - ${e}`);
  }

  if (totalSuccess === 0) process.exit(1);
}

main().catch((err) => {
  console.error('Erro fatal:', err);
  process.exit(1);
});
