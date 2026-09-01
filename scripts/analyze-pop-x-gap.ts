/**
 * Ranking pop × gap de agregadores (universo: WH failed / sem academias).
 * score = populacao * gapAgg  (gapAgg = 3 - #agregadores com ≥1 gym)
 *
 * Run: npx tsx scripts/analyze-pop-x-gap.ts
 */
import fs from 'fs';
import path from 'path';

const ROOT = process.cwd();

function fold(s: string): string {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

const REGION_BY_UF: Record<string, string> = {
  AC: 'N', AM: 'N', AP: 'N', PA: 'N', RO: 'N', RR: 'N', TO: 'N',
  AL: 'NE', BA: 'NE', CE: 'NE', MA: 'NE', PB: 'NE', PE: 'NE', PI: 'NE', RN: 'NE', SE: 'NE',
  DF: 'CO', GO: 'CO', MT: 'CO', MS: 'CO',
  ES: 'SE', MG: 'SE', RJ: 'SE', SP: 'SE',
  PR: 'S', RS: 'S', SC: 'S',
};

type Row = {
  cidade: string;
  uf: string;
  region: string;
  pop: number;
  wh: number;
  tp: number;
  gp: number;
  gapAgg: number;
  totalGyms: number;
  score: number;
  pattern: string;
};

function parseKey(key: string): { nome: string; uf: string } {
  const i = key.lastIndexOf('-');
  return { nome: key.slice(0, i), uf: key.slice(i + 1).toUpperCase() };
}

function main(): void {
  const progress = JSON.parse(
    fs.readFileSync(path.join(ROOT, 'data/processed/wellhub-progress.json'), 'utf-8'),
  );
  const munis: Array<{ nome: string; uf: string; populacao?: number }> = JSON.parse(
    fs.readFileSync(path.join(ROOT, 'data/municipios-brasil.json'), 'utf-8'),
  );
  const tp = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/raw/totalpass-brasil-all.json'), 'utf-8'));
  const gp = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/raw/gurupass-brasil-all.json'), 'utf-8'));

  const munByKey = new Map(munis.map((m) => [`${fold(m.nome)}|${m.uf}`, m]));

  const tpIndex = new Map<string, number>();
  for (const item of tp.data || []) {
    const a = item.attributes || {};
    const uf = String(a.uf || '').toUpperCase();
    const bags = new Set(
      [...(a.municipios_busca || []), ...(a.municipios_relacionados || [])].map(fold),
    );
    for (const city of bags) {
      const k = `${city}|${uf}`;
      tpIndex.set(k, (tpIndex.get(k) || 0) + 1);
    }
  }

  const gpIndex = new Map<string, number>();
  for (const g of gp.data || []) {
    const uf = String(g.uf || '').toUpperCase();
    const city = fold(g.city || '');
    if (!city || !uf) continue;
    const k = `${city}|${uf}`;
    gpIndex.set(k, (gpIndex.get(k) || 0) + 1);
  }

  const rows: Row[] = [];
  for (const f of progress.failed || []) {
    const { nome, uf } = parseKey(f.key);
    const ibge = munByKey.get(`${fold(nome)}|${uf}`);
    const pop = ibge?.populacao || 0;
    if (!pop) continue;
    const k = `${fold(nome)}|${uf}`;
    const tpN = tpIndex.get(k) || 0;
    const gpN = gpIndex.get(k) || 0;
    const whN = 0;
    const present = (whN > 0 ? 1 : 0) + (tpN > 0 ? 1 : 0) + (gpN > 0 ? 1 : 0);
    const gapAgg = 3 - present;
    const totalGyms = whN + tpN + gpN;
    const score = pop * gapAgg;
    let pattern = 'cheio';
    if (gapAgg === 3) pattern = 'DESERTO';
    else if (gapAgg === 2 && tpN > 0) pattern = 'só TP';
    else if (gapAgg === 2 && gpN > 0) pattern = 'só GP';
    else if (gapAgg === 2) pattern = 'só WH';
    else if (gapAgg === 1) pattern = '1 faltando';

    rows.push({
      cidade: ibge?.nome || nome,
      uf,
      region: REGION_BY_UF[uf] || '?',
      pop,
      wh: whN,
      tp: tpN,
      gp: gpN,
      gapAgg,
      totalGyms,
      score,
      pattern,
    });
  }

  rows.sort((a, b) => b.score - a.score || b.pop - a.pop);

  console.log(`WH failed c/ pop: ${rows.length}`);
  console.log(`DESERTO: ${rows.filter((r) => r.pattern === 'DESERTO').length}`);
  console.log(`só TP: ${rows.filter((r) => r.pattern === 'só TP').length}`);

  console.log('\n=== TOP 25 pop × gapAgg ===');
  console.log(['#', 'reg', 'cidade', 'UF', 'pop', 'TP', 'GP', 'gap', 'padrão', 'score'].join('\t'));
  rows.slice(0, 25).forEach((r, i) => {
    console.log(
      [i + 1, r.region, r.cidade, r.uf, r.pop, r.tp, r.gp, r.gapAgg, r.pattern, r.score].join('\t'),
    );
  });

  const desert = rows.filter((r) => r.pattern === 'DESERTO').sort((a, b) => b.pop - a.pop);
  console.log('\n=== TOP 15 DESERTO por pop ===');
  desert.slice(0, 15).forEach((r, i) => {
    console.log([i + 1, r.region, r.cidade, r.uf, r.pop, `score=${r.score}`].join('\t'));
  });

  const soTp = rows.filter((r) => r.pattern === 'só TP').sort((a, b) => b.score - a.score);
  console.log('\n=== TOP 15 só TP por pop×gap ===');
  soTp.slice(0, 15).forEach((r, i) => {
    console.log(
      [i + 1, r.region, r.cidade, r.uf, r.pop, `TP=${r.tp}`, `score=${r.score}`].join('\t'),
    );
  });

  const buckets: Array<[number, number, string]> = [
    [100000, Infinity, '100k+'],
    [50000, 99999, '50-99k'],
    [30000, 49999, '30-49k'],
    [15000, 29999, '15-29k'],
    [0, 14999, '<15k'],
  ];
  console.log('\n=== Buckets (WH-failed) ===');
  for (const [lo, hi, label] of buckets) {
    const sub = rows.filter((r) => r.pop >= lo && r.pop <= hi);
    const d = sub.filter((r) => r.pattern === 'DESERTO').length;
    const tpOnly = sub.filter((r) => r.pattern === 'só TP').length;
    const popDesert = sub
      .filter((r) => r.pattern === 'DESERTO')
      .reduce((s, r) => s + r.pop, 0);
    console.log(
      `${label}: n=${sub.length} deserto=${d} sóTP=${tpOnly} outros=${sub.length - d - tpOnly} | hab_deserto=${popDesert.toLocaleString('pt-BR')}`,
    );
  }

  const outPath = path.join(ROOT, 'data/processed/pop-x-gap-wh-failed.json');
  fs.writeFileSync(
    outPath,
    JSON.stringify(
      {
        generated_at: new Date().toISOString(),
        definition:
          'Universo=WH failed. gapAgg=3-(#agregadores≥1). score=pop*gapAgg. DESERTO=WH+TP+GP=0.',
        stats: {
          n: rows.length,
          deserto: desert.length,
          so_tp: soTp.length,
        },
        top25: rows.slice(0, 25),
        top_deserto: desert.slice(0, 30),
        top_so_tp: soTp.slice(0, 30),
      },
      null,
      2,
    ),
  );
  console.log(`\nSalvo ${outPath}`);
}

main();
