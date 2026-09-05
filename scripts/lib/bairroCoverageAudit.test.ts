import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildMissingBairrosT3Plus,
  buildMunicipioCoverageRows,
  isCepBairroSource,
  summarizeReport,
} from './bairroCoverageAudit.ts';

describe('bairroCoverageAudit pós-CEP', () => {
  it('isCepBairroSource reconhece fontes CEP', () => {
    assert.equal(isCepBairroSource('receita_cep'), true);
    assert.equal(isCepBairroSource('cep_municipio'), true);
    assert.equal(isCepBairroSource('nominatim'), false);
    assert.equal(isCepBairroSource('cache'), false);
  });

  it('TP usa índice CEP e reporta missing_bairros T3+', () => {
    const rows = buildMunicipioCoverageRows({
      municipios: [
        { nome: 'Campinas', uf: 'SP', ibge: '3509502', populacao: 1_200_000 },
      ],
      filterUf: null,
      catalogs: new Map(),
      receitaByIbge: new Map([
        ['3509502', new Set(['centro', 'cambui', 'barra-funda'])],
      ]),
      whGyms: [],
      tpGyms: [
        {
          id: 'tp-1',
          attributes: {
            full_address: 'Rua X, 10',
            uf: 'SP',
            municipios_busca: ['Campinas'],
          },
        },
        {
          id: 'tp-2',
          attributes: {
            full_address: 'Rua Y, 20',
            uf: 'SP',
            municipios_busca: ['Campinas'],
          },
        },
      ],
      gpGyms: [],
      tpBairroByGymId: {
        'tp-1': { bairro: 'Centro', bairro_slug: 'centro', source: 'receita_cep', cep: '13010000' },
        'tp-2': { bairro: 'Cambuí', bairro_slug: 'cambui', source: 'nominatim' },
      },
    });

    assert.equal(rows.length, 1);
    const row = rows[0]!;
    assert.equal(row.tier, 'T4');
    assert.equal(row.totalpass.gym_count, 2);
    assert.equal(row.totalpass.parseable_count, 2);
    assert.equal(row.totalpass.index_hit_count, 2);
    assert.equal(row.totalpass.cep_hit_count, 1);
    assert.ok(row.totalpass.coverage_pct != null);
    assert.ok(row.totalpass.missing_bairros.some((b) => /barra/i.test(b) || b.includes('barra')));

    const report = summarizeReport(rows, null, {
      total: 100,
      resolved: 98,
      resolved_cep: 40,
      failed: 2,
      provider: 'cep',
      resolved_pct: 98,
      resolved_cep_pct: 40,
    });
    assert.equal(report.baseline_2026_09_02?.avg_tp_coverage_pct, 35.6);
    assert.ok((report.summary.honesty_notes?.length ?? 0) >= 1);
    assert.equal(report.summary.tp_index?.resolved_cep, 40);
    assert.ok(report.missing_bairros_t3_plus.length >= 1);
    assert.equal(buildMissingBairrosT3Plus(rows)[0]?.cidade, 'Campinas');
  });
});
