import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  parseRfDate,
  monthOf,
  normalizeBairro,
  filterEntrantes,
  filterBaixados,
  diffSnapshots,
  buildKpiTree,
  type CnpjRow,
} from './receitaKpis.ts';

const FIXTURE: CnpjRow[] = [
  {
    cnpj: '11111111000111',
    situacao_cadastral: '02',
    data_inicio_atividade: '20250115',
    data_situacao_cadastral: '20250115',
    uf: 'CE',
    municipio: '1389',
    bairro: 'Centro',
    nome_fantasia: 'Academia A',
  },
  {
    cnpj: '22222222000122',
    situacao_cadastral: '02',
    data_inicio_atividade: '20250201',
    data_situacao_cadastral: '20250201',
    uf: 'CE',
    municipio: '1389',
    bairro: 'Aldeota',
    nome_fantasia: 'Academia B',
  },
  {
    cnpj: '33333333000133',
    situacao_cadastral: '08',
    data_inicio_atividade: '20200101',
    data_situacao_cadastral: '20250120',
    uf: 'CE',
    municipio: '1389',
    bairro: 'Centro',
    nome_fantasia: 'Fechada',
  },
  {
    cnpj: '44444444000144',
    situacao_cadastral: '02',
    data_inicio_atividade: '20240601',
    data_situacao_cadastral: '20240601',
    uf: 'SP',
    municipio: '7107',
    bairro: 'Pinheiros',
    nome_fantasia: 'SP Gym',
  },
  {
    cnpj: '55555555000155',
    situacao_cadastral: '02',
    data_inicio_atividade: '20250128',
    data_situacao_cadastral: '20250128',
    uf: 'CE',
    municipio: '1389',
    bairro: '',
    nome_fantasia: 'Sem Bairro',
  },
];

describe('parseRfDate', () => {
  it('parses YYYYMMDD string', () => {
    assert.equal(parseRfDate('20250115'), '2025-01-15');
  });

  it('parses YYYYMMDD number', () => {
    assert.equal(parseRfDate(20250115), '2025-01-15');
  });

  it('returns null for invalid dates', () => {
    assert.equal(parseRfDate('00000000'), null);
    assert.equal(parseRfDate(''), null);
    assert.equal(parseRfDate('20251301'), null);
  });
});

describe('monthOf', () => {
  it('extracts YYYY-MM from ISO date', () => {
    assert.equal(monthOf('2025-01-15'), '2025-01');
  });
});

describe('normalizeBairro', () => {
  it('slugifies accents and spaces', () => {
    assert.equal(normalizeBairro('São José'), 'sao-jose');
  });

  it('returns placeholder for empty', () => {
    assert.equal(normalizeBairro(''), '(sem-bairro)');
  });
});

describe('filterEntrantes', () => {
  it('keeps rows whose inicio falls in month', () => {
    const jan = filterEntrantes(FIXTURE, '2025-01');
    assert.deepEqual(
      jan.map((r) => r.cnpj),
      ['11111111000111', '55555555000155'],
    );
  });
});

describe('filterBaixados', () => {
  it('keeps sit 08 with situacao date in month', () => {
    const jan = filterBaixados(FIXTURE, '2025-01');
    assert.deepEqual(jan.map((r) => r.cnpj), ['33333333000133']);
  });

  it('ignores non-08 rows', () => {
    assert.equal(filterBaixados(FIXTURE, '2025-02').length, 0);
  });
});

describe('diffSnapshots', () => {
  it('detects novos and baixados transitions', () => {
    const prev = new Map([
      ['11111111000111', '02'],
      ['33333333000133', '02'],
      ['99999999000199', '02'],
    ]);
    const curr = new Map([
      ['11111111000111', '02'],
      ['22222222000122', '02'],
      ['33333333000133', '08'],
    ]);

    const { novos, baixados } = diffSnapshots(prev, curr);
    assert.deepEqual(novos, ['22222222000122']);
    assert.deepEqual(baixados, ['33333333000133', '99999999000199']);
  });
});

describe('buildKpiTree', () => {
  const resolveCity = (uf: string, code: string) =>
    code === '1389' ? 'Fortaleza' : `RFB:${code}`;

  it('builds geo tree with totals and saldo', () => {
    const entrantes = filterEntrantes(FIXTURE, '2025-01');
    const baixados = filterBaixados(FIXTURE, '2025-01');
    const ativosRows = FIXTURE.filter((r) => r.situacao_cadastral === '02');

    const kpis = buildKpiTree({
      month: '2025-01',
      ativosRows,
      entrantes,
      baixados,
      diffNovosCnpjs: ['22222222000122'],
      diffBaixadosCnpjs: ['33333333000133'],
      resolveCity,
      source: {
        ativos_csv: 'ativos.csv',
        ativo_baixada_csv: 'baixada.csv',
        snapshot_prev: null,
      },
      generatedAt: '2026-08-03T12:00:00.000Z',
    });

    assert.equal(kpis.cnae, '9313100');
    assert.equal(kpis.month, '2025-01');
    assert.equal(kpis.generated_at, '2026-08-03T12:00:00.000Z');
    assert.equal(kpis.totals.ativos, 4);
    assert.equal(kpis.totals.entrantes_mes, 2);
    assert.equal(kpis.totals.baixados_mes, 1);
    assert.equal(kpis.totals.saldo_mes, 1);
    assert.equal(kpis.totals.diff_novos, 1);
    assert.equal(kpis.totals.diff_baixados, 1);

    assert.equal(kpis.by_uf.length, 2);

    const ce = kpis.by_uf.find((n) => n.key === 'CE');
    assert.ok(ce);
    assert.equal(ce.ativos, 3);
    assert.equal(ce.entrantes_mes, 2);
    assert.equal(ce.baixados_mes, 1);
    assert.equal(ce.saldo_mes, 1);
    assert.ok(ce.children?.length === 1);

    const fortaleza = ce.children![0];
    assert.equal(fortaleza.key, 'CE|1389');
    assert.equal(fortaleza.label, 'Fortaleza');
    assert.equal(fortaleza.diff_novos, 1);
    assert.equal(fortaleza.diff_baixados, 1);
    assert.ok(fortaleza.children!.length >= 2);

    const sp = kpis.by_uf.find((n) => n.key === 'SP');
    assert.ok(sp);
    assert.equal(sp.ativos, 1);
    assert.equal(sp.diff_novos, 0);
  });

  const sumTree = (nodes: { diff_novos: number; diff_baixados: number }[]) =>
    nodes.reduce(
      (acc, n) => {
        acc.novos += n.diff_novos;
        acc.baixados += n.diff_baixados;
        return acc;
      },
      { novos: 0, baixados: 0 },
    );

  it('reconciles totals with drill-down when a diff CNPJ is only in diffRowLookup', () => {
    const ativosRows = FIXTURE.filter((r) => r.situacao_cadastral === '02');
    // 66666… exists only in the current snapshot (diffRowLookup), not in
    // ativos/entrantes/baixados — the exact case that used to be dropped.
    const extra: CnpjRow = {
      cnpj: '66666666000166',
      situacao_cadastral: '08',
      data_inicio_atividade: '20210101',
      data_situacao_cadastral: '20250110',
      uf: 'CE',
      municipio: '1389',
      bairro: 'Meireles',
      nome_fantasia: 'Só no snapshot',
    };
    const kpis = buildKpiTree({
      month: '2025-01',
      ativosRows,
      entrantes: [],
      baixados: [],
      diffNovosCnpjs: ['22222222000122', '66666666000166'],
      diffBaixadosCnpjs: [],
      diffRowLookup: new Map([[extra.cnpj, extra]]),
      resolveCity,
      source: { ativos_csv: 'a', ativo_baixada_csv: 'b', snapshot_prev: null },
    });
    assert.equal(kpis.totals.diff_novos, 2);
    assert.equal(sumTree(kpis.by_uf).novos, kpis.totals.diff_novos);
  });

  it('routes unlocatable diff CNPJs to a ?? bucket so totals still reconcile', () => {
    const ativosRows = FIXTURE.filter((r) => r.situacao_cadastral === '02');
    const kpis = buildKpiTree({
      month: '2025-01',
      ativosRows,
      entrantes: [],
      baixados: [],
      diffNovosCnpjs: ['99999999000199'], // absent everywhere
      diffBaixadosCnpjs: [],
      resolveCity,
      source: { ativos_csv: 'a', ativo_baixada_csv: 'b', snapshot_prev: null },
    });
    assert.equal(kpis.totals.diff_novos, 1);
    assert.equal(sumTree(kpis.by_uf).novos, 1);
    const unknown = kpis.by_uf.find((n) => n.key === '??');
    assert.ok(unknown);
    assert.equal(unknown.diff_novos, 1);
  });
});
