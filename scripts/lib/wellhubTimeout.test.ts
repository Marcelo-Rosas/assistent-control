import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  auditVerdict,
  computeCityTimeout,
  missingPct,
  WELLHUB_TIMEOUT_DEFAULTS,
} from './wellhubTimeout.ts';

describe('computeCityTimeout', () => {
  it('heuristic cap (sem catálogo) = 507000ms com defaults', () => {
    const b = computeCityTimeout({ catalog_bairros: null });
    assert.equal(b.bairro_count, WELLHUB_TIMEOUT_DEFAULTS.HEURISTIC_BAIRRO_CAP);
    assert.equal(b.per_bairro_ms, 6500);
    assert.equal(b.geo_ms, 52000);
    assert.equal(b.timeout_ms, 507_000);
    assert.match(b.rule, /heuristic_cap/);
  });

  it('catálogo 38 bairros = timeout proporcional', () => {
    const b = computeCityTimeout({ catalog_bairros: 38 });
    assert.equal(b.bairro_count, 38);
    assert.equal(b.bairros_ms, 38 * 6500);
    assert.equal(b.timeout_ms, Math.max(180_000, 10_000 + 38 * 6500 + 52_000 + 120_000));
  });

  it('floor domina cidades pequenas', () => {
    const b = computeCityTimeout({ catalog_bairros: 1, floor_ms: 600_000 });
    assert.equal(b.timeout_ms, 600_000);
  });
});

describe('auditVerdict', () => {
  it('OK_EXACT quando missing=0', () => {
    const v = auditVerdict({
      baseline_count: 100,
      normal_count: 100,
      normal_missing: 0,
      normal_ok: true,
    });
    assert.equal(v.code, 'OK_EXACT');
    assert.equal(v.missing_pct, 0);
  });

  it('OK_MISSING_LTE_5PCT quando missing ≤5%', () => {
    const v = auditVerdict({
      baseline_count: 100,
      normal_count: 96,
      normal_missing: 4,
      normal_ok: true,
    });
    assert.equal(v.code, 'OK_MISSING_LTE_5PCT');
    assert.equal(v.missing_pct, 4);
  });

  it('LOSS_TIMEOUT quando error timeout', () => {
    const v = auditVerdict({
      baseline_count: 511,
      normal_count: 0,
      normal_missing: 511,
      normal_error: 'timeout 180000ms: Fortaleza-CE',
      normal_ok: false,
    });
    assert.equal(v.code, 'LOSS_TIMEOUT');
  });

  it('WARN_DIVERGE quando missing >10%', () => {
    const v = auditVerdict({
      baseline_count: 100,
      normal_count: 80,
      normal_missing: 20,
      normal_ok: true,
    });
    assert.equal(v.code, 'WARN_DIVERGE');
    assert.equal(missingPct(100, 20), 20);
  });
});
