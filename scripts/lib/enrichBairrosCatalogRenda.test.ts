import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  enrichCatalogWithRenda,
  rowsFromLocalRendaFile,
} from './enrichBairrosCatalogRenda.ts';
import type { BairrosCatalog } from './wellhubBairrosCatalog.ts';

describe('enrichBairrosCatalogRenda', () => {
  it('maps renda_pc by distrito slug', () => {
    const catalog: BairrosCatalog = {
      cidade: 'São Paulo',
      uf: 'SP',
      ibge: '3550308',
      bairros: [
        { slug: 'itaim-bibi', bairro: 'Itaim Bibi' },
        { slug: 'cidade-lider', bairro: 'Cidade Líder' },
      ],
    };
    const rows = rowsFromLocalRendaFile('3550308', {
      '3550308': {
        'Itaim Bibi': 7672.13,
        'Cidade Lider': 1028.07,
      },
    });
    const result = enrichCatalogWithRenda(catalog, rows, {
      fonte: 'test',
    });
    const itaim = result.catalog.bairros.find((b) => b.slug === 'itaim-bibi');
    const lider = result.catalog.bairros.find((b) => b.slug === 'cidade-lider');
    assert.equal(itaim?.renda_pc, 7672.13);
    assert.equal(lider?.renda_pc, 1028.07);
    assert.equal(result.matched, 2);
  });

  it('does not overwrite existing renda without overwrite flag', () => {
    const catalog: BairrosCatalog = {
      cidade: 'Porto Alegre',
      uf: 'RS',
      ibge: '4314902',
      bairros: [{ slug: 'centro', bairro: 'Centro', renda_media_sm: 5.85 }],
    };
    const result = enrichCatalogWithRenda(
      catalog,
      [{ bairro: 'Centro', renda_pc: 999 }],
      { fonte: 'test' },
    );
    assert.equal(result.matched, 0);
    assert.equal(result.skipped_existing, 1);
    assert.equal(result.catalog.bairros[0]?.renda_pc, undefined);
  });
});
