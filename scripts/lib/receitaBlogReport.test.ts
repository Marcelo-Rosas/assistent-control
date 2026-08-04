import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  parseQuarter,
  monthsInQuarter,
  lifeDays,
  buildVidaStats,
  rankTopN,
  mergeRankedCities,
  buildOnda,
  buildBairrosFechamento,
  buildFichaBase,
  type CityMovimento,
} from './receitaBlogReport.ts';
import type { CnpjRow } from './receitaKpis.ts';

describe('parseQuarter', () => {
  it('parses valid quarter', () => {
    assert.deepEqual(parseQuarter('2026-Q1'), { year: 2026, q: 1 });
    assert.deepEqual(parseQuarter('2025-Q4'), { year: 2025, q: 4 });
  });

  it('throws on invalid format', () => {
    assert.throws(() => parseQuarter('2026-Q5'), /invalid quarter/i);
    assert.throws(() => parseQuarter('26-Q1'), /invalid quarter/i);
    assert.throws(() => parseQuarter('2026-01'), /invalid quarter/i);
  });
});

describe('monthsInQuarter', () => {
  it('maps Q1', () => {
    assert.deepEqual(monthsInQuarter('2026-Q1'), ['2026-01', '2026-02', '2026-03']);
  });

  it('maps Q4', () => {
    assert.deepEqual(monthsInQuarter('2025-Q4'), ['2025-10', '2025-11', '2025-12']);
  });
});

describe('lifeDays', () => {
  it('returns days between valid dates', () => {
    assert.equal(lifeDays('20200101', '20250101'), 1827);
  });

  it('returns null when baixa before inicio', () => {
    assert.equal(lifeDays('20250101', '20200101'), null);
  });

  it('returns null for invalid dates', () => {
    assert.equal(lifeDays('00000000', '20250101'), null);
    assert.equal(lifeDays('20250101', 'invalid'), null);
  });
});

describe('buildVidaStats', () => {
  it('faixas + mediana', () => {
    const s = buildVidaStats([100, 400, 800, 2000]);
    assert.equal(s.n, 4);
    assert.ok(s.median_years !== null);
    assert.equal(s.faixas.lt_1y + s.faixas.y1_3 + s.faixas.y3_5 + s.faixas.y5_plus, 4);
    assert.equal(s.faixas.lt_1y, 1);
    assert.equal(s.faixas.y1_3, 2);
    assert.equal(s.faixas.y5_plus, 1);
  });

  it('empty list', () => {
    const s = buildVidaStats([]);
    assert.equal(s.n, 0);
    assert.equal(s.median_years, null);
    assert.equal(s.faixas.lt_1y, 0);
  });

  it('faixas_pct sums to 100', () => {
    const s = buildVidaStats([100, 400, 800, 2000]);
    const pct =
      s.faixas_pct.lt_1y +
      s.faixas_pct.y1_3 +
      s.faixas_pct.y3_5 +
      s.faixas_pct.y5_plus;
    assert.equal(Math.round(pct), 100);
  });
});

describe('rankTopN + merge', () => {
  it('merge same city once', () => {
    const cities: CityMovimento[] = [
      {
        key: 'SP|São Paulo',
        label: 'São Paulo/SP',
        uf: 'SP',
        ativos: 100,
        entrantes: 10,
        baixados: 5,
        saldo: 5,
      },
      {
        key: 'CE|Fortaleza',
        label: 'Fortaleza/CE',
        uf: 'CE',
        ativos: 50,
        entrantes: 1,
        baixados: 4,
        saldo: -3,
      },
      {
        key: 'MG|Belo Horizonte',
        label: 'Belo Horizonte/MG',
        uf: 'MG',
        ativos: 60,
        entrantes: 8,
        baixados: 1,
        saldo: 7,
      },
    ];
    const { mortalidade, crescimento } = rankTopN(cities, 2);
    assert.equal(mortalidade.length, 2);
    assert.equal(crescimento.length, 2);
    assert.equal(mortalidade[0].key, 'SP|São Paulo');
    assert.equal(crescimento[0].key, 'MG|Belo Horizonte');

    const merged = mergeRankedCities(mortalidade, crescimento);
    const keys = merged.map((c) => c.key);
    assert.equal(new Set(keys).size, keys.length);
    const sp = merged.find((c) => c.key.startsWith('SP|'));
    assert.ok(sp?.rankings.mortalidade);
    assert.ok(sp?.rankings.crescimento);
    assert.equal(sp?.rankings.mortalidade?.rank, 1);
    assert.equal(sp?.rankings.crescimento?.rank, 2);
  });
});

const BAIXADOS_FIXTURE: CnpjRow[] = [
  {
    cnpj: '11111111000111',
    situacao_cadastral: '08',
    data_inicio_atividade: '20200101',
    data_situacao_cadastral: '20260115',
    uf: 'CE',
    municipio: '1389',
    bairro: 'Centro',
    nome_fantasia: 'A',
  },
  {
    cnpj: '22222222000122',
    situacao_cadastral: '08',
    data_inicio_atividade: '20230101',
    data_situacao_cadastral: '20260201',
    uf: 'CE',
    municipio: '1389',
    bairro: 'Aldeota',
    nome_fantasia: 'B',
  },
  {
    cnpj: '33333333000133',
    situacao_cadastral: '08',
    data_inicio_atividade: '20240101',
    data_situacao_cadastral: '20260210',
    uf: 'CE',
    municipio: '1389',
    bairro: 'Centro',
    nome_fantasia: 'C',
  },
  {
    cnpj: '44444444000144',
    situacao_cadastral: '08',
    data_inicio_atividade: '20200101',
    data_situacao_cadastral: '20251201',
    uf: 'SP',
    municipio: '7107',
    bairro: 'Pinheiros',
    nome_fantasia: 'D',
  },
];

const resolveKey = (row: CnpjRow) =>
  row.uf === 'CE' ? 'CE|Fortaleza' : 'SP|São Paulo';

describe('buildOnda', () => {
  it('counts baixados per month in lookback window', () => {
    const onda = buildOnda(
      BAIXADOS_FIXTURE,
      'CE|Fortaleza',
      '2026-02',
      3,
      resolveKey,
    );
    assert.equal(onda.lookback_months, 3);
    assert.deepEqual(onda.baixados_por_mes, [
      { month: '2025-12', n: 0 },
      { month: '2026-01', n: 1 },
      { month: '2026-02', n: 2 },
    ]);
  });
});

describe('buildBairrosFechamento', () => {
  it('groups by bairro with minN filter', () => {
    const rows = BAIXADOS_FIXTURE.filter((r) => r.uf === 'CE');
    const bairros = buildBairrosFechamento(rows, 'CE|Fortaleza', resolveKey, 2);
    assert.equal(bairros.length, 1);
    assert.equal(bairros[0].bairro, 'Centro');
    assert.equal(bairros[0].n, 2);
    assert.ok(bairros[0].median_years !== null);
  });
});

describe('buildFichaBase', () => {
  it('builds ficha with gymsite stub', () => {
    const city: CityMovimento = {
      key: 'CE|Fortaleza',
      label: 'Fortaleza/CE',
      uf: 'CE',
      ibge: '2304400',
      ativos: 50,
      entrantes: 3,
      baixados: 2,
      saldo: 1,
    };
    const ficha = buildFichaBase({
      quarter: '2026-Q1',
      city,
      rankings: { mortalidade: { rank: 1, baixados: 2 } },
      vidaBaixados: buildVidaStats([400, 800]),
      bairrosFechamento: [{ bairro: 'Centro', n: 2, median_years: 2 }],
      onda: { lookback_months: 3, baixados_por_mes: [{ month: '2026-01', n: 1 }] },
      fontes: ['receita-csv'],
      generatedAt: '2026-08-04T12:00:00.000Z',
    });

    assert.equal(ficha.quarter, '2026-Q1');
    assert.equal(ficha.city_key, 'CE|Fortaleza');
    assert.equal(ficha.movimento.saldo, 1);
    assert.equal(ficha.vida_baixados.n, 2);
    assert.equal(ficha.gymsite.status, 'indisponivel');
    assert.equal(ficha.gymsite.motivo, 'pending_enrich');
    assert.deepEqual(ficha.fontes, ['receita-csv']);
  });
});
