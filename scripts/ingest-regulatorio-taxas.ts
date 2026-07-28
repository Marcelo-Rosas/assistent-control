/**
 * Ingestão taxas municipais (legal_fees) → eros_knowledge_chunks (metadados only).
 *
 * Input:  data/raw/Regulatorio/taxas/*.json (exceto manifest.json)
 * Run:    npm run ingest:regulatorio-taxas
 *
 * Env:
 *   SUPABASE_URL | VITE_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *   REGULATORIO_GROUP_ID  (nunca use WELLHUB_GROUP_ID)
 *   TARGET_TENANT_ID (opcional)
 *   INPUT_DIR | BATCH_SIZE
 */
import fs from 'fs';
import path from 'path';
import { createHash } from 'crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const BATCH_SIZE = Number(process.env.BATCH_SIZE || 50);
const ROOT = process.cwd();
const DEFAULT_DIR = path.join(ROOT, 'data', 'raw', 'Regulatorio', 'taxas');

/** Wellhub UUID — nunca gravar regulatório nele. */
const WELLHUB_UUID_PREFIX = '553fa8d6';

const FEE_LABELS: Record<string, string> = {
  alvara_funcionamento_brl: 'Alvará de funcionamento (R$)',
  taxa_bombeiros_brl: 'Taxa de bombeiros (R$)',
  projeto_arquitetonico_cau_brl: 'Projeto arquitetônico CAU (R$)',
  vistoria_sanitaria_brl: 'Vistoria sanitária (R$)',
};

const PRAZO_LABELS: Record<string, string> = {
  alvara: 'Alvará',
  bombeiros: 'Bombeiros',
};

type FeeRange = {
  min?: number;
  max?: number;
  typico?: number;
  r_m2?: { min?: number; max?: number; typico?: number };
};

type TaxasDoc = {
  cidade: string;
  uf: string;
  fonte?: string;
  data_coleta?: string;
  revisao_pendente?: boolean;
  notas?: string;
  taxas?: Record<string, FeeRange>;
  prazo_meses_tipico?: Record<string, number>;
};

type ChunkDraft = {
  group_id: string;
  tenant_id: string | null;
  chunk_id: string;
  chunk_type: 'legal_fees';
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
  if (!fs.existsSync(filePath)) return;
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

function resolveTaxasDir(): string {
  const input = process.env.INPUT_DIR?.trim();
  const dir = input ? path.resolve(input) : DEFAULT_DIR;
  if (!fs.existsSync(dir)) {
    console.error(`Pasta não encontrada: ${dir}`);
    process.exit(1);
  }
  return dir;
}

function listCityJsonFiles(dir: string): string[] {
  return fs
    .readdirSync(dir)
    .filter((f) => f.toLowerCase().endsWith('.json') && f.toLowerCase() !== 'manifest.json')
    .sort((a, b) => a.localeCompare(b, 'pt-BR'))
    .map((f) => path.join(dir, f));
}

function contentHash(parts: string[]): string {
  return createHash('sha256').update(parts.join('|')).digest('hex');
}

function formatBrl(n: number | undefined): string | null {
  if (n == null || Number.isNaN(n)) return null;
  return n.toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    maximumFractionDigits: 2,
  });
}

function formatFeeBlock(key: string, fee: FeeRange): string {
  const label = FEE_LABELS[key] || key;
  const lines: string[] = [`### ${label}`];
  const min = formatBrl(fee.min);
  const max = formatBrl(fee.max);
  const typ = formatBrl(fee.typico);
  if (min && max && min === max) {
    lines.push(`- Valor: ${min}`);
  } else {
    if (min) lines.push(`- Mínimo: ${min}`);
    if (max) lines.push(`- Máximo: ${max}`);
    if (typ) lines.push(`- Típico: ${typ}`);
  }
  if (fee.r_m2) {
    const rMin = formatBrl(fee.r_m2.min);
    const rMax = formatBrl(fee.r_m2.max);
    const rTyp = formatBrl(fee.r_m2.typico);
    const parts: string[] = [];
    if (rMin) parts.push(`mín ${rMin}`);
    if (rMax) parts.push(`máx ${rMax}`);
    if (rTyp) parts.push(`típico ${rTyp}`);
    if (parts.length) lines.push(`- R$/m²: ${parts.join(' · ')}`);
  }
  return lines.join('\n');
}

function docToText(doc: TaxasDoc, slug: string): string {
  const header = [
    `Taxas municipais para academia — ${doc.cidade}/${doc.uf}`,
    `Documento: ${slug}.json`,
    `Fonte: ${doc.fonte || 'não informada'}`,
    `Data da coleta: ${doc.data_coleta || 'não informada'}`,
    doc.revisao_pendente ? 'Status: revisão pendente (estimativa piloto)' : 'Status: curado',
  ];

  const body: string[] = [];
  if (doc.notas) body.push(`Notas: ${doc.notas}`);

  if (doc.taxas && Object.keys(doc.taxas).length) {
    body.push('## Taxas (BRL)');
    for (const [key, fee] of Object.entries(doc.taxas)) {
      body.push(formatFeeBlock(key, fee));
    }
  }

  if (doc.prazo_meses_tipico && Object.keys(doc.prazo_meses_tipico).length) {
    body.push('## Prazos típicos (meses)');
    for (const [key, months] of Object.entries(doc.prazo_meses_tipico)) {
      const label = PRAZO_LABELS[key] || key;
      body.push(`- ${label}: ${months} mês(es)`);
    }
  }

  return [...header, '', ...body].join('\n').trim();
}

function prepareChunk(
  groupId: string,
  tenantId: string | null,
  doc: TaxasDoc,
  sourceRef: string,
  slug: string,
): ChunkDraft {
  const text = docToText(doc, slug);
  const hash = contentHash([groupId, 'legal_fees', slug, text]);
  const documentVersion = doc.data_coleta || new Date().toISOString().slice(0, 10);

  return {
    group_id: groupId,
    tenant_id: tenantId,
    chunk_id: `taxas-${slug}`,
    chunk_type: 'legal_fees',
    text,
    meta: {
      document_name: `${slug}.json`,
      source_folder: 'taxas',
      cidade: doc.cidade,
      /** Espelha cidade p/ match_municipio (RPC agregadores + regulatório). */
      municipios_relacionados: [doc.cidade],
      uf: doc.uf,
      slug,
      fonte: doc.fonte ?? null,
      data_coleta: doc.data_coleta ?? null,
      revisao_pendente: Boolean(doc.revisao_pendente),
      fee_keys: doc.taxas ? Object.keys(doc.taxas) : [],
      domain: 'regulatory',
      topic: 'municipal_legal_fees',
      chunking: 'chunking-v1-taxas-city',
      source_kind: 'json_upload',
      source_ref: sourceRef,
    },
    content_hash: hash,
    embedding_model: 'pending',
    embedding_version: '0',
    document_version: documentVersion,
    access_level: 'public',
    source_kind: 'json_upload',
    source_ref: sourceRef,
  };
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
    process.stdout.write(`\rProcessando lote ${n}/${totalBatches}…`);

    const { error } = await supabase.from('eros_knowledge_chunks').upsert(batch, {
      onConflict: 'group_id,content_hash',
    });

    if (error) {
      failed += batch.length;
      errors.push(`Lote ${n}: ${error.message}`);
      console.error(`\nUpsert lote ${n}: ${error.message}`);
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

  console.log('Ingestão Regulatório — taxas municipais (metadados only — sem embeddings)\n');

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
  const taxasDir = resolveTaxasDir();
  const files = listCityJsonFiles(taxasDir);

  if (files.length === 0) {
    console.error(`Nenhum JSON de cidade em ${path.relative(ROOT, taxasDir)}`);
    process.exit(1);
  }

  const supabase = createClient(supabaseUrl, supabaseKey);

  console.log(`group_id=${groupId} tenant_id=${tenantId ?? 'null'}`);
  console.log(`Pasta: ${path.relative(ROOT, taxasDir).replace(/\\/g, '/')}`);
  console.log(`Arquivos: ${files.length}\n`);

  const drafts: ChunkDraft[] = [];
  const perFile: { name: string; cidade: string; chars: number }[] = [];
  const parseErrors: string[] = [];

  for (const filePath of files) {
    const basename = path.basename(filePath);
    const slug = basename.replace(/\.json$/i, '');
    const rel = path.relative(ROOT, filePath).replace(/\\/g, '/');

    let raw: unknown;
    try {
      raw = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      parseErrors.push(`${basename}: JSON inválido (${msg})`);
      console.error(`  ✗ ${basename}: JSON inválido`);
      continue;
    }

    const doc = raw as TaxasDoc;
    if (!doc?.cidade || !doc?.uf) {
      parseErrors.push(`${basename}: faltam cidade/uf`);
      console.error(`  ✗ ${basename}: faltam cidade/uf`);
      continue;
    }

    const draft = prepareChunk(groupId, tenantId, doc, rel, slug);
    drafts.push(draft);
    perFile.push({ name: basename, cidade: `${doc.cidade}/${doc.uf}`, chars: draft.text.length });
    console.log(`  ✓ ${basename} → ${doc.cidade}/${doc.uf} (${draft.text.length} chars)`);
  }

  if (drafts.length === 0) {
    console.error('Nenhum chunk gerado.');
    process.exit(1);
  }

  console.log('');
  const { success, failed, errors } = await upsertDrafts(supabase, drafts);
  const allErrors = [...parseErrors, ...errors];

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
      chunk_count: count ?? success,
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
    console.log(`  ${f.name}: ${f.cidade} (${f.chars} chars)`);
  }
  console.log('\n=== Estatísticas ===');
  console.log(`Arquivos processados: ${perFile.length}`);
  console.log(`Chunks OK: ${success}`);
  console.log(`Chunks erro: ${failed}`);
  console.log(`Total no grupo: ${count ?? 'n/a'}`);
  console.log(`Pending embed: ${pending ?? 'n/a'}`);
  console.log('\nPróximo: npm run embed:regulatorio');
  console.log('Smoke:   LIMIT=3 npm run embed:regulatorio');
  if (allErrors.length) {
    for (const e of allErrors.slice(0, 8)) console.log(`  - ${e}`);
  }
}

main().catch((err) => {
  console.error('Erro fatal:', err);
  process.exit(1);
});
