/**
 * Resolve sub-bairro slugs (geocode / endereço) → distrito oficial do catálogo.
 */
import {
  bairroSlug,
  type BairroCatalogEntry,
  type BairrosCatalog,
} from './wellhubBairrosCatalog.ts';

/** Sub-bairro (ex. vila-carrao) → distrito catálogo (carrao). */
export function matchesDistritoSlug(gymSlug: string, catalogSlug: string): boolean {
  if (!gymSlug || !catalogSlug) return false;
  if (gymSlug === catalogSlug) return true;
  return (
    gymSlug.endsWith(`-${catalogSlug}`) ||
    gymSlug.startsWith(`${catalogSlug}-`) ||
    gymSlug.includes(`-${catalogSlug}-`)
  );
}

export function resolveCatalogDistritoSlug(
  gymSlug: string,
  catalog: BairrosCatalog,
): string | null {
  const norm = bairroSlug(gymSlug);
  if (!norm) return null;

  for (const entry of catalog.bairros) {
    if (matchesDistritoSlug(norm, entry.slug)) return entry.slug;
    for (const alias of entry.match_slugs ?? []) {
      if (matchesDistritoSlug(norm, bairroSlug(alias))) return entry.slug;
    }
  }
  return null;
}

export function buildReceitaToCatalogAliasMap(
  catalog: BairrosCatalog,
  receitaSlugs: Set<string> | undefined,
): Map<string, string> {
  const out = new Map<string, string>();
  if (!receitaSlugs?.size) return out;

  for (const receitaSlug of receitaSlugs) {
    const distrito = resolveCatalogDistritoSlug(receitaSlug, catalog);
    if (distrito) out.set(receitaSlug, distrito);
  }
  return out;
}

export function enrichCatalogMatchSlugsFromReceita(
  catalog: BairrosCatalog,
  receitaSlugs: Set<string>,
): BairrosCatalog {
  const bySlug = new Map(catalog.bairros.map((b) => [b.slug, { ...b, match_slugs: [...(b.match_slugs ?? [])] }]));

  for (const receitaSlug of receitaSlugs) {
    const distrito = resolveCatalogDistritoSlug(receitaSlug, catalog);
    if (!distrito || distrito === receitaSlug) continue;
    const entry = bySlug.get(distrito);
    if (!entry) continue;
    if (!entry.match_slugs!.includes(receitaSlug)) entry.match_slugs!.push(receitaSlug);
  }

  return {
    ...catalog,
    bairros: catalog.bairros.map((b) => bySlug.get(b.slug) ?? b),
  };
}

type BairroMap = Map<string, { bairroNorm: string; bairroLabel: string }>;

export function registerAggregatorBairro(
  map: BairroMap,
  label: string,
  catalog: BairrosCatalog | null,
  receitaAlias?: Map<string, string>,
): void {
  const norm = bairroSlug(label);
  if (!norm) return;

  map.set(norm, { bairroNorm: norm, bairroLabel: label.trim() });

  if (!catalog) return;

  const distrito =
    resolveCatalogDistritoSlug(norm, catalog) ?? receitaAlias?.get(norm) ?? null;
  if (!distrito || distrito === norm) return;

  const entry = catalog.bairros.find((b) => b.slug === distrito);
  if (entry) {
    map.set(distrito, { bairroNorm: distrito, bairroLabel: entry.bairro });
  }
}

export function catalogEntryMatchSlugs(entry: BairroCatalogEntry): string[] {
  const slugs = new Set<string>([entry.slug]);
  for (const alias of entry.match_slugs ?? []) slugs.add(bairroSlug(alias));
  if (entry.wellhub_slug) slugs.add(bairroSlug(entry.wellhub_slug));
  return [...slugs];
}
