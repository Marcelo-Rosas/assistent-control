import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import fs from 'fs';
import path from 'path';
import {
  applyTagRules,
  dedupeWellnessRows,
  enrichWellnessRow,
  loadWellnessConfig,
  pickWinningHit,
  findSegmentHits,
  segmentGroupFor,
} from './receitaWellnessFilter.ts';

const FIXTURE = JSON.parse(
  fs.readFileSync(
    path.join(process.cwd(), 'data/fixtures/receita-wellness-vivedouro.json'),
    'utf8',
  ),
) as {
  expected: {
    cnae_segment: string;
    cnae_tags_includes: string[];
  };
  record: Record<string, unknown>;
};

describe('receitaWellnessFilter', () => {
  const config = loadWellnessConfig();

  it('Vivedouro fixture → clinica_ne + tag geriatria', () => {
    const row = FIXTURE.record as Parameters<typeof enrichWellnessRow>[0];
    const enriched = enrichWellnessRow(row, config);
    assert.ok(enriched);
    assert.equal(enriched!.cnae_segment, FIXTURE.expected.cnae_segment);
    assert.equal(enriched!.cnae_fiscal_matched, '8630599');
    assert.equal(enriched!.cnae_match, 'principal');
    for (const tag of FIXTURE.expected.cnae_tags_includes) {
      assert.ok(enriched!.cnae_tags.includes(tag), `missing tag ${tag}`);
    }
    assert.equal(segmentGroupFor(enriched!.cnae_segment, config), 'clinica');
  });

  it('dedup prefers principal esportes over secundario academia', () => {
    const row = {
      cnpj: '99999999000199',
      nome_fantasia: 'Luta Fit',
      cnae_fiscal_principal: '8591100',
      cnae_fiscal_secundaria: '9313100',
      situacao_cadastral: '02',
    };
    const enriched = enrichWellnessRow(row, config);
    assert.equal(enriched?.cnae_segment, 'esportes');
    assert.equal(enriched?.cnae_match, 'principal');
  });

  it('pilates tag on nome_fantasia', () => {
    const row = {
      cnpj: '88888888000188',
      nome_fantasia: 'Studio Pilates Centro',
      cnae_fiscal_principal: '9313100',
      cnae_fiscal_secundaria: null,
    };
    const tags = applyTagRules(row, config.tags ?? []);
    assert.ok(tags.includes('pilates'));
  });

  it('dedupeWellnessRows keeps one row per cnpj (duplicate union rows)', () => {
    const rows = [
      {
        cnpj: '11111111000111',
        cnae_fiscal_principal: '9313100',
        situacao_cadastral: '02',
      },
      {
        cnpj: '11111111000111',
        cnae_fiscal_principal: '9313100',
        situacao_cadastral: '02',
      },
    ];
    const out = dedupeWellnessRows(rows, config);
    assert.equal(out.length, 1);
    assert.equal(out[0].cnae_segment, 'academia');
  });

  it('pickWinningHit respects segment order on secundario tie', () => {
    const row = {
      cnpj: '77777777000177',
      cnae_fiscal_principal: '9999999',
      cnae_fiscal_secundaria: '9313100,8591100',
    };
    const hits = findSegmentHits(row, config.segments);
    const winner = pickWinningHit(hits);
    assert.equal(winner?.segment.id, 'academia');
  });
});
