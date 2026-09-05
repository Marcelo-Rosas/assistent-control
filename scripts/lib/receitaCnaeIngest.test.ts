import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildReceitaChunk,
  buildReceitaText,
  formatCepText,
  formatEnderecoText,
  rowMatchesFilters,
  situacaoFlags,
} from './receitaCnaeIngest.ts';

const URB = {
  cnpj: '23574436000190',
  nome_fantasia: 'URB FITNESS BELA VISTA',
  situacao_cadastral: '02',
  data_situacao_cadastral: '20151029',
  data_inicio_atividade: '20151029',
  cnae_fiscal_principal: '9313100',
  cnae_fiscal_secundaria: '4729699,4781400,4763602',
  cnae_match: 'principal',
  tipo_logradouro: 'RUA',
  logradouro: 'ALMIRANTE MARQUES LEAO',
  numero: '584',
  complemento: null,
  bairro: 'BELA VISTA',
  cep: '01330010',
  uf: 'SP',
  municipio: '7107',
  ddd_1: '11',
  telefone_1: '79660631',
  correio_eletronico: 'RIBEDS@HOTMAIL.COM',
};

describe('receitaCnaeIngest', () => {
  it('formatCepText strips leading zeros', () => {
    assert.equal(formatCepText('01330010'), '1330010');
    assert.equal(formatCepText('01310915'), '1310915');
  });

  it('situacaoFlags maps 02/08', () => {
    assert.equal(situacaoFlags('02').is_ativo, true);
    assert.equal(situacaoFlags('08').is_baixado, true);
    assert.equal(situacaoFlags('08').situacao_label, 'Baixada');
  });

  it('formatEnderecoText matches legado URB', () => {
    assert.equal(
      formatEnderecoText(URB),
      'RUA ALMIRANTE MARQUES LEAO, 584, BELA VISTA, CEP 1330010, SP',
    );
  });

  it('buildReceitaText matches legado URB lines', () => {
    const text = buildReceitaText(URB);
    assert.ok(text.includes('CNPJ: 23574436000190'));
    assert.ok(text.includes('Nome fantasia: URB FITNESS BELA VISTA'));
    assert.ok(text.includes('Situação cadastral: 02 (Ativa)'));
    assert.ok(text.includes('Status operacional: estabelecimento ativo (aberto)'));
    assert.ok(text.includes('CNAEs secundários: 4729699,4781400,4763602'));
    assert.ok(text.includes('Telefone: (11) 79660631'));
  });

  it('buildReceitaChunk sets UPPER bairro + São Paulo + is_ativo', () => {
    const chunk = buildReceitaChunk('gid-test', URB);
    assert.ok(chunk);
    assert.equal(chunk!.chunk_id, 'receita:cnpj:23574436000190');
    assert.equal(chunk!.meta.bairro_normalizado, 'BELA VISTA');
    assert.equal(chunk!.meta.cidade, 'São Paulo');
    assert.equal(chunk!.meta.is_ativo, true);
    assert.equal(chunk!.meta.cnpj, '23574436000190');
    assert.equal(chunk!.source_kind, 'receita_cnpj_estabelecimento');
    assert.equal(chunk!.embedding_model, 'pending');
  });

  it('rowMatchesFilters UF/municipio/bairro', () => {
    assert.equal(
      rowMatchesFilters(URB, { uf: 'SP', municipio: '7107', bairro: 'Bela Vista' }),
      true,
    );
    assert.equal(rowMatchesFilters(URB, { uf: 'RJ' }), false);
    assert.equal(rowMatchesFilters(URB, { bairro: 'Pinheiros' }), false);
  });
});
