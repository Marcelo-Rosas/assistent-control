import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseBairroFromDetailEndereco } from './tpDetailEnderecoParser.ts';

describe('tpDetailEnderecoParser', () => {
  it('parse endereco com andar + bairro + cidade + UF', () => {
    const r = parseBairroFromDetailEndereco(
      'Av Angelica, 634, 2° andar, Santa Cecilia, São Paulo, SP',
      { cidade: 'São Paulo', uf: 'SP' },
    );
    assert.equal(r?.bairro, 'Santa Cecilia');
    assert.equal(r?.bairro_slug, 'santa-cecilia');
  });

  it('parse endereco rua + numero + bairro + cidade + UF', () => {
    const r = parseBairroFromDetailEndereco(
      'R Alfredo Pujol, 1117, Santana, São Paulo, SP',
      { cidade: 'São Paulo', uf: 'SP' },
    );
    assert.equal(r?.bairro, 'Santana');
  });

  it('rejeita quando só logradouro + cidade (sem bairro)', () => {
    const r = parseBairroFromDetailEndereco('Av Paulista, 1000, São Paulo, SP', {
      cidade: 'São Paulo',
      uf: 'SP',
    });
    assert.equal(r, null);
  });

  it('rejeita SN e fragmentos de lote/quadra', () => {
    assert.equal(
      parseBairroFromDetailEndereco('Rua X, 10, SN, Cidade, SP', { cidade: 'Cidade' }),
      null,
    );
    assert.equal(
      parseBairroFromDetailEndereco('Av Y, CASA 1, Cidade, SP', { cidade: 'Cidade' }),
      null,
    );
  });
});
