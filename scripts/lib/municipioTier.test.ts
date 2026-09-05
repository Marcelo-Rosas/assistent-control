import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  classifyMunicipioTier,
  isTierAtLeast,
} from './municipioTier.ts';

describe('municipioTier', () => {
  it('classifyMunicipioTier boundaries', () => {
    assert.equal(classifyMunicipioTier(499_999), 'T3');
    assert.equal(classifyMunicipioTier(500_000), 'T4');
    assert.equal(classifyMunicipioTier(100_000), 'T3');
    assert.equal(classifyMunicipioTier(99_999), 'T2');
    assert.equal(classifyMunicipioTier(50_000), 'T2');
    assert.equal(classifyMunicipioTier(49_999), 'T1');
    assert.equal(classifyMunicipioTier(null), null);
    assert.equal(classifyMunicipioTier(undefined), null);
  });

  it('isTierAtLeast T3+', () => {
    assert.equal(isTierAtLeast('T4', 'T3'), true);
    assert.equal(isTierAtLeast('T3', 'T3'), true);
    assert.equal(isTierAtLeast('T2', 'T3'), false);
    assert.equal(isTierAtLeast(null, 'T3'), false);
  });
});
