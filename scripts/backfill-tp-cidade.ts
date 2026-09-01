/**
 * Backfill meta.cidade no TotalPass a partir de lat/lng → município IBGE mais próximo.
 * Sem isso o share municipal explode municipios_relacionados (vizinhos).
 *
 * Run: npx tsx scripts/backfill-tp-cidade.ts
 *
 * Env:
 *   SUPABASE_URL | SUPABASE_SERVICE_ROLE_KEY | TOTALPASS_GROUP_ID
 *   MUNICIPIOS_PATH=data/municipios-brasil.json
 *   DRY_RUN=1
 *   PAGE_SIZE=200
 *   LIMIT=0
 */
import fs from 'fs';
import path from 'path';
import { createClient } from '@supabase/supabase-js';

type Mun = { nome: string; uf?: string; lat: number; lng: number };
type ChunkRow = {
  id: string;
  meta: Record<string, unknown> | null;
};

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

const MUNICIPIOS_PATH =
  process.env.MUNICIPIOS_PATH || path.join(ROOT, 'data/municipios-brasil.json');
const GROUP_ID =
  process.env.TOTALPASS_GROUP_ID?.trim() || '6ab0c39b-bf81-4840-9dcc-ed5f5cc86117';
const DRY_RUN = process.env.DRY_RUN === '1';
const PAGE_SIZE = Number(process.env.PAGE_SIZE || 200);
const LIMIT = Number(process.env.LIMIT || 0);

function haversineKm(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6371;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLng = ((bLng - aLng) * Math.PI) / 180;
  const s1 = Math.sin(dLat / 2);
  const s2 = Math.sin(dLng / 2);
  const h =
    s1 * s1 +
    Math.cos((aLat * Math.PI) / 180) * Math.cos((bLat * Math.PI) / 180) * s2 * s2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

function nearestMun(lat: number, lng: number, muns: Mun[]): Mun | null {
  let best: Mun | null = null;
  let bestD = Infinity;
  for (const m of muns) {
    const d = haversineKm(lat, lng, m.lat, m.lng);
    if (d < bestD) {
      bestD = d;
      best = m;
    }
  }
  return bestD <= 80 ? best : null;
}

function locOf(meta: Record<string, unknown> | null): { lat: number; lng: number } | null {
  const loc = meta?.location as { lat?: unknown; lng?: unknown; lon?: unknown } | undefined;
  if (!loc || typeof loc !== 'object') return null;
  const lat = Number(loc.lat);
  const lng = Number(loc.lng ?? loc.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || (lat === 0 && lng === 0)) return null;
  return { lat, lng };
}

async function main(): Promise<void> {
  const url = process.env.SUPABASE_URL?.trim() || process.env.VITE_SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key) {
    console.error('Defina SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY');
    process.exit(1);
  }

  const muns = (JSON.parse(fs.readFileSync(MUNICIPIOS_PATH, 'utf-8')) as Mun[]).filter(
    (m) =>
      typeof m.nome === 'string' &&
      Number.isFinite(m.lat) &&
      Number.isFinite(m.lng) &&
      !(m.lat === 0 && m.lng === 0),
  );
  if (!muns.length) {
    console.error(`Nenhum município com coords em ${MUNICIPIOS_PATH}`);
    process.exit(1);
  }

  const supabase = createClient(url, key);
  console.log(
    `TP cidade backfill · group=${GROUP_ID} · muns=${muns.length} · DRY_RUN=${DRY_RUN ? '1' : '0'}`,
  );

  let lastId = '';
  let scanned = 0;
  let updated = 0;
  let skipped = 0;
  let unmatched = 0;

  while (true) {
    if (LIMIT > 0 && scanned >= LIMIT) break;
    const take = LIMIT > 0 ? Math.min(PAGE_SIZE, LIMIT - scanned) : PAGE_SIZE;
    let q = supabase
      .from('eros_knowledge_chunks')
      .select('id, meta')
      .eq('group_id', GROUP_ID)
      .or('meta->>cidade.is.null,meta->>cidade.eq.')
      .order('id', { ascending: true })
      .limit(take);
    if (lastId) q = q.gt('id', lastId);
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    const rows = (data || []) as ChunkRow[];
    if (!rows.length) break;

    for (const row of rows) {
      scanned += 1;
      const meta = row.meta && typeof row.meta === 'object' ? { ...row.meta } : {};
      const current = String(meta.cidade || '').trim();
      const loc = locOf(meta);
      if (!loc) {
        skipped += 1;
        continue;
      }
      const hit = nearestMun(loc.lat, loc.lng, muns);
      if (!hit) {
        unmatched += 1;
        continue;
      }
      if (current === hit.nome) {
        skipped += 1;
        continue;
      }
      meta.cidade = hit.nome;
      if (hit.uf) meta.uf = hit.uf;
      if (!DRY_RUN) {
        const { error: upErr } = await supabase
          .from('eros_knowledge_chunks')
          .update({ meta })
          .eq('id', row.id);
        if (upErr) throw new Error(upErr.message);
      }
      updated += 1;
    }

    lastId = rows[rows.length - 1]?.id || lastId;
    console.log(
      `  lastId=${lastId.slice(0, 8)}… scanned=${scanned} updated=${updated} skip=${skipped} unmatched=${unmatched}`,
    );
    if (rows.length < take) break;
  }

  console.log(
    `\nDone. scanned=${scanned} updated=${updated} skip=${skipped} unmatched=${unmatched}${DRY_RUN ? ' (dry-run)' : ''}`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
