/**
 * Ingestão TotalPass SP (estado) → eros_knowledge_chunks.
 * APENAS preparação + upsert de texto/metadados.
 * Sem embedding API, sem retrieval, sem LLM (AGENTS.md regra 2).
 *
 * Input:  data/processed/totalpass-sp-all.json
 * Run:    npx tsx scripts/ingest-totalpass-sp.ts
 *
 * Env:
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *   TOTALPASS_GROUP_ID   (uuid do grupo knowledge)
 *   TARGET_TENANT_ID    (opcional; vazio = null/global)
 *   INPUT_PATH          (opcional)
 *   BATCH_SIZE=50
 */
import fs from 'fs/promises';
import path from 'path';
import { createHash } from 'crypto';
import { createClient } from '@supabase/supabase-js';
import { PLANO_RANK, modalityToMetaKey } from '../src/lib/modalityClassifier';

type PlanRef = {
  name?: string;
  price?: number;
};

type GymAttributes = {
  name?: string;
  slug?: string;
  full_address?: string;
  location?: { lat?: number; lng?: number };
  warning_message?: string;
  accessible_from_company_plan?: PlanRef;
  accessible_on_plans?: PlanRef[];
  featured_modality_id?: string | number;
  municipios_relacionados?: string[];
  [key: string]: unknown;
};

type Gym = {
  id: string;
  type?: string;
  attributes: GymAttributes;
};

type InputFile = {
  data: Gym[];
};

/** Payload interno (embedding_content removido antes do upsert). */
type ChunkDraft = {
  group_id: string;
  tenant_id: string | null;
  chunk_id: string;
  chunk_type: string;
  text: string;
  embedding_content: string;
  meta: Record<string, unknown>;
  content_hash: string;
  embedding_model: string;
  embedding_version: string;
  document_version: string;
  access_level: 'public';
  source_kind: string;
  source_ref: string | null;
};

const MODALITY_MAP: Record<string, string> = {
  '106': 'Musculação/Academia Geral',
  '111': 'Pilates',
  '2002': 'Pilates/Fisioterapia',
  '361': 'Spa',
  '192': 'Natação/Aquático',
  '43': 'Funcional/Crossfit',
  '105': 'Lutas',
  '167': 'Yoga',
  '246': 'Pilates Clássico',
  '1975': 'Artes Marciais/Lutas',
  '226': 'Eletroestimulação',
  '1980': 'Musculação',
  '1846': 'Jiu Jitsu',
  '93': 'Kung Fu/Artes Marciais',
  '242': 'Futebol/Soccer',
  '213': 'Wellness',
  '245': 'Personal Trainer',
  '224': 'Reabilitação',
  '1998': 'Saúde/Bem-estar',
  '63': 'Dança',
  '90': 'Lutas',
  '86': 'Jiu Jitsu',
  '83': 'MMA/Lutas',
  '45': 'Funcional',
  '272': 'Beach Tennis',
  '30': 'Ginástica',
  '41': 'Funcional',
  '159': 'Funcional',
  '160': 'Pilates',
  '2106': 'Fisioterapia/Saúde',
  '3': 'Outros',
  '26': 'Outros',
  '179': 'Outros',
  '1741': 'Outros',
  '264': 'Outros',
  '191': 'Outros',
  '2001': 'Outros',
  '114': 'Pole Dance',
  '44': 'Cross Training',
  '23': 'Boxe',
  '49': 'Dança',
  '50': 'Dança Árabe',
  '65': 'Forró/Dança',
  '66': 'Ginástica/Artes Marciais',
  '1912': 'Cross Training',
  '1972': 'Kickboxing',
  '304': 'Beach Tennis',
  '2000': 'Bootcamp/Funcional',
};

const DEFAULT_MODALITY = 'Academia Geral/Outros';
const BATCH_SIZE = Number(process.env.BATCH_SIZE || 50);
const ROOT = process.cwd();
const INPUT_PATH =
  process.env.INPUT_PATH || path.join(ROOT, 'data/processed/totalpass-sp-all.json');

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
    process.env.TOTALPASS_GROUP_ID?.trim() || process.env.TARGET_GROUP_ID?.trim() || '';
  if (!id) {
    console.error('Defina TOTALPASS_GROUP_ID (ou TARGET_GROUP_ID)');
    process.exit(1);
  }
  return id;
}

function mapModality(id: string | number | undefined | null): string {
  if (id === undefined || id === null || id === '') return DEFAULT_MODALITY;
  return MODALITY_MAP[String(id)] || DEFAULT_MODALITY;
}

function planNames(attrs: GymAttributes): string[] {
  const fromList = (attrs.accessible_on_plans || [])
    .map((p) => (p?.name || '').trim())
    .filter(Boolean);
  if (fromList.length) return Array.from(new Set(fromList));

  const min = attrs.accessible_from_company_plan?.name?.trim();
  return min ? [min] : [];
}

function minPlanRank(planos: string[]): number {
  let min = 99;
  for (const p of planos) {
    const r = PLANO_RANK[p];
    if (typeof r === 'number' && r < min) min = r;
  }
  return min;
}

function buildText(opts: {
  nome: string;
  endereco: string;
  municipios: string[];
  modalidade: string;
  planos: string[];
  warning: string | null;
}): string {
  const lines = [
    `Academia: ${opts.nome}`,
    `Endereço: ${opts.endereco}`,
    `Municípios Atendidos: ${opts.municipios.join(', ') || 'N/D'}`,
    `Modalidade Principal: ${opts.modalidade}`,
    `Planos TotalPass Aceitos: ${opts.planos.join(', ') || 'N/D'}`,
  ];
  if (opts.warning) lines.push(`Observação: ${opts.warning}`);
  return lines.join('\n');
}

function buildEmbeddingContent(opts: {
  nome: string;
  endereco: string;
  municipios: string[];
  modalidade: string;
  planos: string[];
  warning: string | null;
}): string {
  const munis = opts.municipios.join(', ') || 'município não informado';
  const planos = opts.planos.join(', ') || 'planos não informados';
  let s =
    `A ${opts.nome}, localizada em ${opts.endereco}, atende os municípios de ${munis}. ` +
    `Sua modalidade principal é ${opts.modalidade} e aceita os planos TotalPass: ${planos}.`;
  if (opts.warning) s += ` Observação: ${opts.warning}.`;
  return s;
}

function gymToChunk(
  gym: Gym,
  groupId: string,
  tenantId: string | null,
  documentVersion: string,
): ChunkDraft | null {
  if (!gym?.id || typeof gym.id !== 'string') return null;

  const attrs = gym.attributes || {};
  const nome = (attrs.name || '').trim() || 'Academia sem nome';
  const endereco = (attrs.full_address || '').trim() || 'Endereço não informado';
  const municipios = Array.isArray(attrs.municipios_relacionados)
    ? attrs.municipios_relacionados.filter((m) => typeof m === 'string' && m.trim())
    : [];
  const modalidadeLabel = mapModality(attrs.featured_modality_id);
  const planos = planNames(attrs);
  const warningRaw = (attrs.warning_message || '').trim() || null;
  // Warnings de marketing TotalPass às vezes têm milhares de chars — corta pra RAG + embed
  const warning =
    warningRaw && warningRaw.length > 280 ? `${warningRaw.slice(0, 277).trim()}…` : warningRaw;
  const slug = (attrs.slug || '').trim() || null;

  const hash = createHash('sha256').update(gym.id).digest('hex');

  const text = buildText({
    nome,
    endereco,
    municipios,
    modalidade: modalidadeLabel,
    planos,
    warning,
  });
  const embedding_content = buildEmbeddingContent({
    nome,
    endereco,
    municipios,
    modalidade: modalidadeLabel,
    planos,
    warning,
  });

  return {
    group_id: groupId,
    tenant_id: tenantId,
    chunk_id: hash,
    chunk_type: 'gym_listing',
    text,
    embedding_content,
    meta: {
      nome_academia: nome,
      endereco,
      municipios_relacionados: municipios,
      modalidade: modalidadeLabel,
      modalidade_key: modalityToMetaKey(modalidadeLabel),
      planos_aceitos: planos,
      plano_minimo: planos[0] || null,
      plano_minimo_rank: minPlanRank(planos),
      featured_modality_id: attrs.featured_modality_id
        ? String(attrs.featured_modality_id)
        : null,
      location: attrs.location || null,
      gym_id: gym.id,
      source_kind: 'totalpass_api',
      source_ref: slug,
      warning_message: warning,
      chunking: 'chunking-v1-sp-api-listing',
    },
    content_hash: hash,
    // Placeholder — vetorização em processo separado
    embedding_model: 'pending',
    embedding_version: '0',
    document_version: documentVersion,
    access_level: 'public',
    source_kind: 'totalpass_api',
    source_ref: slug,
  };
}

async function main(): Promise<void> {
  console.log('Ingestão TotalPass SP (metadados only — sem embeddings)\n');

  const supabaseUrl = requireEnv('SUPABASE_URL');
  const supabaseKey = requireEnv('SUPABASE_SERVICE_ROLE_KEY');
  const groupId = resolveGroupId();
  const tenantRaw = process.env.TARGET_TENANT_ID?.trim() || '';
  const tenantId = tenantRaw.length ? tenantRaw : null;

  const supabase = createClient(supabaseUrl, supabaseKey);

  let parsed: InputFile;
  try {
    parsed = JSON.parse(await fs.readFile(INPUT_PATH, 'utf-8')) as InputFile;
  } catch (err) {
    console.error(`Falha ao ler ${INPUT_PATH}:`, err instanceof Error ? err.message : err);
    process.exit(1);
  }

  if (!parsed || !Array.isArray(parsed.data)) {
    console.error('JSON inválido: esperado { data: Gym[] }');
    process.exit(1);
  }

  const documentVersion = new Date().toISOString().slice(0, 10);
  const drafts: ChunkDraft[] = [];
  let skipped = 0;

  for (const gym of parsed.data) {
    const chunk = gymToChunk(gym, groupId, tenantId, documentVersion);
    if (!chunk) {
      skipped += 1;
      continue;
    }
    drafts.push(chunk);
  }

  console.log(`Academias no JSON: ${parsed.data.length}`);
  console.log(`Chunks válidos: ${drafts.length} (skipped=${skipped})`);
  console.log(`group_id=${groupId} tenant_id=${tenantId ?? 'null'}`);
  console.log(`BATCH_SIZE=${BATCH_SIZE}\n`);

  let success = 0;
  let failed = 0;
  const errors: string[] = [];
  const totalBatches = Math.ceil(drafts.length / BATCH_SIZE) || 1;

  for (let i = 0; i < drafts.length; i += BATCH_SIZE) {
    const batch = drafts.slice(i, i + BATCH_SIZE);
    const n = Math.floor(i / BATCH_SIZE) + 1;
    process.stdout.write(`\rProcessando lote ${n}/${totalBatches}…`);

    // Regra 2: strip embedding_content — não é coluna; vetor em job separado
    const rows = batch.map(({ embedding_content: _ec, ...row }) => row);

    const { error } = await supabase.from('eros_knowledge_chunks').upsert(rows, {
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

  console.log('\n');

  const { count } = await supabase
    .from('eros_knowledge_chunks')
    .select('*', { count: 'exact', head: true })
    .eq('group_id', groupId);

  await supabase.from('eros_knowledge_agents').upsert(
    {
      group_id: groupId,
      name: 'TotalPass SP',
      status: 'draft',
      chunk_count: count ?? success,
      last_trained_at: null,
      last_error: errors.length ? errors.slice(0, 3).join(' | ') : null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'group_id' },
  );

  console.log('=== Estatísticas ===');
  console.log(`Academias processadas: ${drafts.length}`);
  console.log(`Chunks upsert OK: ${success}`);
  console.log(`Chunks com erro: ${failed}`);
  console.log(`Total no grupo: ${count ?? 'n/a'}`);
  console.log('Status agente: draft (embeddings ainda pending)');
  if (errors.length) {
    console.log('Erros (até 5):');
    for (const e of errors.slice(0, 5)) console.log(`  - ${e}`);
  }
}

main().catch((err) => {
  console.error('Erro fatal na ingestão:', err);
  process.exit(1);
});
