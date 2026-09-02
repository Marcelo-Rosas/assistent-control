import fs from 'fs/promises';
import path from 'path';
import { fold } from './academia-normalize.ts';
import { fetchSidra } from './sidraClient.ts';

const IBGE_FTP_BASE =
  'https://ftp.ibge.gov.br/Censos/Censo_Demografico_2022/Agregados_por_Setores_Censitarios_Rendimento_do_Responsavel';

export type IbgeRendaUnit = {
  bairro: string;
  bairro_norm: string;
  renda_pc: number;
  renda_media: number;
  domicilios: number | null;
  moradores: number | null;
};

export type IbgeRendaFetchResult = {
  ibge: string;
  fonte: string;
  rows: IbgeRendaUnit[];
};

type ParsedCsvRow = {
  nome: string;
  domicilios: number | null;
  moradores: number | null;
  mediana_resp: number | null;
};

function parseBrNumber(raw: string | undefined): number | null {
  if (!raw) return null;
  const n = Number(raw.replace(/^"|"$/g, '').replace(/\./g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

function parseBairroLine(line: string): ParsedCsvRow | null {
  const m = line.match(/^"(\d+)";"([^"]*)";(.+)$/);
  if (!m) return null;
  const vals = m[3].split(';').map((v) => v.replace(/^"|"$/g, ''));
  return {
    nome: m[2].trim(),
    domicilios: parseBrNumber(vals[0]),
    moradores: parseBrNumber(vals[1]),
    mediana_resp: parseBrNumber(vals[3]),
  };
}

function parseDistritoLine(line: string): ParsedCsvRow | null {
  const m = line.match(/^"(\d+)";"([^"]*)";(.+)$/);
  if (!m) return null;
  const vals = m[3].split(';').map((v) => v.replace(/^"|"$/g, ''));
  return {
    nome: m[2].trim(),
    domicilios: parseBrNumber(vals[1]),
    moradores: parseBrNumber(vals[2]),
    mediana_resp: parseBrNumber(vals[5]),
  };
}

async function downloadZip(url: string, destZip: string): Promise<void> {
  await fs.mkdir(path.dirname(destZip), { recursive: true });
  try {
    await fs.access(destZip);
    return;
  } catch {
    /* download */
  }
  const res = await fetch(url);
  if (!res.ok) throw new Error(`IBGE FTP ${res.status}: ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  await fs.writeFile(destZip, buf);
}

async function readZipCsv(zipPath: string, csvNameHint: string): Promise<string> {
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const exec = promisify(execFile);
  const outDir = `${zipPath}.dir`;
  await fs.mkdir(outDir, { recursive: true });
  const existing = (await fs.readdir(outDir)).find((f) => f.toLowerCase().endsWith('.csv'));
  if (!existing) {
    await exec('powershell', [
      '-NoProfile',
      '-Command',
      `Expand-Archive -Path '${zipPath.replace(/'/g, "''")}' -DestinationPath '${outDir.replace(/'/g, "''")}' -Force`,
    ]);
  }
  const csvFile =
    (await fs.readdir(outDir)).find((f) => f.toLowerCase().includes(csvNameHint.toLowerCase())) ??
    (await fs.readdir(outDir)).find((f) => f.toLowerCase().endsWith('.csv'));
  if (!csvFile) throw new Error(`CSV not found in ${zipPath}`);
  return fs.readFile(path.join(outDir, csvFile), 'latin1');
}

async function municipalMedianaPc(ibge: string): Promise<number | null> {
  const pathSidra = `/t/10295/n6/${ibge}/v/13534/p/2022/c58/95253/c86/95251/c2/6794`;
  const rows = await fetchSidra(pathSidra);
  const row = rows.find((r) => String(r.D1C) === ibge);
  if (!row?.V) return null;
  const n = Number(String(row.V).replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

function scaleToPerCapita(
  units: ParsedCsvRow[],
  munMedianaPc: number,
): IbgeRendaUnit[] {
  const medians = units
    .map((u) => u.mediana_resp)
    .filter((n): n is number => n != null && n > 0)
    .sort((a, b) => a - b);
  if (!medians.length) return [];
  const ref = medians[Math.floor(medians.length / 2)];

  return units
    .filter((u) => u.mediana_resp != null && u.mediana_resp > 0)
    .map((u) => {
      const mediana = u.mediana_resp as number;
      const renda_pc = Math.round(munMedianaPc * (mediana / ref) * 100) / 100;
      return {
        bairro: u.nome,
        bairro_norm: fold(u.nome),
        renda_pc,
        renda_media: mediana,
        domicilios: u.domicilios,
        moradores: u.moradores,
      };
    });
}

export async function fetchIbgeRendaForMunicipio(
  ibge: string,
  cacheDir: string,
): Promise<IbgeRendaFetchResult> {
  const munPc = await municipalMedianaPc(ibge);
  if (munPc == null) {
    throw new Error(`SIDRA mediana per capita indisponível para ibge=${ibge}`);
  }

  const bairroZip = path.join(cacheDir, 'ibge-bairros-renda-responsavel.zip');
  await downloadZip(
    `${IBGE_FTP_BASE}/Agregados_por_bairros_renda_responsavel_BR_20260508_csv.zip`,
    bairroZip,
  );
  const bairroCsv = await readZipCsv(bairroZip, 'bairros');
  const bairroLines = bairroCsv.split(/\r?\n/).slice(1);
  const bairroUnits = bairroLines
    .filter((l) => l.startsWith(`"${ibge}`))
    .map(parseBairroLine)
    .filter((r): r is ParsedCsvRow => r != null);

  if (bairroUnits.length) {
    return {
      ibge,
      fonte:
        'IBGE Censo 2022 — mediana rend. responsável (FTP) escalada por SIDRA 10295 renda_pc municipal',
      rows: scaleToPerCapita(bairroUnits, munPc),
    };
  }

  const distZip = path.join(cacheDir, 'ibge-distritos-renda-responsavel.zip');
  await downloadZip(
    `${IBGE_FTP_BASE}/Agregados_por_distritos_renda_responsavel_BR_20260508_csv.zip`,
    distZip,
  );
  const distCsv = await readZipCsv(distZip, 'distritos');
  const distLines = distCsv.split(/\r?\n/).slice(1);
  const distUnits = distLines
    .filter((l) => l.startsWith(`"${ibge}`))
    .map(parseDistritoLine)
    .filter((r): r is ParsedCsvRow => r != null);

  if (!distUnits.length) {
    throw new Error(`Sem bairros/distritos IBGE renda para ibge=${ibge}`);
  }

  return {
    ibge,
    fonte:
      'IBGE Censo 2022 — mediana rend. responsável distrito (FTP) escalada por SIDRA 10295 renda_pc municipal',
    rows: scaleToPerCapita(distUnits, munPc),
  };
}

export function rowsToRendaMap(rows: IbgeRendaUnit[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const row of rows) out[row.bairro] = row.renda_pc;
  return out;
}
