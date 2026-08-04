import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { enrichCityFromGymsite } from './gymsiteReceitaEnrich.ts';

describe('enrichCityFromGymsite', () => {
  it('returns indisponivel without credentials', async () => {
    const r = await enrichCityFromGymsite('2304400', { url: '', key: '' });
    assert.equal(r.status, 'indisponivel');
    assert.ok(r.motivo);
  });

  it('maps pib + renda from mock client', async () => {
    const mock = {
      from(table: string) {
        return {
          select(_cols: string) {
            return {
              eq(_col: string, _val: string) {
                return {
                  limit(_n: number) {
                    if (table === 'municipio_pib') {
                      return Promise.resolve({
                        data: [
                          {
                            id_municipio: '2304400',
                            populacao: 1,
                            pib_reais: 1e9,
                            pib_per_capita: 1000,
                            ano: 2023,
                            fonte: 'test',
                          },
                        ],
                        error: null,
                      });
                    }
                    return Promise.resolve({
                      data: [
                        {
                          bairro: 'Aldeota',
                          renda_pc: 2000,
                          renda_media: 4000,
                        },
                      ],
                      error: null,
                    });
                  },
                };
              },
            };
          },
        };
      },
    };
    const r = await enrichCityFromGymsite('2304400', { client: mock });
    assert.equal(r.status, 'ok');
    assert.equal(r.pib?.ano, 2023);
    assert.equal(r.renda?.n_bairros, 1);
    assert.equal(r.renda?.renda_pc_mediana, 2000);
    assert.equal(r.renda?.top3[0]?.bairro, 'Aldeota');
  });

  it('returns indisponivel when both tables empty', async () => {
    const mock = {
      from(_table: string) {
        return {
          select() {
            return {
              eq() {
                return {
                  limit() {
                    return Promise.resolve({ data: [], error: null });
                  },
                };
              },
            };
          },
        };
      },
    };
    const r = await enrichCityFromGymsite('9999999', { client: mock });
    assert.equal(r.status, 'indisponivel');
  });
});
