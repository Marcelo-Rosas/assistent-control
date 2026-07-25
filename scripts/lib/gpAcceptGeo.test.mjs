import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  slug,
  filterAcceptItems,
  resolveAcceptList,
} from './gpAcceptGeo.mjs';

describe('slug', () => {
  it('normalizes accents', () => {
    assert.equal(slug('Cocó'), 'coco');
  });
});

describe('filterAcceptItems', () => {
  const target = { bairro: 'Cocó', cidade: 'Fortaleza', uf: 'CE' };

  it('keeps city+bairro match', () => {
    const out = filterAcceptItems(
      [
        {
          name: 'Keep In Shape',
          cidade: 'Fortaleza',
          uf: 'CE',
          bairro: 'Cocó',
        },
        {
          name: 'Other City',
          cidade: 'Recife',
          uf: 'PE',
          bairro: 'Boa Viagem',
        },
      ],
      target,
    );
    assert.equal(out.length, 1);
    assert.equal(out[0].name, 'Keep In Shape');
  });

  it('includes missing bairro with bairro_unknown', () => {
    const out = filterAcceptItems(
      [{ name: 'City Only', cidade: 'Fortaleza', uf: 'CE', bairro: null }],
      target,
    );
    assert.equal(out.length, 1);
    assert.equal(out[0].bairro_unknown, true);
  });

  it('drops wrong bairro when bairro set', () => {
    const out = filterAcceptItems(
      [
        {
          name: 'Aldeota Gym',
          cidade: 'Fortaleza',
          uf: 'CE',
          bairro: 'Aldeota',
        },
      ],
      target,
    );
    assert.equal(out.length, 0);
  });
});

describe('resolveAcceptList', () => {
  it('returns empty + warning when fixture missing and not required', () => {
    const r = resolveAcceptList({
      fixturePath: '',
      root: process.cwd(),
      targetGeo: { bairro: 'Cocó', cidade: 'Fortaleza', uf: 'CE' },
      requireFixture: false,
    });
    assert.deepEqual(r.accept_list, []);
    assert.ok(r.warnings.some((w) => /GP_ACCEPT_FIXTURE/i.test(w)));
  });

  it('throws when requireFixture and path empty', () => {
    assert.throws(
      () =>
        resolveAcceptList({
          fixturePath: '',
          root: process.cwd(),
          targetGeo: { bairro: 'Cocó', cidade: 'Fortaleza', uf: 'CE' },
          requireFixture: true,
        }),
      /REQUIRE_ACCEPT_FIXTURE/,
    );
  });

  it('loads fixture and filters', () => {
    const dir = join(tmpdir(), `gp-accept-${Date.now()}`);
    mkdirSync(dir, { recursive: true });
    const path = join(dir, 'fix.json');
    writeFileSync(
      path,
      JSON.stringify({
        aggregator: 'gurupass',
        source: {
          url: 'https://www.gurupass.com.br/buscar-academias/',
          method: 'manual_seed',
          fetched_at: '2026-07-25T00:00:00.000Z',
        },
        items: [
          {
            name: 'Seed Gym',
            cidade: 'Fortaleza',
            uf: 'CE',
            bairro: 'Cocó',
            partner_url: null,
          },
        ],
      }),
      'utf8',
    );
    try {
      const r = resolveAcceptList({
        fixturePath: path,
        root: process.cwd(),
        targetGeo: { bairro: 'Cocó', cidade: 'Fortaleza', uf: 'CE' },
        requireFixture: true,
      });
      assert.equal(r.accept_list.length, 1);
      assert.equal(r.accept_list[0].name, 'Seed Gym');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
