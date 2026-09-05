/**
 * Remove entradas envenenadas do cache F2.2:
 * - ok:true com CEP ainda genérico (-000)
 * Run: npx tsx scripts/purge-tp-cep-logradouro-poison.ts
 */
import fs from 'fs/promises';
import path from 'path';
import { isCepGenerico, normalizeCep, type RefineCepResult } from './lib/tpCepResolver.ts';

const CACHE_PATH = path.join(process.cwd(), 'data/processed/tp-cep-logradouro-cache.json');

async function main() {
  const raw = JSON.parse(await fs.readFile(CACHE_PATH, 'utf8')) as Record<string, RefineCepResult>;
  let removed = 0;
  for (const [k, v] of Object.entries(raw)) {
    if (v && v.ok === true && isCepGenerico(normalizeCep(v.cep) ?? '')) {
      delete raw[k];
      removed += 1;
      console.log(`purge ${k} cep=${v.cep}`);
    }
  }
  const tmp = `${CACHE_PATH}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(raw, null, 2), 'utf8');
  await fs.rename(tmp, CACHE_PATH);
  console.log(`removed=${removed} remaining=${Object.keys(raw).length}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
