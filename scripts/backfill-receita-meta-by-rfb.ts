/**
 * Backfill meta.bairro / bairro_normalizado (UPPER) + cidade canônica on Receita chunks
 * via join CNPJ → RFB JSON local.
 *
 * Root cause: ingest gravou muitos chunks SP com bairro_normalizado=null (bairro RFB
 * existia no parque local). jarvis_rag.contar_penetracao filtra meta->>bairro_normalizado
 * → Receita << agregadores no mesmo geo.
 *
 * Default = DRY-RUN. Use --apply to write via service role.
 *
 *   npx tsx scripts/backfill-receita-meta-by-rfb.ts
 *   npx tsx scripts/backfill-receita-meta-by-rfb.ts --apply
 *   LIMIT=500 npx tsx scripts/backfill-receita-meta-by-rfb.ts --apply
 *
 * Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, RECEITA_GROUP_ID
 *      RFB_JSON (default data/processed/receita-cnae-9313100-principal-ativo-baixada.json)
 *      PAGE_SIZE=200  LIMIT=0 (0 = all)  ONLY_NULL_BAIRRO=1
 */
import fs from 'node:fs';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';
import {
  digitsCnpj,
  patchReceitaMetaFromRfb,
  type RfbEstabelecimento,
} from './lib/receitaMetaByRfb.ts';

type ChunkRow = { id: string; meta: Record<string, unknown> | null };

const ROOT = process.cwd();

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

const GROUP_ID = process.env.RECEITA_GROUP_ID?.trim() || '';
const APPLY = process.argv.includes('--apply');
const PAGE_SIZE = Number(process.env.PAGE_SIZE || 200);
const LIMIT = Number(process.env.LIMIT || 0);
const ONLY_NULL = (process.env.ONLY_NULL_BAIRRO || '1') !== '0';
const RFB_JSON =
  process.env.RFB_JSON?.trim() ||
  path.join(ROOT, 'data/processed/receita-cnae-9313100-principal-ativo-baixada.json');

function loadRfbIndex(filePath: string): Map<string, RfbEstabelecimento> {
  const raw = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as RfbEstabelecimento[];
  if (!Array.isArray(raw)) throw new Error(`RFB JSON não é array: ${filePath}`);
  const map = new Map<string, RfbEstabelecimento>();
  for (const row of raw) {
    const c = digitsCnpj(row.cnpj);
    if (c) map.set(c, row);
  }
  return map;
}

const CONCURRENCY = Number(process.env.CONCURRENCY || 20);

async function mapPool<T>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<void>,
): Promise<void> {
  let i = 0;
  async function worker(): Promise<void> {
    while (i < items.length) {
      const idx = i++;
      await fn(items[idx]!);
    }
  }
  const n = Math.min(concurrency, Math.max(1, items.length));
  await Promise.all(Array.from({ length: n }, () => worker()));
}

async function main(): Promise<void> {
  if (!GROUP_ID) {
    console.error('RECEITA_GROUP_ID ausente');
    process.exit(1);
  }
  const url = process.env.SUPABASE_URL?.trim() || process.env.VITE_SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key) {
    console.error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY ausentes');
    process.exit(1);
  }
  if (!fs.existsSync(RFB_JSON)) {
    console.error(`RFB JSON ausente: ${RFB_JSON}`);
    process.exit(1);
  }

  console.log(`Loading RFB index: ${RFB_JSON}`);
  const rfb = loadRfbIndex(RFB_JSON);
  console.log(`RFB CNPJs: ${rfb.size}`);

  const supabase = createClient(url, key);
  console.log(
    `Receita meta backfill · group=${GROUP_ID} · ${APPLY ? 'APPLY' : 'DRY-RUN'} · page=${PAGE_SIZE}` +
      ` · only_null_bairro=${ONLY_NULL ? '1' : '0'} · concurrency=${CONCURRENCY}`,
  );

  let lastId = '';
  let scanned = 0;
  let wouldUpdate = 0;
  let updated = 0;
  let skipped = 0;
  let noCnpj = 0;
  let notInRfb = 0;

  while (true) {
    if (LIMIT > 0 && scanned >= LIMIT) break;
    const take = LIMIT > 0 ? Math.min(PAGE_SIZE, LIMIT - scanned) : PAGE_SIZE;
    let q = supabase
      .from('eros_knowledge_chunks')
      .select('id, meta')
      .eq('group_id', GROUP_ID)
      .order('id', { ascending: true })
      .limit(take);
    if (lastId) q = q.gt('id', lastId);
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    const rows = (data || []) as ChunkRow[];
    if (!rows.length) break;

    type Pending = { id: string; meta: Record<string, unknown> };
    const pending: Pending[] = [];

    for (const row of rows) {
      scanned += 1;
      const meta = row.meta;
      if (ONLY_NULL && String(meta?.bairro_normalizado || '').trim()) {
        skipped += 1;
        continue;
      }
      const cnpj = digitsCnpj(meta?.cnpj);
      if (!cnpj) {
        noCnpj += 1;
        skipped += 1;
        continue;
      }
      const hit = rfb.get(cnpj);
      if (!hit) {
        notInRfb += 1;
        skipped += 1;
        continue;
      }
      const patched = patchReceitaMetaFromRfb(meta, hit);
      if (!patched) {
        skipped += 1;
        continue;
      }
      wouldUpdate += 1;
      pending.push({ id: row.id, meta: patched });
    }

    if (APPLY && pending.length) {
      await mapPool(pending, CONCURRENCY, async (item) => {
        const { error: upErr } = await supabase
          .from('eros_knowledge_chunks')
          .update({ meta: item.meta })
          .eq('id', item.id);
        if (upErr) throw new Error(upErr.message);
      });
      updated += pending.length;
    }

    lastId = rows[rows.length - 1]?.id || lastId;
    console.log(
      `  scanned=${scanned} need_patch=${wouldUpdate} updated=${updated} skip=${skipped} no_cnpj=${noCnpj} not_in_rfb=${notInRfb}`,
    );
    if (rows.length < take) break;
  }

  console.log(
    `\nDone. scanned=${scanned} need_patch=${wouldUpdate} updated=${updated} skip=${skipped}` +
      ` no_cnpj=${noCnpj} not_in_rfb=${notInRfb}` +
      (APPLY ? '' : ' (dry-run — re-run with --apply)'),
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
