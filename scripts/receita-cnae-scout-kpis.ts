/**
 * Scout Receita CNAE 9313100 — KPIs mês + diff snapshot.
 *
 * Run: npm run scout:receita-kpis -- --month 2025-01
 */
import fs from 'node:fs';
import path from 'node:path';
import { CODIGO_RFB_PARA_MUNICIPIO } from './lib/municipioMapper.ts';
import {
  buildKpiTree,
  diffSnapshots,
  filterBaixados,
  filterEntrantes,
  type CnpjRow,
} from './lib/receitaKpis.ts';

const ROOT = process.cwd();
const SAMPLE_MAX = 200;

type Args = {
  month: string;
  writePublic: boolean;
  ativosCsv: string;
  baixadaCsv: string;
  snapshot: string;
};

function previousMonth(d = new Date()): string {
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth(); // 0-11
  const dt = new Date(Date.UTC(y, m - 1, 1));
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}`;
}

function parseArgs(argv: string[]): Args {
  const out: Args = {
    month: previousMonth(),
    writePublic: true,
    ativosCsv: path.join(
      ROOT,
      'data/processed/receita-cnae-9313100-principal-ativos.csv',
    ),
    baixadaCsv: path.join(
      ROOT,
      'data/processed/receita-cnae-9313100-principal-ativo-baixada.csv',
    ),
    snapshot: path.join(ROOT, 'data/processed/receita-cnpj-snapshot-prev.json'),
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => {
      const v = argv[++i];
      if (!v) throw new Error(`flag ${a} exige valor`);
      return v;
    };
    if (a === '--month') out.month = next();
    else if (a === '--write-public') out.writePublic = true;
    else if (a === '--no-write-public') out.writePublic = false;
    else if (a === '--ativos-csv') out.ativosCsv = path.resolve(next());
    else if (a === '--baixada-csv') out.baixadaCsv = path.resolve(next());
    else if (a === '--snapshot') out.snapshot = path.resolve(next());
    else throw new Error(`arg desconhecido: ${a}`);
  }
  if (!/^\d{4}-\d{2}$/.test(out.month)) {
    throw new Error(`--month inválido: ${out.month}`);
  }
  return out;
}

/** Minimal CSV parse (handles quotes). */
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

function resolveCity(uf: string, municipioCode: string): string {
  const code = padRfb(municipioCode);
  const hit =
    CODIGO_RFB_PARA_MUNICIPIO[code] ||
    CODIGO_RFB_PARA_MUNICIPIO[municipioCode];
  if (hit?.nome) return hit.nome;
  return `RFB:${code}`;
}

function loadSnapshot(file: string): Map<string, string> {
  const map = new Map<string, string>();
  if (!fs.existsSync(file)) return map;
  const raw = JSON.parse(fs.readFileSync(file, 'utf-8')) as
    | Record<string, string>
    | { cnpjs?: Record<string, string | { situacao_cadastral?: string }> };
  const obj =
    raw && typeof raw === 'object' && 'cnpjs' in raw && raw.cnpjs
      ? raw.cnpjs
      : (raw as Record<string, string | { situacao_cadastral?: string }>);
  for (const [cnpj, v] of Object.entries(obj)) {
    if (typeof v === 'string') map.set(cnpj, v);
    else if (v && typeof v === 'object' && v.situacao_cadastral) {
      map.set(cnpj, String(v.situacao_cadastral));
    }
  }
  return map;
}

function sampleRows(
  rows: CnpjRow[],
  resolve: (uf: string, mun: string) => string,
): unknown[] {
  return rows.slice(0, SAMPLE_MAX).map((r) => ({
    cnpj: r.cnpj,
    nome_fantasia: r.nome_fantasia,
    uf: r.uf,
    cidade: resolve(r.uf, r.municipio),
    bairro: r.bairro,
  }));
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const t0 = Date.now();

  console.error(`Lendo ativos: ${args.ativosCsv}`);
  const ativosRaw = parseCsv(fs.readFileSync(args.ativosCsv, 'utf-8'));
  const ativosRows = ativosRaw.map(toCnpjRow).filter((r) => r.cnpj);

  console.error(`Lendo ativo+baixada: ${args.baixadaCsv}`);
  const baixadaRaw = parseCsv(fs.readFileSync(args.baixadaCsv, 'utf-8'));
  const baixadaRows = baixadaRaw.map(toCnpjRow).filter((r) => r.cnpj);

  const prev = loadSnapshot(args.snapshot);
  const curr = new Map<string, string>();
  const lookup = new Map<string, CnpjRow>();
  for (const r of baixadaRows) {
    curr.set(r.cnpj, r.situacao_cadastral);
    lookup.set(r.cnpj, r);
  }

  const entrantes = filterEntrantes(ativosRows, args.month);
  const baixados = filterBaixados(baixadaRows, args.month);
  const diff = diffSnapshots(prev, curr);

  const kpis = buildKpiTree({
    month: args.month,
    ativosRows,
    entrantes,
    baixados,
    diffNovosCnpjs: diff.novos,
    diffBaixadosCnpjs: diff.baixados,
    resolveCity,
    source: {
      ativos_csv: path.relative(ROOT, args.ativosCsv).replace(/\\/g, '/'),
      ativo_baixada_csv: path
        .relative(ROOT, args.baixadaCsv)
        .replace(/\\/g, '/'),
      snapshot_prev: fs.existsSync(args.snapshot)
        ? path.relative(ROOT, args.snapshot).replace(/\\/g, '/')
        : null,
    },
  });

  const delta = {
    generated_at: kpis.generated_at,
    month: args.month,
    counts: {
      entrantes_mes: entrantes.length,
      baixados_mes: baixados.length,
      diff_novos: diff.novos.length,
      diff_baixados: diff.baixados.length,
    },
    samples: {
      entrantes_mes: sampleRows(entrantes, resolveCity),
      baixados_mes: sampleRows(baixados, resolveCity),
      diff_novos: diff.novos.slice(0, SAMPLE_MAX).map((cnpj) => {
        const r = lookup.get(cnpj);
        return r
          ? {
              cnpj,
              nome_fantasia: r.nome_fantasia,
              uf: r.uf,
              cidade: resolveCity(r.uf, r.municipio),
              bairro: r.bairro,
            }
          : { cnpj };
      }),
      diff_baixados: diff.baixados.slice(0, SAMPLE_MAX).map((cnpj) => {
        const r = lookup.get(cnpj);
        return r
          ? {
              cnpj,
              nome_fantasia: r.nome_fantasia,
              uf: r.uf,
              cidade: resolveCity(r.uf, r.municipio),
              bairro: r.bairro,
              situacao: r.situacao_cadastral,
            }
          : { cnpj };
      }),
    },
  };

  const processedDir = path.join(ROOT, 'data', 'processed');
  fs.mkdirSync(processedDir, { recursive: true });
  const deltaPath = path.join(processedDir, `receita-delta-${args.month}.json`);
  const kpisPath = path.join(processedDir, `receita-kpis-${args.month}.json`);
  fs.writeFileSync(deltaPath, JSON.stringify(delta, null, 2), 'utf-8');
  fs.writeFileSync(kpisPath, JSON.stringify(kpis, null, 2), 'utf-8');

  const paths: Record<string, string> = {
    delta: path.relative(ROOT, deltaPath).replace(/\\/g, '/'),
    kpis: path.relative(ROOT, kpisPath).replace(/\\/g, '/'),
  };

  if (args.writePublic) {
    const pubDir = path.join(ROOT, 'public', 'receita');
    fs.mkdirSync(pubDir, { recursive: true });
    const pubMonth = path.join(pubDir, `kpis-${args.month}.json`);
    const pubLatest = path.join(pubDir, 'kpis-latest.json');
    const monthsPath = path.join(pubDir, 'months.json');
    fs.writeFileSync(pubMonth, JSON.stringify(kpis), 'utf-8');
    fs.writeFileSync(pubLatest, JSON.stringify(kpis), 'utf-8');

    let months: string[] = [];
    if (fs.existsSync(monthsPath)) {
      try {
        const raw = JSON.parse(fs.readFileSync(monthsPath, 'utf-8')) as
          | string[]
          | { months?: string[] };
        months = Array.isArray(raw) ? raw : Array.isArray(raw.months) ? raw.months : [];
      } catch {
        months = [];
      }
    }
    if (!months.includes(args.month)) months.push(args.month);
    months.sort();
    fs.writeFileSync(
      monthsPath,
      JSON.stringify({ months, latest: args.month }, null, 2),
      'utf-8',
    );
    paths.public_month = path.relative(ROOT, pubMonth).replace(/\\/g, '/');
    paths.public_latest = path.relative(ROOT, pubLatest).replace(/\\/g, '/');
    paths.months = path.relative(ROOT, monthsPath).replace(/\\/g, '/');
  }

  const snapObj: Record<string, string> = {};
  for (const [cnpj, sit] of curr) snapObj[cnpj] = sit;
  fs.writeFileSync(
    args.snapshot,
    JSON.stringify(
      {
        generated_at: kpis.generated_at,
        month: args.month,
        cnpjs: snapObj,
      },
      null,
      0,
    ),
    'utf-8',
  );
  paths.snapshot = path.relative(ROOT, args.snapshot).replace(/\\/g, '/');

  console.log(
    JSON.stringify(
      {
        month: args.month,
        totals: kpis.totals,
        elapsed_ms: Date.now() - t0,
        paths,
      },
      null,
      2,
    ),
  );
}

try {
  main();
} catch (e) {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
}
