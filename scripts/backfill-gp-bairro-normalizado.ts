/**
 * Backfill meta.bairro_normalizado (+ cidade label) on GuruPass chunks.
 * Root cause: ingest-gurupass wrote meta.bairro but never bairro_normalizado,
 * so jarvis_rag contar_penetracao (filter meta->>bairro_normalizado) always got GP=0.
 *
 * Default = DRY-RUN. Use --apply to write via service role.
 *
 *   npx tsx scripts/backfill-gp-bairro-normalizado.ts
 *   npx tsx scripts/backfill-gp-bairro-normalizado.ts --apply
 *   LIMIT=200 npx tsx scripts/backfill-gp-bairro-normalizado.ts --apply
 *
 * Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, GURUPASS_GROUP_ID
 *      PAGE_SIZE=200  LIMIT=0 (0 = all)
 */
import fs from 'node:fs';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { patchGpBairroMeta } from './lib/gpBairroMeta.ts';

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

const GROUP_ID = process.env.GURUPASS_GROUP_ID?.trim() || '';
const APPLY = process.argv.includes('--apply');
const PAGE_SIZE = Number(process.env.PAGE_SIZE || 200);
const LIMIT = Number(process.env.LIMIT || 0);

async function main(): Promise<void> {
  if (!GROUP_ID) {
    console.error('GURUPASS_GROUP_ID ausente');
    process.exit(1);
  }
  const url = process.env.SUPABASE_URL?.trim() || process.env.VITE_SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key) {
    console.error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY ausentes');
    process.exit(1);
  }

  const supabase = createClient(url, key);
  console.log(
    `GP bairro_normalizado backfill · group=${GROUP_ID} · ${APPLY ? 'APPLY' : 'DRY-RUN'} · page=${PAGE_SIZE}`,
  );

  let lastId = '';
  let scanned = 0;
  let wouldUpdate = 0;
  let updated = 0;
  let skipped = 0;

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

    for (const row of rows) {
      scanned += 1;
      const patched = patchGpBairroMeta(row.meta);
      if (!patched) {
        skipped += 1;
        continue;
      }
      wouldUpdate += 1;
      if (APPLY) {
        const { error: upErr } = await supabase
          .from('eros_knowledge_chunks')
          .update({ meta: patched })
          .eq('id', row.id);
        if (upErr) throw new Error(upErr.message);
        updated += 1;
      }
    }

    lastId = rows[rows.length - 1]?.id || lastId;
    console.log(
      `  scanned=${scanned} need_patch=${wouldUpdate} updated=${updated} skip=${skipped}`,
    );
    if (rows.length < take) break;
  }

  console.log(
    `\nDone. scanned=${scanned} need_patch=${wouldUpdate} updated=${updated} skip=${skipped}` +
      (APPLY ? '' : ' (dry-run — re-run with --apply)'),
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
