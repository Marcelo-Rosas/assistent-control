/**
 * Receita RAG meta ↔ RFB row: restore bairro / bairro_normalizado (UPPER+espaço)
 * for jarvis_rag.contar_penetracao. Agregadores usam slug kebab; Receita usa UPPER.
 */
import { CODIGO_RFB_PARA_MUNICIPIO } from './municipioMapper.ts';

export type RfbEstabelecimento = {
  cnpj?: string | null;
  bairro?: string | null;
  municipio?: string | null;
  situacao_cadastral?: string | null;
  nome_fantasia?: string | null;
  uf?: string | null;
};

function foldCity(s: string): string {
  return s
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase();
}

/** Forma Receita: 'paraíso' / 'bela-vista' → 'PARAISO' / 'BELA VISTA'. */
export function normalizeBairroReceita(bairro: string): string {
  const raw = String(bairro || '').trim();
  if (!raw) return '';
  const noAccents = raw.normalize('NFD').replace(/\p{M}/gu, '');
  return noAccents
    .replace(/[-_]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
}

export function digitsCnpj(cnpj: unknown): string {
  return String(cnpj ?? '').replace(/\D/g, '');
}

export function resolveMunicipioNome(codigo: string | null | undefined): string | null {
  if (!codigo) return null;
  const trimmed = String(codigo).trim();
  const key = trimmed.padStart(4, '0');
  const hit = CODIGO_RFB_PARA_MUNICIPIO[key] || CODIGO_RFB_PARA_MUNICIPIO[trimmed];
  return hit?.nome?.trim() || null;
}

/**
 * Patch geo incompleta a partir da linha RFB (join por CNPJ).
 * Não sobrescreve bairro_normalizado já preenchido.
 * Returns null se nada muda.
 */
export function patchReceitaMetaFromRfb(
  meta: Record<string, unknown> | null | undefined,
  rfb: RfbEstabelecimento | null | undefined,
): Record<string, unknown> | null {
  if (!meta || typeof meta !== 'object' || !rfb) return null;
  const next: Record<string, unknown> = { ...meta };
  let changed = false;

  const rfbBairro = String(rfb.bairro || '').trim();
  const bnExisting = String(next.bairro_normalizado || '').trim();
  if (rfbBairro) {
    if (!String(next.bairro || '').trim()) {
      next.bairro = rfbBairro;
      changed = true;
    }
    if (!bnExisting) {
      const bn = normalizeBairroReceita(rfbBairro);
      if (bn) {
        next.bairro_normalizado = bn;
        changed = true;
      }
    }
  }

  const munCode = String(rfb.municipio || next.municipio || '').trim();
  const munNome = resolveMunicipioNome(munCode);
  if (munNome) {
    if (!String(next.municipio_nome || '').trim()) {
      next.municipio_nome = munNome;
      changed = true;
    }
    const cidade = String(next.cidade || '').trim();
    if (!cidade) {
      next.cidade = munNome;
      changed = true;
    } else if (foldCity(cidade) === foldCity(munNome) && cidade !== munNome) {
      // SAO PAULO → São Paulo
      next.cidade = munNome;
      changed = true;
    }
  }

  if (next.is_ativo === undefined || next.is_ativo === null) {
    const sit = String(rfb.situacao_cadastral || '').trim();
    if (sit === '02') {
      next.is_ativo = true;
      changed = true;
    } else if (sit === '08') {
      next.is_ativo = false;
      changed = true;
    }
  }

  return changed ? next : null;
}
