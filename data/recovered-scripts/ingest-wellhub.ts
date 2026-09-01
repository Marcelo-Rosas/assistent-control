/**
 * Ingestão Wellhub → eros_knowledge_chunks.
 * APENAS metadados/texto. Sem embedding API (job separado).
 *
 * Input:  data/processed/wellhub-normalized.json
 * Run:    npm run ingest:wellhub
 *
 * Env (.env / .env.local):
 *   SUPABASE_URL | VITE_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *   WELLHUB_GROUP_ID
 *   TARGET_TENANT_ID  (opcional)
 *   INPUT_PATH        (opcional)
 *   BATCH_SIZE=50
 */
import fs from 'fs';
import fsPromises from 'fs/promises';
import path from 'path';
import { createHash } from 'crypto';
import { createClient } from '@supabase/supabase-js';
import { modalityToMetaKey, normalizeBairro } from '../src/lib/modalityClassifier';

type ModalidadeExtraida = {
  nome: string;
  plano_minimo: string;
};

type AcademiaWellhub = {
  id_externo: string;
  nome: string;
  cidade: string;
  endereco: string;
  plano_minimo: string;
  valor_plano_minimo?: string;
  warning_message?: string;
  lat?: number | null;
  lng?: number | null;
  modalidades_extraidas?: ModalidadeExtraida[];
  enriquecimento_status?: string;
  source_aggregator?: string;
};

type ChunkDraft = {
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
  source_kind: string;
  source_ref: string | null;
};

/** Hierarquia Wellhub (barato → caro). */
const WELLHUB_PLANO_RANK: Record<string, number> = {
  'Wellhub Basic': 1,
  'Wellhub Basic+': 1,
  'Wellhub Silver': 2,
  'Wellhub Silver+': 2,
  'Wellhub Gold': 3,
  'Wellhub Gold+': 3,
  'Wellhub Platinum': 4,
  'Wellhub Diamond': 5,
  'Wellhub Diamond+': 5,
  Basic: 1,
  'Basic+': 1,
  Silver: 2,
  'Silver+': 2,
  Gold: 3,
  'Gold+': 3,
  Platinum: 4,
  Diamond: 5,
  'Diamond+': 5,
};

const BATCH_SIZE = Number(process.env.BATCH_SIZE || 50);
const ROOT = process.cwd();
const INPUT_PATH =
  process.env.INPUT_PATH || path.join(ROOT, 'data/processed/wellhub-normalized.json');

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
    // strip inline comment after value
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
  const id =
    process.env.WELLHUB_GROUP_ID?.trim() || process.env.TARGET_GROUP_ID?.trim() || '';
  if (!id) {
    console.error('Defina WELLHUB_GROUP_ID (ou TARGET_GROUP_ID)');
    process.exit(1);
  }
  return id;
}

function contentHash(parts: string[]): string {
  return createHash('sha256').update(parts.join('|')).digest('hex');
}

function extractBairro(endereco: string): string {
  // "R. X, 211 - Bela Vista, São Paulo - SP, ..."
  const m = String(endereco || '').match(/-\s*([^,]+),\s*[^,]+-\s*[A-Z]{2}/);
  return m?.[1]?.trim() || '';
}

function planoRank(plano: string | null | undefined): number {
  if (!plano) return 99;
  return WELLHUB_PLANO_RANK[plano] ?? 99;
}

function buildText(
  ac: AcademiaWellhub,
  bairro: string,
  mod: ModalidadeExtraida | null,
): string {
  const lines = [
    `Academia: ${ac.nome}`,
    `Endereço: ${ac.endereco}`,
    `Cidade: ${ac.cidade}`,
  ];
  if (bairro) lines.push(`Bairro: ${bairro}`);

  if (mod) {
    lines.push(`Modalidade: ${mod.nome}`);
    lines.push(`Plano mínimo Wellhub para esta modalidade: ${mod.plano_minimo}`);
  } else {
    if (ac.plano_minimo) lines.push(`Plano mínimo Wellhub: ${ac.plano_minimo}`);
    if (ac.valor_plano_minimo) lines.push(`Valor referência do plano: ${ac.valor_plano_minimo}`);
  }

  if (ac.warning_message) lines.push(`Observação: ${ac.warning_message}`);
  return lines.join('\n');
}

function buildEmbeddingContent(
  ac: AcademiaWellhub,
  bairro: string,
  mod: ModalidadeExtraida | null,
): string {
  const where = bairro
    ? `no bairro ${bairro}, ${ac.cidade}`
    : `em ${ac.cidade}`;
  const parts = [
    `Academia ${ac.nome} ${where}, endereço ${ac.endereco}.`,
  ];
  if (mod) {
    parts.push(`Oferece a modalidade ${mod.nome}.`);
    parts.push(
      `O plano Wellhub mínimo necessário para ${mod.nome} é ${mod.plano_minimo}.`,
    );
  } else if (ac.plano_minimo) {
    parts.push(`Aceita Wellhub a partir do plano ${ac.plano_minimo}.`);
  }
  if (ac.warning_message) parts.push(ac.warning_message);
  return parts.join(' ');
}

function prepareWellhubChunks(
  groupId: string,
  tenantId: string | null,
  academias: AcademiaWellhub[],
): ChunkDraft[] {
  const chunks: ChunkDraft[] = [];
  const documentVersion = new Date().toISOString().slice(0, 10);

  for (const ac of academias) {
    if (!ac?.id_externo || !ac.nome) continue;

    const bairro = extractBairro(ac.endereco);
    const bairroNorm = normalizeBairro(bairro);
    const modalidades = ac.modalidades_extraidas ?? [];
    const location =
      typeof ac.lat === 'number' && typeof ac.lng === 'number'
        ? { lat: ac.lat, lng: ac.lng }
        : null;

    if (modalidades.length === 0) {
      const hash = contentHash([groupId, 'wellhub', ac.id_externo, 'listing']);
      chunks.push({
        group_id: groupId,
        tenant_id: tenantId,
        chunk_id: `wh-fallback-${hash.substring(0, 16)}`,
        chunk_type: 'gym_listing',
        text: buildText(ac, bairro, null),
        embedding_content: buildEmbeddingContent(ac, bairro, null),
        meta: {
          nome_academia: ac.nome,
          cidade: ac.cidade,
          bairro: bairro || null,
          bairro_normalizado: bairroNorm || null,
          endereco: ac.endereco,
          municipios_relacionados: ac.cidade ? [ac.cidade] : [],
          plano_minimo: ac.plano_minimo || null,
          plano_minimo_rank: planoRank(ac.plano_minimo),
          valor_plano_minimo: ac.valor_plano_minimo || null,
          modalidade: 'academia_geral',
          modalidade_key: 'academia_geral',
          modalidade_confidence: 0,
          modalidade_method: 'fallback',
          modalidades_secundarias: [],
          location,
          gym_id: ac.id_externo,
          source_kind: 'wellhub_normalized',
          source_ref: ac.id_externo,
          warning_message: ac.warning_message || null,
          aggregator: 'wellhub',
          chunking: 'chunking-v1-wellhub-modality',
        },
        content_hash: hash,
        embedding_model: 'pending',
        embedding_version: '0',
        document_version: documentVersion,
        access_level: 'public',
        source_kind: 'wellhub_normalized',
        source_ref: ac.id_externo,
      });
      continue;
    }

    for (const mod of modalidades) {
      const hash = contentHash([
        groupId,
        'wellhub',
        ac.id_externo,
        mod.nome,
        mod.plano_minimo,
      ]);
      const modalidadeKey = modalityToMetaKey(mod.nome);

      chunks.push({
        group_id: groupId,
        tenant_id: tenantId,
        chunk_id: `wh-${hash.substring(0, 16)}`,
        chunk_type: 'gym_modality',
        text: buildText(ac, bairro, mod),
        embedding_content: buildEmbeddingContent(ac, bairro, mod),
        meta: {
          nome_academia: ac.nome,
          cidade: ac.cidade,
          bairro: bairro || null,
          bairro_normalizado: bairroNorm || null,
          endereco: ac.endereco,
          municipios_relacionados: ac.cidade ? [ac.cidade] : [],
          modalidade: modalidadeKey,
          modalidade_label: mod.nome,
          modalidade_key: modalidadeKey,
          modalidade_confidence: 1,
          modalidade_method: 'normalized',
          modalidades_secundarias: modalidades
            .filter((m) => m.nome !== mod.nome)
            .map((m) => modalityToMetaKey(m.nome)),
          plano_minimo: mod.plano_minimo,
          plano_minimo_rank: planoRank(mod.plano_minimo),
          valor_plano_minimo: ac.valor_plano_minimo || null,
          location,
          gym_id: ac.id_externo,
          source_kind: 'wellhub_normalized',
          source_ref: ac.id_externo,
          warning_message: ac.warning_message || null,
          aggregator: 'wellhub',
          chunking: 'chunking-v1-wellhub-modality',
        },
        content_hash: hash,
        embedding_model: 'pending',
        embedding_version: '0',
        document_version: documentVersion,
        access_level: 'public',
        source_kind: 'wellhub_normalized',
        source_ref: ac.id_externo,
      });
    }
  }

  return chunks;
}

async function main(): Promise<void> {
  loadDotEnv(path.join(ROOT, '.env'));
  loadDotEnv(path.join(ROOT, '.env.local'));

  console.log('Ingestão Wellhub (metadados only — sem embeddings)\n');

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

  let academias: AcademiaWellhub[];
  try {
    academias = JSON.parse(
      await fsPromises.readFile(INPUT_PATH, 'utf-8'),
    ) as AcademiaWellhub[];
  } catch (err) {
    console.error(`Falha ao ler ${INPUT_PATH}:`, err instanceof Error ? err.message : err);
    console.error('Rode antes: npx tsx scripts/normalize-wellhub-data.ts');
    process.exit(1);
  }

  if (!Array.isArray(academias)) {
    console.error('JSON inválido: esperado AcademiaWellhub[]');
    process.exit(1);
  }

  const drafts = prepareWellhubChunks(groupId, tenantId, academias);

  console.log(`Academias no JSON: ${academias.length}`);
  console.log(`Chunks: ${drafts.length}`);
  console.log(
    `  gym_modality: ${drafts.filter((c) => c.chunk_type === 'gym_modality').length}`,
  );
  console.log(
    `  gym_listing:  ${drafts.filter((c) => c.chunk_type === 'gym_listing').length}`,
  );
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

  const { error: agentError } = await supabase
    .from('eros_knowledge_agents')
    .update({
      chunk_count: count ?? success,
      status: 'draft',
      last_error: errors.length ? errors.slice(0, 3).join(' | ') : null,
      updated_at: new Date().toISOString(),
    })
    .eq('group_id', groupId);

  if (agentError) {
    console.error('Falha ao atualizar agente:', agentError.message);
  }

  console.log('=== Estatísticas ===');
  console.log(`Academias processadas: ${academias.length}`);
  console.log(`Chunks upsert OK: ${success}`);
  console.log(`Chunks com erro: ${failed}`);
  console.log(`Total no grupo: ${count ?? 'n/a'}`);
  console.log('Status agente: draft (embeddings ainda pending)');
  console.log('\nPróximo: npm run embed:wellhub  (ou embed:tp com WELLHUB_GROUP_ID)');
  if (errors.length) {
    console.log('Erros (até 5):');
    for (const e of errors.slice(0, 5)) console.log(`  - ${e}`);
  }
}

main().catch((err) => {
  console.error('Erro fatal na ingestão:', err);
  process.exit(1);
});
