import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  normalizeBairroSlug,
  patchGpBairroMeta,
  resolveBairroLabel,
} from './gpBairroMeta.ts';

describe('gpBairroMeta', () => {
  it('normalizeBairroSlug matches jarvis kebab (Paraíso → paraiso)', () => {
    assert.equal(normalizeBairroSlug('Paraíso'), 'paraiso');
    assert.equal(normalizeBairroSlug('Bela Vista'), 'bela-vista');
    assert.equal(normalizeBairroSlug('SÉ / Centro'), 'se-centro');
  });

  it('patchGpBairroMeta sets bairro_normalizado from bairro', () => {
    const out = patchGpBairroMeta({
      bairro: 'Bela Vista',
      cidade: 'São Paulo',
      gym_id: 'x',
    });
    assert.ok(out);
    assert.equal(out!.bairro_normalizado, 'bela-vista');
    assert.equal(out!.cidade, 'São Paulo');
  });

  it('patchGpBairroMeta no-op when already correct', () => {
    const out = patchGpBairroMeta({
      bairro: 'Moema',
      bairro_normalizado: 'moema',
      cidade: 'São Paulo',
    });
    assert.equal(out, null);
  });

  it('resolveBairroLabel accepts neighborhood object', () => {
    assert.equal(resolveBairroLabel({ neighborhood: { name: 'Pinheiros' } }), 'Pinheiros');
  });

  it('patchGpBairroMeta returns null without bairro', () => {
    assert.equal(patchGpBairroMeta({ cidade: 'São Paulo' }), null);
  });
});
