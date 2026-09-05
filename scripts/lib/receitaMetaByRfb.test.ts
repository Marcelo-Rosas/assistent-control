import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  digitsCnpj,
  normalizeBairroReceita,
  patchReceitaMetaFromRfb,
  resolveMunicipioNome,
} from './receitaMetaByRfb.ts';

describe('receitaMetaByRfb', () => {
  it('normalizeBairroReceita matches jarvis UPPER+espaço', () => {
    assert.equal(normalizeBairroReceita('paraíso'), 'PARAISO');
    assert.equal(normalizeBairroReceita('bela-vista'), 'BELA VISTA');
    assert.equal(normalizeBairroReceita('Bela Vista'), 'BELA VISTA');
  });

  it('resolveMunicipioNome 7107 → São Paulo', () => {
    assert.equal(resolveMunicipioNome('7107'), 'São Paulo');
  });

  it('digitsCnpj strips punctuation', () => {
    assert.equal(digitsCnpj('23.574.436/0001-90'), '23574436000190');
  });

  it('patchReceitaMetaFromRfb restores null bairro_normalizado', () => {
    const out = patchReceitaMetaFromRfb(
      {
        cnpj: '123',
        cidade: 'São Paulo',
        bairro: null,
        bairro_normalizado: null,
        is_ativo: true,
      },
      { cnpj: '123', bairro: 'BELA VISTA', municipio: '7107', situacao_cadastral: '02' },
    );
    assert.ok(out);
    assert.equal(out!.bairro, 'BELA VISTA');
    assert.equal(out!.bairro_normalizado, 'BELA VISTA');
    assert.equal(out!.cidade, 'São Paulo');
  });

  it('patchReceitaMetaFromRfb does not overwrite existing bairro_normalizado', () => {
    const out = patchReceitaMetaFromRfb(
      {
        cnpj: '123',
        bairro: 'MOEMA',
        bairro_normalizado: 'MOEMA',
        cidade: 'São Paulo',
        municipio_nome: 'São Paulo',
        is_ativo: true,
      },
      { bairro: 'BELA VISTA', municipio: '7107', situacao_cadastral: '02' },
    );
    assert.equal(out, null);
  });

  it('patchReceitaMetaFromRfb canonizes SAO PAULO cidade', () => {
    const out = patchReceitaMetaFromRfb(
      {
        cnpj: '1',
        cidade: 'SAO PAULO',
        bairro_normalizado: 'PINHEIROS',
      },
      { municipio: '7107', bairro: 'PINHEIROS' },
    );
    assert.ok(out);
    assert.equal(out!.cidade, 'São Paulo');
  });

  it('patchReceitaMetaFromRfb sets is_ativo from situacao when missing', () => {
    const out = patchReceitaMetaFromRfb(
      { cnpj: '1', bairro_normalizado: 'MOEMA', cidade: 'São Paulo' },
      { situacao_cadastral: '02', municipio: '7107', bairro: 'MOEMA' },
    );
    assert.ok(out);
    assert.equal(out!.is_ativo, true);
  });
});
