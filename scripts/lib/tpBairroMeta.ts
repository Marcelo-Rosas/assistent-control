/**
 * TotalPass chunk meta: apply bairro from tp-bairro-index (resolve:tp-bairros).
 * Ingest SP never wrote bairro / bairro_normalizado — penetração sempre 0
 * para bairros só presentes no índice CEP/Nominatim.
 */
import { normalizeBairro } from '../../src/lib/modalityClassifier.ts';

export type TpBairroIndexEntry = {
  bairro?: string;
  bairro_slug?: string;
  municipio?: string;
  uf?: string;
};

export function resolveGymIdFromMeta(
  meta: Record<string, unknown> | null | undefined,
  sourceRef?: string | null,
): string {
  if (meta && typeof meta.gym_id === 'string' && meta.gym_id.trim()) {
    return meta.gym_id.trim();
  }
  if (typeof sourceRef === 'string' && sourceRef.trim()) {
    const m = sourceRef.match(
      /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i,
    );
    if (m) return m[0];
  }
  return '';
}

/**
 * Patch missing bairro_normalizado from index entry.
 * Slug kebab (agregador). Não sobrescreve bn já preenchido.
 */
export function patchTpBairroFromIndex(
  meta: Record<string, unknown> | null | undefined,
  entry: TpBairroIndexEntry | null | undefined,
): Record<string, unknown> | null {
  if (!meta || typeof meta !== 'object' || !entry) return null;
  const next: Record<string, unknown> = { ...meta };
  let changed = false;

  const bnExisting = String(next.bairro_normalizado || '').trim();
  const label = String(entry.bairro || '').trim();
  const slug =
    String(entry.bairro_slug || '').trim() ||
    (label ? normalizeBairro(label) : '');

  if (!bnExisting && slug) {
    next.bairro_normalizado = slug;
    changed = true;
  }
  if (!String(next.bairro || '').trim() && label) {
    next.bairro = label;
    changed = true;
  }

  return changed ? next : null;
}

export { normalizeBairro as normalizeBairroSlug };
