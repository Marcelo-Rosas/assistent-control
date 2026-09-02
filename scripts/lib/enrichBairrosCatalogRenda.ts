import { createClient } from '@supabase/supabase-js';
import { fold } from './academia-normalize.ts';
import {
  bairroSlug,
  type BairroCatalogEntry,
  type BairrosCatalog,
} from './wellhubBairrosCatalog.ts';
import { resolveCatalogDistritoSlug } from './catalogDistritoResolver.ts';
import type { GymsiteEnrichClient } from './gymsiteReceitaEnrich.ts';

export type RendaBairroRow = {
  bairro: string;
  renda_pc?: number | null;
  renda_media?: number | null;
};

export type RendaByIbgeFile = Record<string, Record<string, number>>;

export type EnrichRendaResult = {
  catalog: BairrosCatalog;
  matched: number;
  skipped_existing: number;
  unmatched_catalog: string[];
  unmatched_source: string[];
};

function numOrNull(v: unknown): number | null {
  const n = typeof v === 'number' ? v : Number(String(v ?? '').replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

function resolveCreds(): { url: string; key: string } | null {
  const url =
    process.env.GYMSITE_SUPABASE_URL ??
    process.env.SUPABASE_URL ??
    process.env.VITE_SUPABASE_URL ??
    '';
  const key =
    process.env.GYMSITE_SUPABASE_SERVICE_ROLE_KEY ??
    process.env.SUPABASE_SERVICE_ROLE_KEY ??
    '';
  if (!url.trim() || !key.trim()) return null;
  return { url, key };
}

export async function fetchRendaBairroFromSupabase(
  ibge: string,
  client?: GymsiteEnrichClient,
): Promise<RendaBairroRow[]> {
  let cli = client;
  if (!cli) {
    const creds = resolveCreds();
    if (!creds) return [];
    cli = createClient(creds.url, creds.key) as unknown as GymsiteEnrichClient;
  }

  const res = await cli
    .from('renda_bairro')
    .select('bairro,renda_pc,renda_media')
    .eq('municipio_cod', ibge)
    .limit(5000);

  if (res.error || !res.data?.length) return [];

  return (res.data as Array<Record<string, unknown>>).map((row) => ({
    bairro: String(row.bairro ?? '').trim(),
    renda_pc: numOrNull(row.renda_pc),
    renda_media: numOrNull(row.renda_media),
  }));
}

export function rowsFromLocalRendaFile(
  ibge: string,
  file: RendaByIbgeFile,
): RendaBairroRow[] {
  const block = file[ibge];
  if (!block) return [];
  return Object.entries(block).map(([bairro, renda_pc]) => ({
    bairro,
    renda_pc: numOrNull(renda_pc),
  }));
}

function indexRowsBySlug(rows: RendaBairroRow[]): Map<string, RendaBairroRow> {
  const out = new Map<string, RendaBairroRow>();
  for (const row of rows) {
    const slug = bairroSlug(row.bairro);
    if (!slug) continue;
    out.set(slug, row);
  }
  return out;
}

function findRowForEntry(
  entry: BairroCatalogEntry,
  catalog: BairrosCatalog,
  bySlug: Map<string, RendaBairroRow>,
  byFold: Map<string, RendaBairroRow>,
): RendaBairroRow | null {
  const direct = bySlug.get(entry.slug);
  if (direct) return direct;

  for (const [slug, row] of bySlug) {
    if (resolveCatalogDistritoSlug(slug, catalog) === entry.slug) return row;
  }

  const folded = fold(entry.bairro);
  const byName = byFold.get(folded);
  if (byName) return byName;

  return null;
}

export function enrichCatalogWithRenda(
  catalog: BairrosCatalog,
  rows: RendaBairroRow[],
  opts: { fonte: string; overwrite?: boolean } = { fonte: 'renda_bairro' },
): EnrichRendaResult {
  const bySlug = indexRowsBySlug(rows);
  const byFold = new Map<string, RendaBairroRow>();
  for (const row of rows) {
    byFold.set(fold(row.bairro), row);
  }

  const usedSource = new Set<string>();
  const unmatched_catalog: string[] = [];
  let matched = 0;
  let skipped_existing = 0;

  const bairros = catalog.bairros.map((entry) => {
    const row = findRowForEntry(entry, catalog, bySlug, byFold);
    if (!row) {
      unmatched_catalog.push(entry.bairro);
      return entry;
    }
    usedSource.add(fold(row.bairro));

    const hasExisting =
      entry.renda_pc != null ||
      entry.renda_media != null ||
      entry.renda_media_sm != null;
    if (hasExisting && !opts.overwrite) {
      skipped_existing += 1;
      return entry;
    }

    matched += 1;
    const next: BairroCatalogEntry = { ...entry, renda_fonte: opts.fonte };
    if (row.renda_pc != null) next.renda_pc = row.renda_pc;
    if (row.renda_media != null) next.renda_media = row.renda_media;
    return next;
  });

  const unmatched_source = rows
    .map((r) => r.bairro)
    .filter((b) => !usedSource.has(fold(b)));

  return {
    catalog: { ...catalog, bairros },
    matched,
    skipped_existing,
    unmatched_catalog,
    unmatched_source,
  };
}

export async function loadRendaRowsForIbge(
  ibge: string,
  localFile: RendaByIbgeFile | null,
): Promise<{ rows: RendaBairroRow[]; fonte: string }> {
  const local = localFile ? rowsFromLocalRendaFile(ibge, localFile) : [];
  if (local.length) {
    return { rows: local, fonte: 'data/processed/renda-bairro-by-ibge.json (IBGE Censo 2022)' };
  }

  const remote = await fetchRendaBairroFromSupabase(ibge);
  if (remote.length) {
    return { rows: remote, fonte: 'renda_bairro (GymSite / IBGE Censo 2022)' };
  }

  return { rows: [], fonte: 'none' };
}
