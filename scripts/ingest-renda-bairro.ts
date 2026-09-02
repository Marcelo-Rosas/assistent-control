/**
 * Upsert renda_bairro no Supabase GymSite a partir de renda-bairro-by-ibge.json.
 *
 * Run:
 *   npx tsx scripts/ingest-renda-bairro.ts
 *   npx tsx scripts/ingest-renda-bairro.ts --ibge 3106200
 */
import fs from 'fs';
import fsPromises from 'fs/promises';
import path from 'path';
import { createClient } from '@supabase/supabase-js';
import { fold } from './lib/academia-normalize.ts';
import type { RendaByIbgeFile } from './lib/enrichBairrosCatalogRenda.ts';

const ROOT = process.cwd();
const RENDA_PATH = path.join(ROOT, 'data/processed/renda-bairro-by-ibge.json');
const IBGE_META: Record<string, { cidade: string; uf: string }> = {
  '3550308': { cidade: 'São Paulo', uf: 'SP' },
  '3304557': { cidade: 'Rio de Janeiro', uf: 'RJ' },
  '3106200': { cidade: 'Belo Horizonte', uf: 'MG' },
  '3509502': { cidade: 'Campinas', uf: 'SP' },
  '3518800': { cidade: 'Guarulhos', uf: 'SP' },
  '4314902': { cidade: 'Porto Alegre', uf: 'RS' },
};

function loadDotEnv(filePath: string): void {
  try {
    const raw = fs.readFileSync(filePath, 'utf8') as string;
    for (const line of raw.split(/\r?\n/)) {
      const t = line.trim();
      if (!t || t.startsWith('#')) continue;
      const i = t.indexOf('=');
      if (i < 1) continue;
      const key = t.slice(0, i).trim();
      const val = t.slice(i + 1).trim();
      if (!process.env[key]) process.env[key] = val;
    }
  } catch {
    /* optional */
  }
}

function parseIbgeFilter(): string[] | null {
  const eq = process.argv.find((a) => a.startsWith('--ibge='));
  if (eq) {
    return eq
      .split('=')
      .slice(1)
      .join('=')
      .split(/[,\s]+/)
      .map((s) => s.trim())
      .filter(Boolean);
  }
  const idx = process.argv.indexOf('--ibge');
  if (idx >= 0 && process.argv[idx + 1] && !process.argv[idx + 1].startsWith('--')) {
    return process.argv[idx + 1]
      .split(/[,\s]+/)
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return null;
}

async function main(): Promise<void> {
  loadDotEnv(path.join(ROOT, '.env.local'));
  const url =
    process.env.GYMSITE_SUPABASE_URL ??
    process.env.SUPABASE_URL ??
    process.env.VITE_SUPABASE_URL;
  const key =
    process.env.GYMSITE_SUPABASE_SERVICE_ROLE_KEY ??
    process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error('Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY');
    process.exit(1);
  }

  const file = JSON.parse(await fsPromises.readFile(RENDA_PATH, 'utf8')) as RendaByIbgeFile;
  const filter = parseIbgeFilter();
  const ibges = filter ?? Object.keys(file);

  const rows: Array<Record<string, unknown>> = [];
  for (const ibge of ibges) {
    const block = file[ibge];
    if (!block) {
      console.warn(`Skip ${ibge}: sem bloco em ${RENDA_PATH}`);
      continue;
    }
    const meta = IBGE_META[ibge];
    const cidade = meta?.cidade ?? null;
    const uf = meta?.uf ?? null;

    for (const [bairro, renda_pc] of Object.entries(block)) {
      rows.push({
        municipio_cod: ibge,
        cidade,
        uf,
        bairro,
        bairro_norm: fold(bairro),
        renda_pc,
        renda_mediana: renda_pc,
        ano: 2022,
        fonte: 'IBGE Censo 2022 (renda-bairro-by-ibge.json)',
        updated_at: new Date().toISOString(),
      });
    }
    console.log(`${ibge}: ${Object.keys(block).length} rows`);
  }

  if (!rows.length) {
    console.error('Nenhuma linha para ingest');
    process.exit(1);
  }

  const cli = createClient(url, key);
  const chunk = 500;
  let upserted = 0;
  for (let i = 0; i < rows.length; i += chunk) {
    const batch = rows.slice(i, i + chunk);
    const res = await cli
      .from('renda_bairro')
      .upsert(batch, { onConflict: 'municipio_cod,bairro_norm' });
    if (res.error) {
      console.error('Upsert error:', res.error.message);
      process.exit(1);
    }
    upserted += batch.length;
  }
  console.log(`Upserted ${upserted} rows into renda_bairro`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
