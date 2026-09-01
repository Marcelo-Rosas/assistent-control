import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { describe, it } from 'node:test';
import {
  extractEstablishment,
  extractGuruPassDetailSchema,
  mapProductsToPlanos,
  mergeGymWithDetail,
  normalizeCompareText,
  normalizeGymFromList,
  slugifyCity,
  type GuruPassGymNormalized,
  type GuruPassSearchResponse,
} from './gurupassDetailSchema.ts';

const FIXTURE_DIR = path.join(process.cwd(), 'data/fixtures/gurupass');

function planosForCompare(planos: GuruPassGymNormalized['produtos_planos']) {
  return planos.map((p) => ({
    ...p,
    horario: normalizeCompareText(p.horario),
    nome: normalizeCompareText(p.nome),
  }));
}

describe('gurupassDetailSchema', () => {
  it('slugifyCity normaliza acentos e espaços', () => {
    assert.equal(slugifyCity('Porto Alegre'), 'porto-alegre');
    assert.equal(slugifyCity('São José dos Campos'), 'sao-jose-dos-campos');
    assert.equal(slugifyCity('  Rio de Janeiro '), 'rio-de-janeiro');
  });

  it('mapProductsToPlanos mapeia cost_credits/cost_cents', () => {
    const planos = mapProductsToPlanos([
      {
        name: 'Musculação',
        description: '2ª á 6ª: 6h-22h',
        cost_credits: 20,
        cost_cents: 1000,
      },
    ]);
    assert.deepEqual(planos, [
      { nome: 'Musculação', horario: '2ª á 6ª: 6h-22h', creditos: 20, preco_centavos: 1000 },
    ]);
  });

  it('normalizeGymFromList bate com fixture POA (13 academias)', async () => {
    const search = JSON.parse(
      await fs.readFile(path.join(FIXTURE_DIR, 'search-porto-alegre-p1.json'), 'utf-8'),
    ) as GuruPassSearchResponse;
    const consolidated = JSON.parse(
      await fs.readFile(path.join(FIXTURE_DIR, 'porto-alegre-consolidated.json'), 'utf-8'),
    ) as { academias: GuruPassGymNormalized[]; total: number };

    assert.equal(search.total, 13);
    assert.equal(search.data?.length, 13);

    const bySlug = new Map(consolidated.academias.map((g) => [g.slug, g]));
    for (const raw of search.data ?? []) {
      const norm = normalizeGymFromList(raw);
      const expected = bySlug.get(norm.slug ?? '');
      assert.ok(expected, `missing expected for ${norm.slug}`);
      assert.equal(norm.id, expected.id);
      assert.equal(norm.nome, expected.nome);
      assert.equal(norm.endereco, expected.endereco);
      assert.equal(normalizeCompareText(norm.bairro), normalizeCompareText(expected.bairro));
      assert.deepEqual(planosForCompare(norm.produtos_planos), planosForCompare(expected.produtos_planos));
      assert.deepEqual(norm.fotos, expected.fotos);
      assert.deepEqual(norm.menor_preco, expected.menor_preco);
    }
  });

  it('extractEstablishment lê payload real team-souza-fight.html', async () => {
    const html = await fs.readFile(path.join(FIXTURE_DIR, 'team-souza-fight.html'), 'utf-8');
    const est = extractEstablishment(html);
    assert.ok(est);
    assert.equal(est.slug, 'team-souza-fight');
    assert.equal(est.name, 'Team Souza Fight');
    assert.ok(Array.isArray(est.products) && est.products.length >= 4);
  });

  it('extractGuruPassDetailSchema não expõe comodidades', async () => {
    const html = await fs.readFile(path.join(FIXTURE_DIR, 'team-souza-fight.html'), 'utf-8');
    const schema = extractGuruPassDetailSchema(
      html,
      'https://www.gurupass.com.br/detalhes-da-academia/team-souza-fight/',
    );
    assert.ok(schema);
    assert.equal(schema.comodidades, null);
    assert.equal(schema.academia, 'Team Souza Fight');
    assert.equal(schema.produtos_planos.length, 4);
    assert.equal(schema.produtos_planos[0]?.nome, 'Aula de Muay Thai');
    assert.equal(schema.produtos_planos[0]?.creditos, 70);
    assert.equal(schema.produtos_planos[0]?.preco_centavos, 3500);
  });

  it('mergeGymWithDetail enriquece team-souza-fight como consolidated', async () => {
    const search = JSON.parse(
      await fs.readFile(path.join(FIXTURE_DIR, 'search-porto-alegre-p1.json'), 'utf-8'),
    ) as GuruPassSearchResponse;
    const html = await fs.readFile(path.join(FIXTURE_DIR, 'team-souza-fight.html'), 'utf-8');
    const consolidated = JSON.parse(
      await fs.readFile(path.join(FIXTURE_DIR, 'porto-alegre-consolidated.json'), 'utf-8'),
    ) as { academias: GuruPassGymNormalized[] };

    const raw = search.data?.find((g) => g.slug === 'team-souza-fight');
    assert.ok(raw);
    const list = normalizeGymFromList(raw);
    const detail = extractGuruPassDetailSchema(
      html,
      'https://www.gurupass.com.br/detalhes-da-academia/team-souza-fight/',
    );
    assert.ok(detail);
    const merged = mergeGymWithDetail(list, detail);
    const expected = consolidated.academias.find((g) => g.slug === 'team-souza-fight');
    assert.ok(expected);

    assert.equal(merged.id, expected.id);
    assert.equal(merged.descricao, expected.descricao);
    assert.deepEqual(planosForCompare(merged.produtos_planos), planosForCompare(expected.produtos_planos));
    assert.equal(typeof merged.status_funcionamento?.open, 'boolean');
    assert.deepEqual(merged.fotos, expected.fotos);
  });

  it('listSearchRawByCitySlug pagina fixture POA (1 página)', async () => {
    const search = JSON.parse(
      await fs.readFile(path.join(FIXTURE_DIR, 'search-porto-alegre-p1.json'), 'utf-8'),
    ) as GuruPassSearchResponse;
    assert.equal(search.total, 13);
    assert.equal(search.totalPages, 1);
    assert.equal(search.data?.length, 13);
  });

  it('buildSearchUrl monta citySlug sem lat/lng', async () => {
    const { buildSearchUrl } = await import('./gurupassDetailSchema.ts');
    const url = buildSearchUrl('porto-alegre', 1, 200);
    assert.match(url, /citySlug=porto-alegre/);
    assert.match(url, /limit=200/);
    assert.doesNotMatch(url, /latitude|longitude/);
  });
});
