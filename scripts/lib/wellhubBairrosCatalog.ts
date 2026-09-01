/**
 * Catálogo oficial de bairros para tiling exaustivo Wellhub.
 * Arquivo: data/geo/bairros/{municipio-slug}-{uf}.json
 */
import fs from 'fs/promises';
import path from 'path';

export type BairroCatalogEntry = {
  slug: string;
  bairro: string;
  /** Slug alternativo se Wellhub não aceitar o slug derivado do nome oficial */
  wellhub_slug?: string;
  /** Sub-bairros Receita/geocode que mapeiam para este distrito oficial */
  match_slugs?: string[];
  /** Preflight/recover confirmou tile WH sem academias neste município */
  wellhub_absent?: boolean;
  area_ha?: number;
  populacao_2022?: number;
  densidade_hab_ha?: number;
  renda_media_sm?: number;
};

export type BairrosCatalog = {
  cidade: string;
  uf: string;
  ibge?: string;
  fonte?: string;
  bairros: BairroCatalogEntry[];
};

const ROOT = process.cwd();
const DEFAULT_BAIRROS_DIR =
  process.env.BAIRROS_DIR || path.join(ROOT, 'data/geo/bairros');

/** Campinas → campinas | São Paulo → sao-paulo */
export function bairroSlug(nome: string): string {
  return String(nome || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function catalogFileName(cidade: string, uf: string): string {
  return `${bairroSlug(cidade)}-${uf.trim().toLowerCase()}.json`;
}

export function resolveSearchSlug(entry: BairroCatalogEntry): string {
  return entry.wellhub_slug?.trim() || entry.slug;
}

export function buildSearchUrlForSlug(uf: string, slug: string): string {
  return `https://wellhub.com/pt-br/search/${uf.trim().toLowerCase()}/${slug}/?map=1`;
}

export async function loadBairrosCatalog(
  cidade: string,
  uf: string,
  bairrosDir = DEFAULT_BAIRROS_DIR,
): Promise<BairrosCatalog | null> {
  const filePath = path.join(bairrosDir, catalogFileName(cidade, uf));
  try {
    const raw = await fs.readFile(filePath, 'utf-8');
    const parsed = JSON.parse(raw) as BairrosCatalog;
    if (!parsed?.bairros?.length) return null;
    return parsed;
  } catch {
    return null;
  }
}

/** Parse "376 ha" → 376, "9 854" → 9854, "26,2 hab/ha" → 26.2, "2,95 SM/mês" → 2.95 */
export function parseAreaHa(raw: string): number | undefined {
  const m = String(raw || '').match(/([\d\s]+)\s*ha/i);
  if (!m) return undefined;
  return Number(m[1].replace(/\s/g, '')) || undefined;
}

export function parsePopulacao(raw: string): number | undefined {
  const n = String(raw || '').replace(/\s/g, '');
  const v = Number(n);
  return Number.isFinite(v) ? v : undefined;
}

export function parseDensidade(raw: string): number | undefined {
  const m = String(raw || '').match(/([\d,]+)/);
  if (!m) return undefined;
  return Number(m[1].replace(',', '.')) || undefined;
}

export function parseRendaSm(raw: string): number | undefined {
  const m = String(raw || '').match(/([\d,]+)/);
  if (!m) return undefined;
  return Number(m[1].replace(',', '.')) || undefined;
}

export function normalizePrefeituraRow(row: Record<string, string>): BairroCatalogEntry | null {
  const bairro = (row.Bairro || row.bairro || '').trim();
  if (!bairro || bairro.toUpperCase() === 'TOTAL') return null;
  return {
    slug: bairroSlug(bairro),
    bairro,
    area_ha: parseAreaHa(row['Área'] || row.area || ''),
    populacao_2022: parsePopulacao(row['População\n(2022)'] || row.populacao_2022 || ''),
    densidade_hab_ha: parseDensidade(row.Densidade || row.densidade || ''),
    renda_media_sm: parseRendaSm(
      row['Renda média por\ndomicílio'] || row.renda_media_sm || '',
    ),
  };
}
