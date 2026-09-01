import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  haversineM,
  matchAggregatorLists,
  nameScore,
  type OverlapGym,
} from './aggregatorOverlap.ts';

describe('aggregatorOverlap', () => {
  it('nameScore matches similar names', () => {
    assert.ok(nameScore('Studio R3', 'R3 Studio') >= 0.85);
    assert.equal(nameScore('Foo', 'Bar'), 0);
  });

  it('haversineM is near zero for same point', () => {
    assert.ok(haversineM({ lat: -23.5, lng: -46.6 }, { lat: -23.5, lng: -46.6 }) < 1);
  });

  it('matchAggregatorLists pairs nearby gyms', () => {
    const source: OverlapGym[] = [
      {
        aggregator: 'totalpass',
        id: 'tp1',
        name: 'Studio R3',
        lat: -23.582,
        lng: -46.6847,
        cidade: 'São Paulo',
        uf: 'SP',
        address: '',
      },
    ];
    const target: OverlapGym[] = [
      {
        aggregator: 'wellhub',
        id: 'wh1',
        name: 'Studio R3',
        lat: -23.58201,
        lng: -46.68477,
        cidade: 'São Paulo',
        uf: 'SP',
        address: '',
      },
    ];
    const pairs = matchAggregatorLists(source, target);
    assert.equal(pairs.length, 1);
    assert.ok(pairs[0].dist_m < 20);
  });
});
