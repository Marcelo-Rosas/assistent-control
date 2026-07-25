import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  slug,
  parseCreditsFromPlan,
  parseBairroFromEndereco,
  normalizeAcceptDoc,
  filterAcceptItems,
  filterByUserPlan,
  resolveAcceptList,
} from './gpAcceptGeo.mjs';

describe('slug', () => {
  it('normalizes accents', () => {
    assert.equal(slug('Cocó'), 'coco');
  });
});

describe('parseCreditsFromPlan', () => {
  it('parses Ilimitado N', () => {
    assert.equal(parseCreditsFromPlan('Ilimitado 70'), 70);
    assert.equal(parseCreditsFromPlan('Ilimitado 15'), 15);
  });
});

describe('parseBairroFromEndereco', () => {
  it('parses comma Fortaleza', () => {
    assert.equal(
      parseBairroFromEndereco(
        'Rua Ildefonso Albano 1392, Meireles, Fortaleza',
      ),
      'Meireles',
    );
  });
  it('parses dash Fortaleza', () => {
    assert.equal(
      parseBairroFromEndereco(
        'Avenida Padre Antônio Tomás, Aldeota - Fortaleza',
      ),
      'Aldeota',
    );
  });
});

describe('normalizeAcceptDoc', () => {
  it('accepts academias[] page export', () => {
    const doc = normalizeAcceptDoc({
      cidade: 'Fortaleza, CE',
      academias: [
        {
          nome: 'Healthy Academia',
          endereco: 'Rua X, Demócrito Rocha - Fortaleza',
          plano_minimo: 'Ilimitado 15',
          valor_mensal_brl: 74.25,
          modalidades: ['Musculação'],
        },
      ],
    });
    assert.equal(doc.items.length, 1);
    assert.equal(doc.items[0].name, 'Healthy Academia');
    assert.equal(doc.items[0].creditos_minimos, 15);
    assert.equal(doc.items[0].bairro, 'Demócrito Rocha');
  });
});

describe('filterAcceptItems', () => {
  const items = [
    {
      name: 'Keep In Shape',
      cidade: 'Fortaleza',
      uf: 'CE',
      bairro: 'Cocó',
      plano_minimo: 'Ilimitado 20',
      creditos_minimos: 20,
    },
    {
      name: 'vs club',
      cidade: 'Fortaleza',
      uf: 'CE',
      bairro: 'Aldeota',
      plano_minimo: 'Ilimitado 35',
      creditos_minimos: 35,
    },
    {
      name: 'Other City',
      cidade: 'Recife',
      uf: 'PE',
      bairro: 'Boa Viagem',
      plano_minimo: 'Ilimitado 10',
      creditos_minimos: 10,
    },
  ];

  it('city-wide when bairro empty', () => {
    const out = filterAcceptItems(items, {
      bairro: '',
      cidade: 'Fortaleza',
      uf: 'CE',
    });
    assert.equal(out.length, 2);
  });

  it('keeps city+bairro match', () => {
    const out = filterAcceptItems(items, {
      bairro: 'Cocó',
      cidade: 'Fortaleza',
      uf: 'CE',
    });
    assert.equal(out.length, 1);
    assert.equal(out[0].name, 'Keep In Shape');
  });

  it('drops wrong bairro when bairro set', () => {
    const out = filterAcceptItems(items, {
      bairro: 'Cocó',
      cidade: 'Fortaleza',
      uf: 'CE',
    });
    assert.ok(!out.some((i) => i.name === 'vs club'));
  });
});

describe('filterByUserPlan', () => {
  const gyms = [
    { name: 'A', plano_minimo: 'Ilimitado 70', creditos_minimos: 70 },
    { name: 'B', plano_minimo: 'Ilimitado 15', creditos_minimos: 15 },
    { name: 'C', plano_minimo: 'Ilimitado 35', creditos_minimos: 35 },
  ];

  it('keeps gyms where min credits ≤ user', () => {
    const out = filterByUserPlan(gyms, 35);
    assert.deepEqual(
      out.map((i) => i.name).sort(),
      ['B', 'C'],
    );
  });

  it('no filter when userCredits null', () => {
    assert.equal(filterByUserPlan(gyms, null).length, 3);
  });
});

describe('resolveAcceptList', () => {
  it('returns empty + warning when fixture missing and not required', () => {
    const r = resolveAcceptList({
      fixturePath: '',
      root: process.cwd(),
      targetGeo: { bairro: '', cidade: 'Fortaleza', uf: 'CE' },
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
          targetGeo: { bairro: '', cidade: 'Fortaleza', uf: 'CE' },
          requireFixture: true,
        }),
      /REQUIRE_ACCEPT_FIXTURE/,
    );
  });

  it('loads page export and filters by user plan', () => {
    const dir = join(tmpdir(), `gp-accept-${Date.now()}`);
    mkdirSync(dir, { recursive: true });
    const path = join(dir, 'fx.json');
    writeFileSync(
      path,
      JSON.stringify({
        cidade: 'Fortaleza, CE',
        academias: [
          {
            nome: 'Healthy Academia',
            endereco: 'Rua X, Demócrito Rocha - Fortaleza',
            plano_minimo: 'Ilimitado 15',
            valor_mensal_brl: 74.25,
          },
          {
            nome: 'Crossfit Aldeota',
            endereco: 'Rua Y, Meireles, Fortaleza',
            plano_minimo: 'Ilimitado 70',
            valor_mensal_brl: 346.5,
          },
        ],
      }),
      'utf8',
    );
    try {
      const r = resolveAcceptList({
        fixturePath: path,
        root: process.cwd(),
        targetGeo: { bairro: '', cidade: 'Fortaleza', uf: 'CE' },
        requireFixture: true,
        userCredits: 35,
      });
      assert.equal(r.accept_list.length, 1);
      assert.equal(r.accept_list[0].name, 'Healthy Academia');
      assert.equal(r.catalog.plans.length, 2);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
