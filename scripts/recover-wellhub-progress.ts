/**
 * Rebuild wellhub-progress.json from wellhub-brasil-all.json + corrupted checkpoint header.
 * Usage: npx tsx scripts/recover-wellhub-progress.ts
 */
import fs from 'fs/promises';
import path from 'path';

const ROOT = process.cwd();
const ALL_PATH = path.join(ROOT, 'data/raw/wellhub-brasil-all.json');
const CORRUPT_PATH = path.join(ROOT, 'data/processed/wellhub-progress.json');
const OUT_PATH = CORRUPT_PATH;
const BACKUP_PATH = path.join(ROOT, 'data/processed/wellhub-progress.corrupt.bak');

function parseJsonArray(raw: string, key: string): unknown[] {
  const needle = `"${key}"`;
  const start = raw.indexOf(needle);
  if (start < 0) throw new Error(`key not found: ${key}`);
  const open = raw.indexOf('[', start);
  let depth = 0;
  for (let i = open; i < raw.length; i++) {
    if (raw[i] === '[') depth++;
    else if (raw[i] === ']') {
      depth--;
      if (depth === 0) return JSON.parse(raw.slice(open, i + 1)) as unknown[];
    }
  }
  throw new Error(`unclosed array for ${key}`);
}

async function main(): Promise<void> {
  const corrupt = await fs.readFile(CORRUPT_PATH, 'utf-8');
  const all = JSON.parse(await fs.readFile(ALL_PATH, 'utf-8')) as {
    data: Array<{ id: string; [k: string]: unknown }>;
    metadata: { totalGyms: number; timestamp: string };
  };

  const completed = parseJsonArray(corrupt, 'completed') as string[];
  const failed = parseJsonArray(corrupt, 'failed') as Array<{ nome: string; key: string; error: string }>;

  const gymById: Record<string, (typeof all.data)[0]> = {};
  for (const g of all.data) gymById[g.id] = g;

  const completedSet = new Set(completed);
  const extraFromLog = [
    'Formigueiro-RS',
    'Goioxim-PR',
    'Guarantã-SP',
    'Canitar-SP',
    'Acauã-PI',
    'São Vicente-RN',
    'Divisa Alegre-MG',
    'Itagimirim-BA',
    'Cambará do Sul-RS',
    'Restinga-SP',
  ];
  for (const k of extraFromLog) completedSet.add(k);

  const state = {
    completed: Array.from(completedSet),
    failed,
    gymById,
    lastUpdate: new Date().toISOString(),
  };

  await fs.copyFile(CORRUPT_PATH, BACKUP_PATH);
  await fs.writeFile(OUT_PATH, JSON.stringify(state), 'utf-8');

  const stat = await fs.stat(OUT_PATH);
  console.log('Recovered checkpoint:');
  console.log(`  completed=${state.completed.length}`);
  console.log(`  failed=${state.failed.length}`);
  console.log(`  gyms=${Object.keys(gymById).length}`);
  console.log(`  sizeMB=${(stat.size / 1024 / 1024).toFixed(1)}`);
  console.log(`  backup=${BACKUP_PATH}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
