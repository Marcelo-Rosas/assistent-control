const SIDRA_BASE = 'https://apisidra.ibge.gov.br/values';

export type SidraRow = {
  D1C?: string;
  D2C?: string;
  D4C?: string;
  D5C?: string;
  D6C?: string;
  V?: string | number;
};

export async function fetchSidra(path: string): Promise<SidraRow[]> {
  const url = `${SIDRA_BASE}${path.startsWith('/') ? path : `/${path}`}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`SIDRA ${res.status}: ${url}`);
  }
  const json = (await res.json()) as SidraRow[];
  return json.filter((row) => row.D1C && row.D2C && row.V != null && row.D1C !== 'Nível Territorial (Código)');
}

/** Map ibge7 → variable code → numeric value */
export function pivotSidraByIbge(rows: SidraRow[]): Map<string, Map<string, number>> {
  const out = new Map<string, Map<string, number>>();
  for (const row of rows) {
    const ibge = String(row.D1C ?? '').trim();
    const varCode = String(row.D2C ?? '').trim();
    const raw = row.V;
    if (!ibge || !varCode) continue;
    const num = typeof raw === 'number' ? raw : Number(String(raw).replace(',', '.'));
    if (!Number.isFinite(num)) continue;
    let bucket = out.get(ibge);
    if (!bucket) {
      bucket = new Map();
      out.set(ibge, bucket);
    }
    bucket.set(varCode, num);
  }
  return out;
}

export async function fetchCempreMunicipios(year = '2022'): Promise<Map<string, Map<string, number>>> {
  const path = `/t/9509/n6/all/v/367,706,707,708,10143/p/${year}`;
  const rows = await fetchSidra(path);
  return pivotSidraByIbge(rows);
}

export async function fetchRendaMunicipios(year = '2022'): Promise<Map<string, Map<string, number>>> {
  const path = `/t/10295/n6/all/v/13534,13431/p/${year}`;
  const rows = await fetchSidra(path);
  const filtered = rows.filter(
    (row) =>
      row.D4C === '6794' &&
      row.D5C === '95253' &&
      row.D6C === '95251',
  );
  return pivotSidraByIbge(filtered);
}

export const SIDRA_CEMPRE_VARS = {
  empresas_atuantes: '367',
  unidades_locais: '706',
  pessoal_ocupado_total: '707',
  pessoal_assalariado: '708',
  salario_medio_mensal: '10143',
} as const;

export const SIDRA_RENDA_VARS = {
  renda_pc_mediana: '13534',
  renda_pc_media: '13431',
} as const;

export function pickSidra(
  table: Map<string, number> | undefined,
  code: string,
): number | null {
  if (!table) return null;
  const v = table.get(code);
  return v != null && Number.isFinite(v) ? v : null;
}
