/**
 * GuruPass chunk meta: ensure bairro_normalizado (slug kebab) matches
 * jarvis_rag.normalize_bairro_slug / Wellhub ingest normalizeBairro.
 */
import { normalizeBairro } from '../../src/lib/modalityClassifier.ts';

export function resolveBairroLabel(meta: Record<string, unknown>): string {
  const raw = meta.bairro ?? meta.neighborhood;
  if (typeof raw === 'string') return raw.trim();
  if (raw && typeof raw === 'object') {
    const name = (raw as { name?: unknown }).name;
    if (typeof name === 'string') return name.trim();
  }
  return '';
}

export function resolveCidadeLabel(meta: Record<string, unknown>): string {
  const raw = meta.cidade ?? meta.city;
  if (typeof raw === 'string') return raw.trim();
  if (raw && typeof raw === 'object') {
    const name = (raw as { name?: unknown }).name;
    if (typeof name === 'string') return name.trim();
  }
  return '';
}

/** Patch missing/stale geo fields. Returns null if nothing to change. */
export function patchGpBairroMeta(
  meta: Record<string, unknown> | null | undefined,
): Record<string, unknown> | null {
  if (!meta || typeof meta !== 'object') return null;
  const next: Record<string, unknown> = { ...meta };
  let changed = false;

  const bairro = resolveBairroLabel(next);
  if (bairro) {
    if (next.bairro !== bairro) {
      next.bairro = bairro;
      changed = true;
    }
    const bn = normalizeBairro(bairro);
    if (bn && next.bairro_normalizado !== bn) {
      next.bairro_normalizado = bn;
      changed = true;
    }
  }

  const cidade = resolveCidadeLabel(next);
  if (cidade && next.cidade !== cidade) {
    next.cidade = cidade;
    changed = true;
  }

  return changed ? next : null;
}

export { normalizeBairro as normalizeBairroSlug };
