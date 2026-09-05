import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  amenityCanonicalName,
  extractTotalPassDetailSchema,
  normalizeTpLabel,
  pickDisplayName,
  remapAmenityLikeModalities,
} from './totalpassDetailSchema.ts';

describe('totalpassDetailSchema remap/normalize', () => {
  it('normalizeTpLabel trim e colapsa whitespace', () => {
    assert.equal(normalizeTpLabel('  Zumba'), 'Zumba');
    assert.equal(normalizeTpLabel('Pilates   Solo'), 'Pilates Solo');
    assert.equal(normalizeTpLabel(' Taekwondo '), 'Taekwondo');
  });

  it('move Área Infantil (variantes) de modalidades para comodidades como Espaço Kids', () => {
    const r = remapAmenityLikeModalities(
      ['Área Infantil', 'Area Infantil', 'Área infantil supervisada', 'Pilates', ' Musculação'],
      ['Armários', 'Wi-fi'],
    );
    assert.deepEqual(r.modalidades, ['Pilates', 'Musculação']);
    assert.deepEqual(r.comodidades, ['Armários', 'Wi-fi', 'Espaço Kids']);
    assert.equal(amenityCanonicalName('Área Infantil'), 'Espaço Kids');
    assert.equal(amenityCanonicalName('Área infantil supervisada'), 'Espaço Kids');
    assert.equal(amenityCanonicalName('Espaço Kids'), 'Espaço Kids');
  });

  it('colapsa Área Infantil e Espaço Kids em uma única comodidade', () => {
    const r = remapAmenityLikeModalities(['Área infantil supervisada', 'Zumba'], [
      'Espaço Kids',
      'Área Infantil',
    ]);
    assert.deepEqual(r.modalidades, ['Zumba']);
    assert.deepEqual(r.comodidades, ['Espaço Kids']);
    assert.equal(r.comodidades.filter((c) => c === 'Espaço Kids').length, 1);
    assert.ok(!r.comodidades.includes('Área Infantil'));
  });

  it('não remapeia esporte (Pilates)', () => {
    assert.equal(amenityCanonicalName('Pilates'), null);
    assert.equal(amenityCanonicalName('Bola Pilates'), null);
    assert.equal(amenityCanonicalName('Zumba'), null);
    assert.equal(amenityCanonicalName('Musculação'), null);
    const r = remapAmenityLikeModalities(['Pilates', 'Zumba'], ['Bebedouro']);
    assert.deepEqual(r.modalidades, ['Pilates', 'Zumba']);
    assert.deepEqual(r.comodidades, ['Bebedouro']);
  });

  it('pickDisplayName descarta slug snake_case se houver translated_name', () => {
    assert.equal(pickDisplayName('kids_ballet', 'Ballet Kids'), 'Ballet Kids');
    assert.equal(pickDisplayName('pilates', 'Pilates'), 'Pilates');
    assert.equal(pickDisplayName('jiu_jitsu_kids', 'jiu_jitsu_kids'), 'jiu_jitsu_kids');
  });

  it('extractTotalPassDetailSchema aplica remap e normalize', () => {
    const html =
      '\\"modalities\\":[{\\"id\\":\\"1\\",\\"name\\":\\"kids_area\\",\\"translated_name\\":\\"Área infantil supervisada\\"},{\\"id\\":\\"106\\",\\"name\\":\\"pilates\\",\\"translated_name\\":\\" Pilates\\"}]}' +
      '\\"structures\\":[\\"Armários\\",\\"Wi-fi\\"]';
    const schema = extractTotalPassDetailSchema(html, 'https://totalpass.com/br/academias/x/');
    assert.deepEqual(schema.modalidades, ['Pilates']);
    assert.ok(!schema.modalidades.includes('Área infantil supervisada'));
    assert.deepEqual(schema.comodidades, ['Armários', 'Wi-fi', 'Espaço Kids']);
  });
});
