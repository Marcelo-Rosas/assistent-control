/**
 * Backfill meta.bairro / bairro_normalizado (slug kebab) on TotalPass chunks
 * from data/processed/tp-bairro-index.json (gym_id).
 *
 * Root cause: ingest-totalpass-sp never wrote bairro_* — Pinheiros SP TP=0
 * despite index having ~55 pinheiros gym_ids already in RAG.
 *
 * Default = DRY-RUN. Use --apply to write.
 *
 *   npx tsx scripts/backfill-tp-bairro-normalizado.ts
 *   npx tsx scripts/backfill-tp-bairro-normalizado.ts --apply
 *
 * Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, TOTALPASS_GROUP_ID
 *      TP_BAIRRO_INDEX, PAGE_SIZE=200, LIMIT=0, ONLY_NULL_BAIRRO=1, CONCURRENCY=20
 */
import fs from 'node:fs';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';
import {
  patchTpBairroFromIndex,
  resolveGymIdFromMeta,
  type TpBairroIndexEntry,
} from './lib/tpBairroMeta.ts';

type ChunkRow = { id: string; meta: Record<string, unknown> | null; source_ref?: string | null };

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

const GROUP_ID = process.env.TOTALPASS_GROUP_ID?.trim() || '';
const APPLY = process.argv.includes('--apply');
const PAGE_SIZE = Number(process.env.PAGE_SIZE || 200);
const LIMIT = Number(process.env.LIMIT || 0);
const ONLY_NULL = (process.env.ONLY_NULL_BAIRRO || '1') !== '0';
const CONCURRENCY = Number(process.env.CONCURRENCY || 20);
const INDEX_PATH =
  process.env.TP_BAIRRO_INDEX?.trim() ||
  path.join(ROOT, 'data/processed/tp-bairro-index.json');

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

function loadIndex(filePath: string): Map<string, TpBairroIndexEntry> {
  const raw = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as {
    by_gym_id?: Record<string, TpBairroIndexEntry>;
  };
  const map = new Map<string, TpBairroIndexEntry>();
  for (const [id, entry] of Object.entries(raw.by_gym_id || {})) {
    if (entry?.bairro || entry?.bairro_slug) map.set(id, entry);
  }
  return map;
}

async function main(): Promise<void> {
  if (!GROUP_ID) {
    console.error('TOTALPASS_GROUP_ID ausente');
    process.exit(1);
  }
  const url = process.env.SUPABASE_URL?.trim() || process.env.VITE_SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key) {
    console.error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY ausentes');
    process.exit(1);
  }
  if (!fs.existsSync(INDEX_PATH)) {
    console.error(`tp-bairro-index ausente: ${INDEX_PATH}`);
    process.exit(1);
  }

  const index = loadIndex(INDEX_PATH);
  console.log(`TP bairro index entries: ${index.size}`);

  const supabase = createClient(url, key);
  console.log(
    `TP bairro_normalizado backfill · group=${GROUP_ID} · ${APPLY ? 'APPLY' : 'DRY-RUN'}` +
      ` · page=${PAGE_SIZE} · only_null=${ONLY_NULL ? '1' : '0'} · concurrency=${CONCURRENCY}`,
  );

  let lastId = '';
  let scanned = 0;
  let wouldUpdate = 0;
  let updated = 0;
  let skipped = 0;
  let noGym = 0;
  let notInIndex = 0;

  while (true) {
    if (LIMIT > 0 && scanned >= LIMIT) break;
    const take = LIMIT > 0 ? Math.min(PAGE_SIZE, LIMIT - scanned) : PAGE_SIZE;
    let q = supabase
      .from('eros_knowledge_chunks')
      .select('id, meta, source_ref')
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
      const gymId = resolveGymIdFromMeta(meta, row.source_ref);
      if (!gymId) {
        noGym += 1;
        skipped += 1;
        continue;
      }
      const entry = index.get(gymId);
      if (!entry) {
        notInIndex += 1;
        skipped += 1;
        continue;
      }
      const patched = patchTpBairroFromIndex(meta, entry);
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
      `  scanned=${scanned} need_patch=${wouldUpdate} updated=${updated} skip=${skipped}` +
        ` no_gym=${noGym} not_in_index=${notInIndex}`,
    );
    if (rows.length < take) break;
  }

  console.log(
    `\nDone. scanned=${scanned} need_patch=${wouldUpdate} updated=${updated} skip=${skipped}` +
      ` no_gym=${noGym} not_in_index=${notInIndex}` +
      (APPLY ? '' : ' (dry-run — re-run with --apply)'),
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
