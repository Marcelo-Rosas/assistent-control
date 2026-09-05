/**
 * Extrai bairro do endereço completo da página de detalhe TotalPass (JSON-LD streetAddress).
 * Formato típico: "Av X, 634, 2° andar, Bairro, Cidade, UF"
 *
 * ⚠️ SMOKE / EXPLORATÓRIO — NÃO usar em produção.
 * Spec: Docs/superpowers/specs/2026-09-02-tp-bairro-cep-design.md
 * Bairro canônico = lookup CEP (ViaCEP/BrasilAPI), não parse de texto.
 */
import { bairroSlug } from './wellhubBairrosCatalog.ts';

const STREET_PREFIX =
  /^(r\.?|rua|av\.?|avenida|al\.?|alameda|trav\.?|travessa|rod\.?|rodovia|est\.?|estrada|pc\.?|praca|praça|lgo\.?|largo|vl\.?|vila)\b/i;

function normalize(s: string): string {
  return s
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .trim();
}

function looksLikeStreetPart(s: string): boolean {
  const t = s.trim();
  if (!t) return true;
  if (/^\d+$/.test(t)) return true;
  if (/\d+\s*°?\s*andar/i.test(t)) return true;
  if (STREET_PREFIX.test(t)) return true;
  if (/^(sala|loja|bloco|conj\.?|cj\.?|galpão|galpao|km\s*\d)/i.test(t)) return true;
  return false;
}

/** Rejeita fragmentos de endereço que não são nome de bairro. */
function looksLikeBairro(s: string): boolean {
  const t = s.trim();
  if (looksLikeStreetPart(t)) return false;
  if (/^s\/?n$/i.test(t)) return false;
  if (/^casa\s*\d*$/i.test(t)) return false;
  if (
    /\b(lote|loja|bloco|conjunto|conj\.|quadra|edificio|edif\.|smpw|cond\.|residencial)\b/i.test(
      t,
    )
  ) {
    return false;
  }
  if (/\b(q\s*\d|c\s*j\s*\d|lt\s*\d|lj\s*\d)\b/i.test(t)) return false;
  if (t.length <= 3) return false;
  if (/area especial/i.test(t)) return false;
  if (/\blotes?\b/i.test(t)) return false;
  if (/^st\s/i.test(t) && /\b(q\s|c\s*j|lt|lj)\b/i.test(t)) return false;
  return true;
}

function findCityIndex(parts: string[], cidade?: string | null): number {
  if (!cidade?.trim()) return parts.length - 1;

  const cidadeNorm = normalize(cidade);
  for (let i = parts.length - 1; i >= 0; i--) {
    const pn = normalize(parts[i]!);
    if (pn === cidadeNorm || pn.startsWith(cidadeNorm) || cidadeNorm.startsWith(pn)) {
      return i;
    }
  }
  return parts.length - 1;
}

export type TpDetailBairroParsed = {
  bairro: string;
  bairro_slug: string;
  cidade: string | null;
  uf: string | null;
  endereco: string;
};

export function parseBairroFromDetailEndereco(
  endereco: string,
  opts?: { cidade?: string | null; uf?: string | null },
): TpDetailBairroParsed | null {
  const raw = endereco.trim();
  if (raw.length < 5) return null;

  const parts = raw
    .split(',')
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
  if (parts.length < 2) return null;

  let uf: string | null = null;
  if (/^[A-Z]{2}$/i.test(parts[parts.length - 1]!)) {
    uf = parts.pop()!.toUpperCase();
  }
  if (parts.length < 2) return null;

  const cityIdx = findCityIndex(parts, opts?.cidade);
  if (cityIdx <= 0) return null;

  const cidade = parts[cityIdx] ?? null;

  for (let j = cityIdx - 1; j >= 0; j--) {
    const candidate = parts[j]!;
    if (!looksLikeBairro(candidate)) continue;
    if (candidate.length < 2 || candidate.length > 64) continue;
    return {
      bairro: candidate,
      bairro_slug: bairroSlug(candidate),
      cidade,
      uf: uf ?? opts?.uf?.toUpperCase() ?? null,
      endereco: raw,
    };
  }

  return null;
}
