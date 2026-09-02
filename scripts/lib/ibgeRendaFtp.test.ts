import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { rowsToRendaMap } from './ibgeRendaFtp.ts';

describe('ibgeRendaFtp', () => {
  it('rowsToRendaMap indexes by bairro name', () => {
    const map = rowsToRendaMap([
      {
        bairro: 'Savassi',
        bairro_norm: 'savassi',
        renda_pc: 1234.5,
        renda_media: 2000,
        domicilios: 10,
        moradores: 20,
      },
    ]);
    assert.equal(map.Savassi, 1234.5);
  });
});
