/**
 * Normaliza Wellhub bruto → AcademiaNormalizada (schema do ingest-wellhub).
 *
 * Run: npm run normalize:wellhub
 */
import fs from 'fs/promises';
import path from 'path';
import {
  normalizeWellhubGym,
  type AcademiaNormalizada,
  type WellhubGym,
} from './lib/academia-normalize.ts';

const ROOT = process.cwd();
const DEFAULT_BR = path.join(ROOT, 'data/raw/wellhub-brasil-all.json');
const DEFAULT_LEGACY = path.join(ROOT, 'data/raw/wellhub-raw.json');
const OUTPUT_PATH =
  process.env.OUTPUT_PATH || path.join(ROOT, 'data/processed/wellhub-normalized.json');
const LIMIT = Number(process.env.LIMIT || 0);

export type { AcademiaNormalizada, WellhubGym };

async function resolveInputPath(): Promise<string> {
  if (process.env.INPUT_PATH) return process.env.INPUT_PATH;
  try {
    await fs.access(DEFAULT_BR);
    return DEFAULT_BR;
  } catch {
    return DEFAULT_LEGACY;
  }
}

function loadGyms(parsed: unknown): WellhubGym[] {
  if (Array.isArray(parsed)) return parsed as WellhubGym[];
  if (parsed && typeof parsed === 'object' && Array.isArray((parsed as { data?: unknown }).data)) {
    return (parsed as { data: WellhubGym[] }).data;
  }
  throw new Error('JSON inválido: esperado array ou { data: Gym[] }');
}

async function main(): Promise<void> {
  console.log('Normalizando Wellhub…\n');

  const inputPath = await resolveInputPath();
  console.log(`Input: ${inputPath}`);

  let rawText: string;
  try {
    rawText = await fs.readFile(inputPath, 'utf-8');
  } catch {
    console.error(`Arquivo ausente: ${inputPath}`);
    console.error('Rode: npm run scrape:wellhub-br');
    process.exit(1);
  }

  let gyms: WellhubGym[];
  try {
    gyms = loadGyms(JSON.parse(rawText));
  } catch (err) {
    console.error('Parse falhou:', err instanceof Error ? err.message : err);
    process.exit(1);
  }

  if (LIMIT > 0) {
    gyms = gyms.slice(0, LIMIT);
    console.log(`LIMIT=${LIMIT}`);
  }

  console.log(`Brutos: ${gyms.length}`);

  const normalized: AcademiaNormalizada[] = [];
  let skipped = 0;
  for (const g of gyms) {
    const row = normalizeWellhubGym(g);
    if (!row) {
      skipped += 1;
      continue;
    }
    normalized.push(row);
  }

  await fs.mkdir(path.dirname(OUTPUT_PATH), { recursive: true });
  await fs.writeFile(OUTPUT_PATH, JSON.stringify(normalized, null, 2), 'utf-8');

  const byUf = new Map<string, number>();
  for (const n of normalized) {
    const k = n.uf || '?';
    byUf.set(k, (byUf.get(k) || 0) + 1);
  }
  const ufTop = [...byUf.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);

  console.log(`Normalizados: ${normalized.length} (skipped=${skipped})`);
  console.log(`Output: ${OUTPUT_PATH}`);
  console.log(`UF top: ${ufTop.map(([u, c]) => `${u}=${c}`).join(', ')}`);
  console.log('\nPróximo: npm run ingest:wellhub');
}

main().catch((err) => {
  console.error('Erro fatal:', err);
  process.exit(1);
});
