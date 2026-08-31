/**
 * Relatório blog trimestral Receita CNAE 9313100 → fichas JSON.
 *
 * Run: npm run report:receita-blog -- --quarter 2026-Q1 --n 3
 */
import fs from 'node:fs';
import path from 'node:path';
import { CODIGO_RFB_PARA_MUNICIPIO } from './lib/municipioMapper.ts';
import {
  parseRfDate,
  monthOf,
  type CnpjRow,
} from './lib/receitaKpis.ts';
import {
  monthsInQuarter,
  lifeDays,
  buildVidaStats,
  rankTopN,
  mergeRankedCities,
  buildOnda,
  buildBairrosFechamento,
  buildFichaBase,
  type CityMovimento,
  type ReceitaBlogFicha,
} from './lib/receitaBlogReport.ts';
import { enrichCityFromGymsite } from './lib/gymsiteReceitaEnrich.ts';

const ROOT = process.cwd();

type Args = {
  quarter: string;
  n: number;
  ondaMonths: number;
  ativosCsv: string;
  baixadaCsv: string;
  outDir: string;
  skipEnrich: boolean;
};

function loadDotEnvFile(file: string): void {
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) return;
  const text = fs.readFileSync(file, 'utf-8');
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#') || !t.includes('=')) continue;
    const i = t.indexOf('=');
    const k = t.slice(0, i).trim();
    let v = t.slice(i + 1).trim();
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1);
    }
    if (!(k in process.env)) process.env[k] = v;
  }
}

function parseArgs(argv: string[]): Args {
  const out: Args = {
    quarter: '',
    n: 0,
    ondaMonths: 3,
    ativosCsv: path.join(
      ROOT,
      'data/processed/receita-cnae-9313100-principal-ativos.csv',
    ),
    baixadaCsv: path.join(
      ROOT,
      'data/processed/receita-cnae-9313100-principal-ativo-baixada.csv',
    ),
    outDir: path.join(ROOT, 'data/processed/receita-blog'),
    skipEnrich: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => {
      const v = argv[++i];
      if (!v) throw new Error(`flag ${a} exige valor`);
      return v;
    };
    if (a === '--quarter') out.quarter = next();
    else if (a === '--n') out.n = Number(next());
    else if (a === '--onda-months') out.ondaMonths = Number(next());
    else if (a === '--ativos-csv') out.ativosCsv = path.resolve(next());
    else if (a === '--baixada-csv') out.baixadaCsv = path.resolve(next());
    else if (a === '--out-dir') out.outDir = path.resolve(next());
    else if (a === '--skip-enrich') out.skipEnrich = true;
    else throw new Error(`arg desconhecido: ${a}`);
  }

  if (!/^\d{4}-Q[1-4]$/.test(out.quarter)) {
    throw new Error(`--quarter obrigatório no formato YYYY-QN (got: ${out.quarter || 'vazio'})`);
  }
  if (!Number.isInteger(out.n) || out.n < 1) {
    throw new Error(`--n obrigatório inteiro >= 1 (got: ${out.n || 'vazio'})`);
  }
  if (!Number.isInteger(out.ondaMonths) || out.ondaMonths < 1) {
    throw new Error(`--onda-months inválido: ${out.ondaMonths}`);
  }
  return out;
}

function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let i = 0;
  let inQuotes = false;
  while (i < text.length) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      cell += ch;
      i++;
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      i++;
      continue;
    }
    if (ch === ',') {
      row.push(cell);
      cell = '';
      i++;
      continue;
    }
    if (ch === '\n' || (ch === '\r' && text[i + 1] === '\n')) {
      row.push(cell);
      cell = '';
      if (row.some((c) => c.length)) rows.push(row);
      row = [];
      i += ch === '\r' ? 2 : 1;
      continue;
    }
    if (ch === '\r') {
      row.push(cell);
      cell = '';
      if (row.some((c) => c.length)) rows.push(row);
      row = [];
      i++;
      continue;
    }
    cell += ch;
    i++;
  }
  if (cell.length || row.length) {
    row.push(cell);
    if (row.some((c) => c.length)) rows.push(row);
  }
  if (!rows.length) return [];
  const headers = rows[0].map((h) => h.trim());
  return rows.slice(1).map((cols) => {
    const obj: Record<string, string> = {};
    for (let j = 0; j < headers.length; j++) {
      obj[headers[j]] = cols[j] ?? '';
    }
    return obj;
  });
}

function padRfb(code: string): string {
  const d = String(code || '').replace(/\D/g, '');
  return d.padStart(4, '0');
}

function toCnpjRow(r: Record<string, string>): CnpjRow {
  return {
    cnpj: String(r.cnpj || '').replace(/\D/g, ''),
    situacao_cadastral: String(r.situacao_cadastral || '').padStart(2, '0'),
    data_inicio_atividade: String(r.data_inicio_atividade || ''),
    data_situacao_cadastral: String(r.data_situacao_cadastral || ''),
    uf: String(r.uf || '').trim().toUpperCase(),
    municipio: padRfb(r.municipio || ''),
    bairro: String(r.bairro || ''),
    nome_fantasia: String(r.nome_fantasia || ''),
  };
}

function resolveCityMeta(uf: string, municipioCode: string): {
  key: string;
  label: string;
  uf: string;
  ibge?: string;
} {
  const code = padRfb(municipioCode);
  const hit =
    CODIGO_RFB_PARA_MUNICIPIO[code] ||
    CODIGO_RFB_PARA_MUNICIPIO[municipioCode];
  const nome = hit?.nome || `RFB:${code}`;
  const ufFinal = (uf || hit?.uf || '?').toUpperCase();
  return {
    key: `${ufFinal}|${nome}`,
    label: `${nome}/${ufFinal}`,
    uf: ufFinal,
    ...(hit?.ibge ? { ibge: hit.ibge } : {}),
  };
}

function citySlug(label: string): string {
  return label
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function angleOf(rankings: ReceitaBlogFicha['rankings']): string {
  const m = Boolean(rankings.mortalidade);
  const c = Boolean(rankings.crescimento);
  if (m && c) return 'ambos';
  if (m) return 'mortalidade';
  return 'crescimento';
}

async function main(): Promise<void> {
  loadDotEnvFile(path.join(ROOT, '.env'));
  loadDotEnvFile(path.join('C:/Users/marce/gymsite', '.env'));

  const args = parseArgs(process.argv.slice(2));
  const months = monthsInQuarter(args.quarter);
  const monthSet = new Set(months);
  const endMonth = months[months.length - 1]!;

  const ativosRaw = parseCsv(fs.readFileSync(args.ativosCsv, 'utf-8')).map(toCnpjRow);
  const baixadaRaw = parseCsv(fs.readFileSync(args.baixadaCsv, 'utf-8')).map(toCnpjRow);

  const byCity = new Map<
    string,
    CityMovimento & { meta: ReturnType<typeof resolveCityMeta> }
  >();

  // Memoize by (uf|municipio): resolveCityMeta does padRfb + two lookups +
  // template strings, and it is otherwise recomputed for every row inside the
  // per-city loops below — O(cities x rows) redundant work on a full CSV.
  const metaCache = new Map<string, ReturnType<typeof resolveCityMeta>>();
  const cityMeta = (uf: string, municipio: string) => {
    const ck = `${uf}|${municipio}`;
    let m = metaCache.get(ck);
    if (!m) {
      m = resolveCityMeta(uf, municipio);
      metaCache.set(ck, m);
    }
    return m;
  };

  const ensure = (row: CnpjRow) => {
    const meta = cityMeta(row.uf, row.municipio);
    let cur = byCity.get(meta.key);
    if (!cur) {
      cur = {
        key: meta.key,
        label: meta.label,
        uf: meta.uf,
        ...(meta.ibge ? { ibge: meta.ibge } : {}),
        ativos: 0,
        entrantes: 0,
        baixados: 0,
        saldo: 0,
        meta,
      };
      byCity.set(meta.key, cur);
    }
    return cur;
  };

  for (const row of ativosRaw) {
    if (row.situacao_cadastral === '02') {
      ensure(row).ativos += 1;
    }
    // Entrantes must use the same source/rule as scout-kpis
    // (filterEntrantes over the ativos CSV): companies opened in-quarter that
    // are still active live only in the ativos CSV, so deriving entrantes from
    // baixadaRaw undercounts them and diverges from the KPI dashboard.
    const inicio = parseRfDate(row.data_inicio_atividade);
    if (inicio && monthSet.has(monthOf(inicio))) {
      ensure(row).entrantes += 1;
    }
  }

  for (const row of baixadaRaw) {
    if (row.situacao_cadastral === '08') {
      const baixa = parseRfDate(row.data_situacao_cadastral);
      if (baixa && monthSet.has(monthOf(baixa))) {
        ensure(row).baixados += 1;
      }
    }
  }

  const cities: CityMovimento[] = [];
  for (const c of byCity.values()) {
    c.saldo = c.entrantes - c.baixados;
    if (c.entrantes === 0 && c.baixados === 0) continue;
    cities.push({
      key: c.key,
      label: c.label,
      uf: c.uf,
      ...(c.ibge ? { ibge: c.ibge } : {}),
      ativos: c.ativos,
      entrantes: c.entrantes,
      baixados: c.baixados,
      saldo: c.saldo,
    });
  }

  const { mortalidade, crescimento } = rankTopN(cities, args.n);
  const merged = mergeRankedCities(mortalidade, crescimento);

  const resolveKey = (row: CnpjRow) => cityMeta(row.uf, row.municipio).key;

  const baixadosQuarter = baixadaRaw.filter((row) => {
    if (row.situacao_cadastral !== '08') return false;
    const iso = parseRfDate(row.data_situacao_cadastral);
    return iso !== null && monthSet.has(monthOf(iso));
  });

  const quarterDir = path.join(args.outDir, args.quarter);
  fs.mkdirSync(quarterDir, { recursive: true });

  const paths: string[] = [];
  const fichas: ReceitaBlogFicha[] = [];

  for (const city of merged) {
    const lifeList: number[] = [];
    for (const row of baixadosQuarter) {
      if (resolveKey(row) !== city.key) continue;
      const d = lifeDays(row.data_inicio_atividade, row.data_situacao_cadastral);
      if (d !== null) lifeList.push(d);
    }
    const vida = buildVidaStats(lifeList);
    const bairros = buildBairrosFechamento(
      baixadosQuarter,
      city.key,
      resolveKey,
      2,
    );
    const onda = buildOnda(
      baixadaRaw.filter((r) => r.situacao_cadastral === '08'),
      city.key,
      endMonth,
      args.ondaMonths,
      resolveKey,
    );

    let ficha = buildFichaBase({
      quarter: args.quarter,
      city,
      rankings: city.rankings,
      vidaBaixados: vida,
      bairrosFechamento: bairros,
      onda,
      fontes: [
        'Receita Federal CNAE 9313100 (CSV processado)',
        'GymSite municipio_pib + renda_bairro (IBGE)',
      ],
    });

    if (args.skipEnrich) {
      ficha = {
        ...ficha,
        gymsite: { status: 'indisponivel', motivo: 'skip_enrich' },
      };
    } else if (city.ibge) {
      ficha = {
        ...ficha,
        gymsite: await enrichCityFromGymsite(city.ibge),
      };
    } else {
      ficha = {
        ...ficha,
        gymsite: { status: 'indisponivel', motivo: 'missing_ibge' },
      };
    }

    const slug = citySlug(city.label);
    const file = path.join(quarterDir, `${slug}.json`);
    fs.writeFileSync(file, JSON.stringify(ficha, null, 2), 'utf-8');
    paths.push(file);
    fichas.push(ficha);
    console.error(
      `wrote ${path.relative(ROOT, file)} angle=${angleOf(ficha.rankings)} gymsite=${ficha.gymsite.status}`,
    );
  }

  const indexPath = path.join(quarterDir, 'index.json');
  const index = {
    generated_at: new Date().toISOString(),
    quarter: args.quarter,
    n: args.n,
    months,
    end_month: endMonth,
    onda_months: args.ondaMonths,
    skip_enrich: args.skipEnrich,
    fichas: paths.map((p, i) => ({
      path: path.relative(ROOT, p).replace(/\\/g, '/'),
      city_key: fichas[i]!.city_key,
      angle: angleOf(fichas[i]!.rankings),
      gymsite: fichas[i]!.gymsite.status,
    })),
  };
  fs.writeFileSync(indexPath, JSON.stringify(index, null, 2), 'utf-8');

  console.log(
    JSON.stringify(
      {
        quarter: args.quarter,
        n: args.n,
        fichas: fichas.length,
        paths: paths.map((p) => path.relative(ROOT, p).replace(/\\/g, '/')),
        index: path.relative(ROOT, indexPath).replace(/\\/g, '/'),
      },
      null,
      2,
    ),
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
