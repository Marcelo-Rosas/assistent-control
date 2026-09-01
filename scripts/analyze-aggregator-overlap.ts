/**
 * Cruzamento TP×WH×GP — mesma unidade em 2+ agregadores.
 *
 * Run:
 *   npx tsx scripts/analyze-aggregator-overlap.ts --cidade "São Paulo" --uf SP
 *   npm run analyze:aggregator-overlap -- --uf=SP --public
 *
 * Output: data/processed/aggregator-overlap-{slug}-{uf}.json
 */
import fs from 'fs/promises';
import path from 'path';
import { bairroSlug } from './lib/wellhubBairrosCatalog.ts';
import {
  buildAggregatorOverlapReport,
  filterOverlapGyms,
  gurupassToOverlap,
  totalpassToOverlap,
  type MatchParams,
  wellhubToOverlap,
} from './lib/aggregatorOverlap.ts';
import type { WellhubGymRaw } from './scrape-wellhub-brasil.ts';

const ROOT = process.cwd();

function parseArgs(): {
  cidade: string | null;
  uf: string | null;
  public: boolean;
  maxDist: number;
  minName: number;
} {
  const cidadeArg = process.argv.find((a) => a.startsWith('--cidade='));
  const ufArg = process.argv.find((a) => a.startsWith('--uf='));
  const cidade =
    cidadeArg?.split('=').slice(1).join('=') ||
    process.argv[process.argv.indexOf('--cidade') + 1] ||
    null;
  const uf =
    (ufArg?.split('=')[1] || process.argv[process.argv.indexOf('--uf') + 1] || null)?.toUpperCase() ??
    null;
  return {
    cidade: cidade || null,
    uf,
    public: process.argv.includes('--public'),
    maxDist: Number(
      process.env.MAX_DIST_M ||
        process.argv.find((a) => a.startsWith('--max-dist='))?.split('=')[1] ||
        150,
    ),
    minName: Number(
      process.env.MIN_NAME_SCORE ||
        process.argv.find((a) => a.startsWith('--min-name='))?.split('=')[1] ||
        0.5,
    ),
  };
}

async function readDump<T>(p: string): Promise<T[]> {
  const raw = JSON.parse(await fs.readFile(p, 'utf8')) as T[] | { data?: T[] };
  return Array.isArray(raw) ? raw : (raw.data ?? []);
}

async function main(): Promise<void> {
  const args = parseArgs();
  const params: MatchParams = { max_dist_m: args.maxDist, min_name_score: args.minName };

  const [whRows, tpRows, gpRows] = await Promise.all([
    readDump<WellhubGymRaw>(path.join(ROOT, 'data/raw/wellhub-brasil-all.json')),
    readDump<Parameters<typeof totalpassToOverlap>[0]>(path.join(ROOT, 'data/raw/totalpass-brasil-all.json')),
    readDump<Parameters<typeof gurupassToOverlap>[0]>(path.join(ROOT, 'data/raw/gurupass-brasil-all.json')),
  ]);

  const filter = { cidade: args.cidade, uf: args.uf };
  const wellhub = filterOverlapGyms(
    whRows.map(wellhubToOverlap).filter((g): g is NonNullable<typeof g> => !!g),
    filter,
  );
  const totalpass = filterOverlapGyms(
    tpRows.map(totalpassToOverlap).filter((g): g is NonNullable<typeof g> => !!g),
    filter,
  );
  const gurupass = filterOverlapGyms(
    gpRows.map(gurupassToOverlap).filter((g): g is NonNullable<typeof g> => !!g),
    filter,
  );

  const report = buildAggregatorOverlapReport({ wellhub, totalpass, gurupass, filter, params });

  const slug = args.cidade ? bairroSlug(args.cidade) : 'brasil';
  const ufPart = args.uf?.toLowerCase() || 'all';
  const fileName = `aggregator-overlap-${slug}-${ufPart}.json`;
  const outProcessed = path.join(ROOT, 'data/processed', fileName);

  await fs.mkdir(path.dirname(outProcessed), { recursive: true });
  await fs.writeFile(outProcessed, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

  if (args.public) {
    const outPublic = path.join(ROOT, 'public/data', fileName);
    await fs.mkdir(path.dirname(outPublic), { recursive: true });
    await fs.writeFile(outPublic, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  }

  const { tp_wh, tp_gp, wh_gp } = report.pairwise;
  console.log(`Overlap ${args.cidade ?? 'BR'}${args.uf ? `/${args.uf}` : ''}`);
  console.log(`WH=${report.counts.wellhub} TP=${report.counts.totalpass} GP=${report.counts.gurupass}`);
  console.log(`TP×WH: ${tp_wh.pairs} (${tp_wh.source_overlap_pct}% TP · ${tp_wh.target_overlap_pct}% WH)`);
  console.log(`TP×GP: ${tp_gp.pairs} (${tp_gp.source_overlap_pct}% TP · ${tp_gp.target_overlap_pct}% GP)`);
  console.log(`WH×GP: ${wh_gp.pairs} (${wh_gp.source_overlap_pct}% WH · ${wh_gp.target_overlap_pct}% GP)`);
  console.log(`TP em WH+GP: ${report.triple.tp_in_wh_and_gp} (${report.triple.tp_in_wh_and_gp_pct}%)`);
  console.log(`Wrote ${outProcessed}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
