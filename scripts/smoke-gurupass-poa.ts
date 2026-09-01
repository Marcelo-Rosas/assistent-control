/**
 * Smoke CLA-14: valida schema GuruPass vs fixture POA (13 academias).
 *
 * Run: npm run smoke:gurupass-poa
 */
import fs from 'fs/promises';
import path from 'path';
import {
  extractGuruPassDetailSchema,
  listGymsByCitySlug,
  mergeGymWithDetail,
  normalizeCompareText,
  normalizeGymFromList,
  slugifyCity,
  type GuruPassGymNormalized,
  type GuruPassSearchResponse,
} from './lib/gurupassDetailSchema.ts';

const FIXTURE_DIR = path.join(process.cwd(), 'data/fixtures/gurupass');
const CONSOLIDATED_PATH = path.join(FIXTURE_DIR, 'porto-alegre-consolidated.json');
const SEARCH_FIXTURE_PATH = path.join(FIXTURE_DIR, 'search-porto-alegre-p1.json');
const HTML_FIXTURE_PATH = path.join(FIXTURE_DIR, 'team-souza-fight.html');

type Consolidated = {
  total_academias: number;
  citySlug: string;
  academias: GuruPassGymNormalized[];
};

function planosForCompare(planos: GuruPassGymNormalized['produtos_planos']) {
  return planos.map((p) => ({
    ...p,
    horario: normalizeCompareText(p.horario),
    nome: normalizeCompareText(p.nome),
  }));
}
function pickComparable(g: GuruPassGymNormalized) {
  return {
    id: g.id,
    slug: g.slug,
    nome: g.nome,
    endereco: g.endereco,
    bairro: normalizeCompareText(g.bairro),
    produtos_planos: planosForCompare(g.produtos_planos),
    menor_preco: g.menor_preco,
    fotos: g.fotos,
    // status_funcionamento varia com horário — omitido do smoke offline
  };
}

async function main(): Promise<void> {
  console.log('Smoke GuruPass POA (CLA-14)\n');

  const slugOk = slugifyCity('Porto Alegre') === 'porto-alegre';
  console.log(`slugifyCity: ${slugOk ? 'OK' : 'FAIL'}`);
  if (!slugOk) process.exit(1);

  const searchRaw = JSON.parse(await fs.readFile(SEARCH_FIXTURE_PATH, 'utf-8')) as GuruPassSearchResponse;
  const fromFixture = (searchRaw.data ?? []).map(normalizeGymFromList);
  console.log(`search fixture: ${fromFixture.length} gyms, total=${searchRaw.total}`);

  const consolidated = JSON.parse(await fs.readFile(CONSOLIDATED_PATH, 'utf-8')) as Consolidated;
  const bySlug = new Map(consolidated.academias.map((g) => [g.slug, g]));

  let mismatches = 0;
  for (const gym of fromFixture) {
    const expected = bySlug.get(gym.slug ?? '');
    if (!expected) {
      console.log(`  MISSING in consolidated: ${gym.slug}`);
      mismatches += 1;
      continue;
    }
    const a = JSON.stringify(pickComparable(gym));
    const b = JSON.stringify(pickComparable(expected));
    if (a !== b) {
      console.log(`  MISMATCH list-only ${gym.slug}`);
      mismatches += 1;
    }
  }
  console.log(`list normalize vs consolidated: ${mismatches === 0 ? 'OK' : `${mismatches} mismatches`}`);

  const html = await fs.readFile(HTML_FIXTURE_PATH, 'utf-8');
  const detail = extractGuruPassDetailSchema(html, 'https://www.gurupass.com.br/detalhes-da-academia/team-souza-fight/');
  if (!detail) {
    console.log('detail extract: FAIL (establishment not found)');
    process.exit(1);
  }
  console.log(`detail extract: OK (${detail.produtos_planos.length} planos)`);
  console.log(`comodidades: ${detail.comodidades === null ? 'null (esperado)' : 'unexpected'}`);

  const listGym = fromFixture.find((g) => g.slug === 'team-souza-fight');
  if (listGym && detail) {
    const merged = mergeGymWithDetail(listGym, detail);
    const expected = bySlug.get('team-souza-fight');
    if (expected && JSON.stringify(pickComparable(merged)) === JSON.stringify(pickComparable(expected))) {
      console.log('merge list+detail team-souza-fight: OK');
    } else {
      console.log('merge list+detail team-souza-fight: MISMATCH');
      mismatches += 1;
    }
  }

  if (process.env.LIVE === '1') {
    const live = await listGymsByCitySlug('porto-alegre');
    console.log(`\nLIVE API: total=${live.total} gyms=${live.gyms.length} pages=${live.totalPages}`);
    if (live.total !== consolidated.total_academias) {
      console.log(`  WARN total API ${live.total} != fixture ${consolidated.total_academias}`);
    }
  } else {
    console.log('\n(LIVE=1 para bater na API ao vivo)');
  }

  if (mismatches > 0) process.exit(1);
  console.log('\nSmoke OK');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
