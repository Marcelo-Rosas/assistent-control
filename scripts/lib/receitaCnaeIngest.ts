/**
 * Receita CNAE → eros_knowledge_chunks draft (gym_listing).
 * Meta: bairro_normalizado UPPER+espaço (jarvis_rag / backfill-receita-meta-by-rfb).
 */
import { createHash } from 'node:crypto';
import { parseRfDate } from './receitaKpis.ts';
import {
  digitsCnpj,
  normalizeBairroReceita,
  resolveMunicipioNome,
  type RfbEstabelecimento,
} from './receitaMetaByRfb.ts';
import { CODIGO_RFB_PARA_MUNICIPIO } from './municipioMapper.ts';

export type RfbEstabelecimentoFull = RfbEstabelecimento & {
  cnae_fiscal_principal?: string | null;
  cnae_fiscal_secundaria?: string | null;
  cnae_match?: string | null;
  tipo_logradouro?: string | null;
  logradouro?: string | null;
  numero?: string | null;
  complemento?: string | null;
  cep?: string | null;
  ddd_1?: string | null;
  telefone_1?: string | null;
  correio_eletronico?: string | null;
  data_inicio_atividade?: string | null;
  data_situacao_cadastral?: string | null;
};

export type ReceitaChunkDraft = {
  group_id: string;
  tenant_id: string | null;
  chunk_id: string;
  chunk_type: 'gym_listing';
  text: string;
  meta: Record<string, unknown>;
  content_hash: string;
  embedding_model: string;
  embedding_version: string;
  document_version: string;
  access_level: 'public';
  source_kind: string;
  source_ref: string;
};

const DOC_VERSION = 'receita-cnae-9313100-principal-ativo-baixada-v1';
const SOURCE_KIND = 'receita_cnpj_estabelecimento';

/** CEP no texto legado: sem zeros à esquerda (01330010 → 1330010). */
export function formatCepText(cep: string | null | undefined): string {
  const d = String(cep ?? '').replace(/\D/g, '');
  if (!d) return '';
  const stripped = d.replace(/^0+/, '');
  return stripped || '0';
}

export function situacaoFlags(sit: string): {
  is_ativo: boolean;
  is_baixado: boolean;
  situacao_label: string;
  situacao_normalizada: string;
  status_operacional: string;
} {
  const s = String(sit || '').trim();
  if (s === '02') {
    return {
      is_ativo: true,
      is_baixado: false,
      situacao_label: 'Ativa',
      situacao_normalizada: 'ATIVA',
      status_operacional: 'estabelecimento ativo (aberto)',
    };
  }
  if (s === '08') {
    return {
      is_ativo: false,
      is_baixado: true,
      situacao_label: 'Baixada',
      situacao_normalizada: 'BAIXADA',
      status_operacional: 'estabelecimento baixado (fechado)',
    };
  }
  return {
    is_ativo: false,
    is_baixado: false,
    situacao_label: s || 'Desconhecida',
    situacao_normalizada: s || 'DESCONHECIDA',
    status_operacional: `situação cadastral ${s || '?'}`,
  };
}

export function formatEnderecoText(row: RfbEstabelecimentoFull): string {
  const tipo = String(row.tipo_logradouro || '').trim();
  const log = String(row.logradouro || '').trim();
  const num = String(row.numero || '').trim();
  const comp = String(row.complemento || '').trim();
  const bairro = String(row.bairro || '').trim();
  const cep = formatCepText(row.cep);
  const uf = String(row.uf || '').trim().toUpperCase();
  const logradouro = [tipo, log].filter(Boolean).join(' ').trim();
  const parts: string[] = [];
  if (logradouro) parts.push(logradouro);
  if (num) parts.push(num);
  if (comp) parts.push(comp);
  if (bairro) parts.push(bairro);
  if (cep) parts.push(`CEP ${cep}`);
  if (uf) parts.push(uf);
  return parts.join(', ');
}

export function buildReceitaText(row: RfbEstabelecimentoFull): string {
  const cnpj = digitsCnpj(row.cnpj);
  const sit = String(row.situacao_cadastral || '').trim();
  const flags = situacaoFlags(sit);
  const inicio = parseRfDate(String(row.data_inicio_atividade ?? '')) || '';
  const sitDate = parseRfDate(String(row.data_situacao_cadastral ?? '')) || '';
  const nome = String(row.nome_fantasia || '').trim();
  const cnae = String(row.cnae_fiscal_principal || '9313100').trim();
  const match = String(row.cnae_match || 'principal').trim();
  const mun = String(row.municipio || '').trim();
  const uf = String(row.uf || '').trim().toUpperCase();
  const sec = String(row.cnae_fiscal_secundaria || '').trim();
  const ddd = String(row.ddd_1 || '').trim();
  const tel = String(row.telefone_1 || '').trim();
  const email = String(row.correio_eletronico || '').trim();

  const lines = [
    `CNPJ: ${cnpj}`,
    `Nome fantasia: ${nome}`,
    `Endereço: ${formatEnderecoText(row)}`,
    `UF: ${uf}`,
    `Município (código RFB): ${mun}`,
    `CNAE principal: ${cnae}`,
    `Match CNAE 9313100: ${match}`,
    `Situação cadastral: ${sit} (${flags.situacao_label})`,
    `Data abertura (início atividade): ${inicio}`,
  ];
  if (flags.is_baixado) {
    lines.push(`Data baixa (situação cadastral): ${sitDate}`);
  } else {
    lines.push(`Data situação cadastral: ${sitDate}`);
  }
  lines.push(`Status operacional: ${flags.status_operacional}`);
  if (sec) lines.push(`CNAEs secundários: ${sec}`);
  if (ddd && tel) lines.push(`Telefone: (${ddd}) ${tel}`);
  if (email) lines.push(`E-mail: ${email}`);
  return lines.join('\n');
}

export function contentHashReceita(groupId: string, cnpj: string): string {
  return createHash('sha256')
    .update([groupId, 'receita_cnpj', digitsCnpj(cnpj)].join('|'))
    .digest('hex');
}

export function buildReceitaChunk(
  groupId: string,
  row: RfbEstabelecimentoFull,
  opts?: { tenantId?: string | null; pendingEmbed?: boolean },
): ReceitaChunkDraft | null {
  const cnpj = digitsCnpj(row.cnpj);
  if (cnpj.length !== 14) return null;

  const sit = String(row.situacao_cadastral || '').trim();
  const flags = situacaoFlags(sit);
  const munCode = String(row.municipio || '').trim();
  const munKey = munCode.padStart(4, '0');
  const munRef =
    CODIGO_RFB_PARA_MUNICIPIO[munKey] || CODIGO_RFB_PARA_MUNICIPIO[munCode];
  const munNome = resolveMunicipioNome(munCode) || munRef?.nome?.trim() || '';
  const cidade = munNome || '';
  const bairroRaw = String(row.bairro || '').trim();
  const bairroNorm = bairroRaw ? normalizeBairroReceita(bairroRaw) : '';
  const nome = String(row.nome_fantasia || '').trim();
  const inicio = parseRfDate(String(row.data_inicio_atividade ?? ''));
  const sitDate = parseRfDate(String(row.data_situacao_cadastral ?? ''));
  const anoAbertura = inicio ? Number(inicio.slice(0, 4)) : null;
  const anoFechamento =
    flags.is_baixado && sitDate ? Number(sitDate.slice(0, 4)) : null;
  const text = buildReceitaText(row);
  const pending = opts?.pendingEmbed !== false;

  return {
    group_id: groupId,
    tenant_id: opts?.tenantId ?? null,
    chunk_id: `receita:cnpj:${cnpj}`,
    chunk_type: 'gym_listing',
    text,
    meta: {
      uf: String(row.uf || '').trim().toUpperCase() || null,
      cnae: String(row.cnae_fiscal_principal || '9313100').trim(),
      cnpj,
      bairro: bairroRaw || null,
      cidade: cidade || null,
      source: 'receita_federal',
      is_ativo: flags.is_ativo,
      municipio: munCode || null,
      cnae_match: String(row.cnae_match || 'principal').trim(),
      is_baixado: flags.is_baixado,
      ano_abertura: anoAbertura,
      nome_academia: nome,
      nome_fantasia: nome,
      ano_fechamento: anoFechamento,
      municipio_ibge: munRef?.ibge || null,
      municipio_nome: munNome || null,
      situacao_label: flags.situacao_label,
      municipio_codigo: munCode || null,
      bairro_normalizado: bairroNorm || null,
      situacao_cadastral: sit || null,
      situacao_normalizada: flags.situacao_normalizada,
      data_inicio_atividade: inicio,
      data_situacao_cadastral: sitDate,
      municipios_relacionados: cidade ? [cidade] : [],
    },
    content_hash: contentHashReceita(groupId, cnpj),
    embedding_model: pending ? 'pending' : 'mxbai-embed-large',
    embedding_version: pending ? '0' : '1',
    document_version: DOC_VERSION,
    access_level: 'public',
    source_kind: SOURCE_KIND,
    source_ref: cnpj,
  };
}

export function rowMatchesFilters(
  row: RfbEstabelecimentoFull,
  filters: {
    uf?: string;
    municipio?: string;
    bairro?: string;
  },
): boolean {
  if (filters.uf) {
    if (String(row.uf || '').trim().toUpperCase() !== filters.uf.toUpperCase()) {
      return false;
    }
  }
  if (filters.municipio) {
    const want = String(filters.municipio).trim();
    const got = String(row.municipio || '').trim();
    if (got !== want && got.padStart(4, '0') !== want.padStart(4, '0')) {
      return false;
    }
  }
  if (filters.bairro) {
    const want = normalizeBairroReceita(filters.bairro);
    const got = normalizeBairroReceita(String(row.bairro || ''));
    if (!got || got !== want) return false;
  }
  return true;
}
