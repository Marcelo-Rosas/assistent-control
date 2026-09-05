/**
 * Ingestão Receita CNAE (RFB local) → eros_knowledge_chunks (RECEITA_GROUP_ID).
 *
 * Fonte default: data/processed/receita-cnae-9313100-principal-ativo-baixada.json
 * DEFAULT = DRY-RUN. Use --apply para gravar. MISSING_ONLY=1 (default) só CNPJs
 * ausentes do grupo. Filtros: UF / MUNICIPIO / BAIRRO.
 *
 *   npx tsx scripts/ingest-receita-cnae.ts
 *   UF=SP MUNICIPIO=7107 BAIRRO="Bela Vista" npx tsx scripts/ingest-receita-cnae.ts --apply
 *   CLEAR_PROGRESS=1 npx tsx scripts/ingest-receita-cnae.ts --apply
 *
 * Depois: npm run embed:receita   (ou LIMIT=100 npm run embed:receita)
 *
 * Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, RECEITA_GROUP_ID
 *      RFB_JSON  BATCH_SIZE=50  MISSING_ONLY=1  UF  MUNICIPIO  BAIRRO  LIMIT=0
 */
import fs from 'node:fs';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';
import {
  buildReceitaChunk,
  rowMatchesFilters,
  type RfbEstabelecimentoFull,
} from './lib/receitaCnaeIngest.ts';
import { digitsCnpj } from './lib/receitaMetaByRfb.ts';

const ROOT = process.cwd();
const APPLY = process.argv.includes('--apply');
const BATCH = Number(process.env.BATCH_SIZE || 50);
const LIMIT = Number(process.env.LIMIT || 0);
const MISSING_ONLY = (process.env.MISSING_ONLY || '1') !== '0';
const CLEAR_PROGRESS = (process.env.CLEAR_PROGRESS || '0') === '1';
const UF = process.env.UF?.trim() || '';
const MUNICIPIO = process.env.MUNICIPIO?.trim() || '';
const BAIRRO = process.env.BAIRRO?.trim() || '';
const RFB_JSON =
  process.env.RFB_JSON?.trim() ||
  path.join(ROOT, 'data/processed/receita-cnae-9313100-principal-ativo-baixada.json');
const PROGRESS_PATH =
  process.env.PROGRESS_PATH?.trim() ||
  path.join(ROOT, 'data/processed/ingest-receita-progress.json');

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

loadDotEnv(path.join(ROOT, '.env'));
loadDotEnv(path.join(ROOT, '.env.local'));

type Progress = {
  done_cnpjs: string[];
  updated_at?: string;
};

function loadProgress(): Set<string> {
  if (CLEAR_PROGRESS && fs.existsSync(PROGRESS_PATH)) {
    fs.unlinkSync(PROGRESS_PATH);
    console.log(`Progress cleared: ${PROGRESS_PATH}`);
  }
  if (!fs.existsSync(PROGRESS_PATH)) return new Set();
  try {
    const raw = JSON.parse(fs.readFileSync(PROGRESS_PATH, 'utf-8')) as Progress;
    return new Set((raw.done_cnpjs || []).map(digitsCnpj).filter(Boolean));
  } catch {
    return new Set();
  }
}

function saveProgress(done: Set<string>): void {
  const payload: Progress = {
    done_cnpjs: [...done],
    updated_at: new Date().toISOString(),
  };
  fs.mkdirSync(path.dirname(PROGRESS_PATH), { recursive: true });
  fs.writeFileSync(PROGRESS_PATH, JSON.stringify(payload), 'utf-8');
}

async function fetchExistingCnpjs(
  supabase: ReturnType<typeof createClient>,
  groupId: string,
  candidates: string[],
): Promise<Set<string>> {
  const found = new Set<string>();
  const PAGE = 40;
  for (let i = 0; i < candidates.length; i += PAGE) {
    const batch = candidates.slice(i, i + PAGE);
    const { data, error } = await supabase
      .from('eros_knowledge_chunks')
      .select('meta')
      .eq('group_id', groupId)
      .in('meta->>cnpj', batch)
      .limit(500);
    if (error) throw new Error(error.message);
    for (const row of data || []) {
      const c = digitsCnpj((row as { meta?: { cnpj?: string } }).meta?.cnpj);
      if (c) found.add(c);
    }
  }
  return found;
}

async function main(): Promise<void> {
  const groupId = process.env.RECEITA_GROUP_ID?.trim() || '';
  if (!groupId) {
    console.error('RECEITA_GROUP_ID ausente');
    process.exit(1);
  }
  if (!fs.existsSync(RFB_JSON)) {
    console.error(`RFB JSON ausente: ${RFB_JSON}`);
    process.exit(1);
  }

  console.log(
    `Receita ingest · ${APPLY ? 'APPLY' : 'DRY-RUN'} · missing_only=${MISSING_ONLY ? '1' : '0'}` +
      ` · uf=${UF || '*'} municipio=${MUNICIPIO || '*'} bairro=${BAIRRO || '*'}`,
  );
  console.log(`Fonte: ${RFB_JSON}`);

  const raw = JSON.parse(fs.readFileSync(RFB_JSON, 'utf-8')) as RfbEstabelecimentoFull[];
  if (!Array.isArray(raw)) {
    console.error('RFB JSON não é array');
    process.exit(1);
  }

  const filters = {
    uf: UF || undefined,
    municipio: MUNICIPIO || undefined,
    bairro: BAIRRO || undefined,
  };
  let rows = raw.filter((r) => rowMatchesFilters(r, filters));
  console.log(`RFB total=${raw.length} após filtros=${rows.length}`);

  const progress = loadProgress();
  if (progress.size) {
    const before = rows.length;
    rows = rows.filter((r) => !progress.has(digitsCnpj(r.cnpj)));
    console.log(`Progress skip=${before - rows.length} remaining=${rows.length}`);
  }

  if (LIMIT > 0) {
    rows = rows.slice(0, LIMIT);
    console.log(`LIMIT=${LIMIT}`);
  }

  const url = process.env.SUPABASE_URL?.trim() || process.env.VITE_SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key) {
    console.error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY ausentes');
    process.exit(1);
  }
  const supabase = createClient(url, key);

  let existing = new Set<string>();
  if (MISSING_ONLY) {
    const cands = rows.map((r) => digitsCnpj(r.cnpj)).filter((c) => c.length === 14);
    console.log(`Checando CNPJs já no grupo (${cands.length})…`);
    existing = await fetchExistingCnpjs(supabase, groupId, cands);
    console.log(`Já no RAG: ${existing.size}`);
  }

  const drafts = [];
  let skippedExisting = 0;
  let skippedInvalid = 0;
  for (const row of rows) {
    const c = digitsCnpj(row.cnpj);
    if (MISSING_ONLY && existing.has(c)) {
      skippedExisting += 1;
      continue;
    }
    const chunk = buildReceitaChunk(groupId, row);
    if (!chunk) {
      skippedInvalid += 1;
      continue;
    }
    drafts.push(chunk);
  }

  console.log(
    `Drafts=${drafts.length} skip_existing=${skippedExisting} skip_invalid=${skippedInvalid}`,
  );
  if (drafts[0]) {
    console.log('\nExemplo chunk:');
    console.log(JSON.stringify(drafts[0], null, 2).slice(0, 1200));
  }

  if (!APPLY) {
    console.log('\nDRY-RUN: nada gravado. Rode com --apply.');
    return;
  }

  let ok = 0;
  let fail = 0;
  const done = new Set(progress);
  for (let i = 0; i < drafts.length; i += BATCH) {
    const batch = drafts.slice(i, i + BATCH);
    const { error } = await supabase.from('eros_knowledge_chunks').upsert(batch, {
      onConflict: 'group_id,content_hash',
    });
    if (error) {
      fail += batch.length;
      console.error(`\nUpsert fail: ${error.message}`);
    } else {
      ok += batch.length;
      for (const d of batch) done.add(digitsCnpj(d.meta.cnpj));
      saveProgress(done);
    }
    process.stdout.write(`\rupsert ${ok}/${drafts.length} fail=${fail}`);
  }

  const { count } = await supabase
    .from('eros_knowledge_chunks')
    .select('id', { count: 'exact', head: true })
    .eq('group_id', groupId);

  await supabase.from('eros_knowledge_agents').upsert(
    {
      group_id: groupId,
      chunk_count: count ?? null,
      status: 'draft',
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'group_id' },
  );

  console.log(`\n✅ upsert ok=${ok} fail=${fail} group_count=${count ?? 'n/a'}`);
  console.log('Próximo: npm run embed:receita  (LIMIT=N para smoke)');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
