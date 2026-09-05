import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  patchTpBairroFromIndex,
  resolveGymIdFromMeta,
} from './tpBairroMeta.ts';

describe('tpBairroMeta', () => {
  it('resolveGymIdFromMeta prefers meta.gym_id', () => {
    assert.equal(
      resolveGymIdFromMeta({ gym_id: 'abc-123' }, 'other'),
      'abc-123',
    );
  });

  it('patchTpBairroFromIndex sets slug kebab from index', () => {
    const out = patchTpBairroFromIndex(
      { gym_id: 'x', cidade: 'São Paulo', bairro_normalizado: null },
      { bairro: 'Pinheiros', bairro_slug: 'pinheiros' },
    );
    assert.ok(out);
    assert.equal(out!.bairro_normalizado, 'pinheiros');
    assert.equal(out!.bairro, 'Pinheiros');
  });

  it('patchTpBairroFromIndex does not overwrite existing bn', () => {
    const out = patchTpBairroFromIndex(
      { bairro_normalizado: 'moema', bairro: 'Moema' },
      { bairro: 'Pinheiros', bairro_slug: 'pinheiros' },
    );
    assert.equal(out, null);
  });
});
