import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { pickBairroFromNominatimAddress } from './tpBairroResolver.ts';

describe('tpBairroResolver', () => {
  it('pickBairroFromNominatimAddress prioriza suburb', () => {
    assert.equal(
      pickBairroFromNominatimAddress({
        quarter: 'Vila Alto da Boa Esperança',
        suburb: 'IAPI',
        city: 'Salvador',
      }),
      'IAPI',
    );
  });

  it('pickBairroFromNominatimAddress fallback quarter', () => {
    assert.equal(
      pickBairroFromNominatimAddress({ quarter: 'Farroupilha', city: 'Porto Alegre' }),
      'Farroupilha',
    );
  });
});
