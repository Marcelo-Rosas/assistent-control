/**
 * Mapa tp_id → CEP + endereço RF via match Receita × TotalPass (tier alta).
 */
import fs from 'fs/promises';
import path from 'path';
import { normalizeCep } from './tpCepResolver.ts';

export type TpReceitaCepHit = {
  tp_id: string;
  cnpj: string;
  cep: string;
  uf: string;
  municipio: string;
  ibge?: string;
  tipo_logradouro?: string;
  logradouro: string;
  numero?: string;
  tp_name: string | null;
  method: string | null;
};

type ReceitaRow = {
  cnpj?: string;
  cep?: string;
  uf?: string;
  tipo_logradouro?: string;
  logradouro?: string;
  numero?: string;
};

const DEFAULT_MATCH_CSV = path.join(
  process.cwd(),
  'data/processed/receita-x-totalpass-match.csv',
);

const RECEITA_CANDIDATES = [
  'data/processed/receita-cnae-wellness-principal-ativos.json',
  'data/processed/receita-cnae-9313100-principal-ativos.json',
];

function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i]!;
    if (c === '"') {
      inQ = !inQ;
      continue;
    }
    if (c === ',' && !inQ) {
      out.push(cur);
      cur = '';
      continue;
    }
    cur += c;
  }
  out.push(cur);
  return out;
}

async function loadReceitaByCnpj(receitaPath?: string): Promise<Map<string, ReceitaRow>> {
  const root = process.cwd();
  const candidates = receitaPath
    ? [receitaPath]
    : RECEITA_CANDIDATES.map((p) => path.join(root, p));

  for (const p of candidates) {
    try {
      const raw = JSON.parse(await fs.readFile(p, 'utf8')) as unknown;
      const rows = Array.isArray(raw) ? raw : [];
      const map = new Map<string, ReceitaRow>();
      for (const row of rows) {
        if (!row || typeof row !== 'object') continue;
        const r = row as ReceitaRow;
        const cnpj = String(r.cnpj ?? '').replace(/\D/g, '');
        if (cnpj.length === 14) map.set(cnpj, r);
      }
      if (map.size > 0) return map;
    } catch {
      /* try next */
    }
  }
  return new Map();
}

export async function loadTpReceitaCepMap(opts?: {
  matchCsvPath?: string;
  receitaPath?: string;
}): Promise<Map<string, TpReceitaCepHit>> {
  const matchPath = opts?.matchCsvPath ?? DEFAULT_MATCH_CSV;
  const receitaByCnpj = await loadReceitaByCnpj(opts?.receitaPath);

  let csv: string;
  try {
    csv = await fs.readFile(matchPath, 'utf8');
  } catch {
    return new Map();
  }

  const lines = csv.split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return new Map();

  const header = parseCsvLine(lines[0]!);
  const idx = (name: string) => header.indexOf(name);

  const out = new Map<string, TpReceitaCepHit>();
  for (const line of lines.slice(1)) {
    const cols = parseCsvLine(line);
    if (cols[idx('match')] !== '1') continue;
    if (cols[idx('tier')] !== 'alta') continue;

    const tpId = cols[idx('tp_id')]?.trim();
    const cnpj = cols[idx('cnpj')]?.replace(/\D/g, '');
    if (!tpId || !cnpj || cnpj.length !== 14) continue;

    const rf = receitaByCnpj.get(cnpj);
    const cep = normalizeCep(String(rf?.cep ?? ''));
    const logradouro = String(rf?.logradouro ?? '').trim();
    const uf = String(cols[idx('uf')] ?? rf?.uf ?? '')
      .trim()
      .toUpperCase();
    const municipio = String(cols[idx('city')] ?? '').trim();
    if (!cep || !logradouro || !uf || !municipio) continue;

    const numero = String(rf?.numero ?? '').trim() || undefined;
    out.set(tpId, {
      tp_id: tpId,
      cnpj,
      cep,
      uf,
      municipio,
      ibge: cols[idx('ibge')]?.trim() || undefined,
      tipo_logradouro: String(rf?.tipo_logradouro ?? '').trim() || undefined,
      logradouro,
      numero,
      tp_name: cols[idx('tp_name')]?.trim() || null,
      method: cols[idx('method')]?.trim() || null,
    });
  }

  return out;
}
