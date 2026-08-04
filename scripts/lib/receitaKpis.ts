export type CnpjRow = {
  cnpj: string;
  situacao_cadastral: string;
  data_inicio_atividade: string;
  data_situacao_cadastral: string;
  uf: string;
  municipio: string;
  bairro: string;
  nome_fantasia: string;
};

export type ReceitaGeoNode = {
  key: string;
  label: string;
  ativos: number;
  entrantes_mes: number;
  baixados_mes: number;
  saldo_mes: number;
  diff_novos: number;
  diff_baixados: number;
  children?: ReceitaGeoNode[];
};

export type ReceitaKpisFile = {
  generated_at: string;
  month: string;
  cnae: '9313100';
  source: {
    ativos_csv: string;
    ativo_baixada_csv: string;
    snapshot_prev: string | null;
  };
  totals: {
    ativos: number;
    entrantes_mes: number;
    baixados_mes: number;
    saldo_mes: number;
    diff_novos: number;
    diff_baixados: number;
  };
  by_uf: ReceitaGeoNode[];
};

type GeoMetrics = {
  ativos: number;
  entrantes_mes: number;
  baixados_mes: number;
  diff_novos: number;
  diff_baixados: number;
};

type CityBucket = {
  municipioCode: string;
  label: string;
  bairros: Map<string, { label: string; metrics: GeoMetrics }>;
  metrics: GeoMetrics;
};

type UfBucket = {
  label: string;
  cities: Map<string, CityBucket>;
  metrics: GeoMetrics;
};

export function parseRfDate(raw: string | number): string | null {
  const digits = String(raw ?? '').replace(/\D/g, '');
  if (digits.length !== 8 || digits === '00000000') return null;
  const y = Number(digits.slice(0, 4));
  const m = Number(digits.slice(4, 6));
  const d = Number(digits.slice(6, 8));
  if (y < 1900 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return null;
  return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`;
}

export function monthOf(isoDate: string): string {
  return isoDate.slice(0, 7);
}

export function normalizeBairro(s: string): string {
  const slug = String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  return slug || '(sem-bairro)';
}

export function filterEntrantes(rows: CnpjRow[], month: string): CnpjRow[] {
  return rows.filter((row) => {
    const iso = parseRfDate(row.data_inicio_atividade);
    return iso !== null && monthOf(iso) === month;
  });
}

export function filterBaixados(rows: CnpjRow[], month: string): CnpjRow[] {
  return rows.filter((row) => {
    if (row.situacao_cadastral !== '08') return false;
    const iso = parseRfDate(row.data_situacao_cadastral);
    return iso !== null && monthOf(iso) === month;
  });
}

export function diffSnapshots(
  prev: Map<string, string>,
  curr: Map<string, string>,
): { novos: string[]; baixados: string[] } {
  const novos: string[] = [];
  const baixados: string[] = [];

  for (const [cnpj] of curr) {
    if (!prev.has(cnpj)) novos.push(cnpj);
  }

  for (const [cnpj, prevSit] of prev) {
    const currSit = curr.get(cnpj);
    if (currSit === undefined) {
      baixados.push(cnpj);
    } else if (prevSit !== '08' && currSit === '08') {
      baixados.push(cnpj);
    }
  }

  novos.sort();
  baixados.sort();
  return { novos, baixados };
}

function emptyMetrics(): GeoMetrics {
  return {
    ativos: 0,
    entrantes_mes: 0,
    baixados_mes: 0,
    diff_novos: 0,
    diff_baixados: 0,
  };
}

function addMetrics(target: GeoMetrics, delta: Partial<GeoMetrics>): void {
  if (delta.ativos) target.ativos += delta.ativos;
  if (delta.entrantes_mes) target.entrantes_mes += delta.entrantes_mes;
  if (delta.baixados_mes) target.baixados_mes += delta.baixados_mes;
  if (delta.diff_novos) target.diff_novos += delta.diff_novos;
  if (delta.diff_baixados) target.diff_baixados += delta.diff_baixados;
}

function bairroLabel(raw: string): string {
  const trimmed = String(raw ?? '').trim();
  return trimmed || '(sem bairro)';
}

function getOrCreateUf(tree: Map<string, UfBucket>, uf: string): UfBucket {
  let bucket = tree.get(uf);
  if (!bucket) {
    bucket = { label: uf, cities: new Map(), metrics: emptyMetrics() };
    tree.set(uf, bucket);
  }
  return bucket;
}

function getOrCreateCity(
  ufBucket: UfBucket,
  uf: string,
  municipioCode: string,
  resolveCity: (uf: string, municipioCode: string) => string,
): CityBucket {
  const cityKey = `${uf}|${municipioCode}`;
  let city = ufBucket.cities.get(cityKey);
  if (!city) {
    city = {
      municipioCode,
      label: resolveCity(uf, municipioCode),
      bairros: new Map(),
      metrics: emptyMetrics(),
    };
    ufBucket.cities.set(cityKey, city);
  }
  return city;
}

function getOrCreateBairro(
  city: CityBucket,
  bairroRaw: string,
): { key: string; label: string; metrics: GeoMetrics } {
  const key = normalizeBairro(bairroRaw);
  let bairro = city.bairros.get(key);
  if (!bairro) {
    bairro = { label: bairroLabel(bairroRaw), metrics: emptyMetrics() };
    city.bairros.set(key, bairro);
  }
  return bairro;
}

function applyRowMetrics(
  tree: Map<string, UfBucket>,
  row: CnpjRow,
  resolveCity: (uf: string, municipioCode: string) => string,
  delta: Partial<GeoMetrics>,
): void {
  const uf = String(row.uf || '').trim() || '??';
  const municipioCode = String(row.municipio || '').trim();
  const ufBucket = getOrCreateUf(tree, uf);
  const city = getOrCreateCity(ufBucket, uf, municipioCode, resolveCity);
  const bairro = getOrCreateBairro(city, row.bairro);

  addMetrics(bairro.metrics, delta);
  addMetrics(city.metrics, delta);
  addMetrics(ufBucket.metrics, delta);
}

function buildRowLookup(rows: CnpjRow[]): Map<string, CnpjRow> {
  const map = new Map<string, CnpjRow>();
  for (const row of rows) map.set(row.cnpj, row);
  return map;
}

function metricsToNode(
  key: string,
  label: string,
  metrics: GeoMetrics,
  children?: ReceitaGeoNode[],
): ReceitaGeoNode {
  return {
    key,
    label,
    ativos: metrics.ativos,
    entrantes_mes: metrics.entrantes_mes,
    baixados_mes: metrics.baixados_mes,
    saldo_mes: metrics.entrantes_mes - metrics.baixados_mes,
    diff_novos: metrics.diff_novos,
    diff_baixados: metrics.diff_baixados,
    ...(children?.length ? { children } : {}),
  };
}

function treeToNodes(tree: Map<string, UfBucket>): ReceitaGeoNode[] {
  return [...tree.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([uf, ufBucket]) => {
      const cities = [...ufBucket.cities.entries()]
        .sort(([, a], [, b]) => a.label.localeCompare(b.label))
        .map(([cityKey, city]) => {
          const bairros = [...city.bairros.entries()]
            .sort(([, a], [, b]) => a.label.localeCompare(b.label))
            .map(([bairroKey, bairro]) =>
              metricsToNode(
                `${cityKey}|${bairroKey}`,
                bairro.label,
                bairro.metrics,
              ),
            );
          return metricsToNode(cityKey, city.label, city.metrics, bairros);
        });
      return metricsToNode(uf, ufBucket.label, ufBucket.metrics, cities);
    });
}

function sumTreeMetrics(tree: Map<string, UfBucket>): GeoMetrics {
  const totals = emptyMetrics();
  for (const ufBucket of tree.values()) addMetrics(totals, ufBucket.metrics);
  return totals;
}

export type BuildKpiTreeParams = {
  month: string;
  ativosRows: CnpjRow[];
  entrantes: CnpjRow[];
  baixados: CnpjRow[];
  diffNovosCnpjs: string[];
  diffBaixadosCnpjs: string[];
  resolveCity: (uf: string, municipioCode: string) => string;
  source: ReceitaKpisFile['source'];
  generatedAt?: string;
};

export function buildKpiTree(params: BuildKpiTreeParams): ReceitaKpisFile {
  const {
    month,
    ativosRows,
    entrantes,
    baixados,
    diffNovosCnpjs,
    diffBaixadosCnpjs,
    resolveCity,
    source,
    generatedAt = new Date().toISOString(),
  } = params;

  const tree = new Map<string, UfBucket>();
  const rowLookup = buildRowLookup([...ativosRows, ...entrantes, ...baixados]);

  for (const row of ativosRows) {
    if (row.situacao_cadastral !== '02') continue;
    applyRowMetrics(tree, row, resolveCity, { ativos: 1 });
  }

  for (const row of entrantes) {
    applyRowMetrics(tree, row, resolveCity, { entrantes_mes: 1 });
  }

  for (const row of baixados) {
    applyRowMetrics(tree, row, resolveCity, { baixados_mes: 1 });
  }

  for (const cnpj of diffNovosCnpjs) {
    const row = rowLookup.get(cnpj);
    if (row) applyRowMetrics(tree, row, resolveCity, { diff_novos: 1 });
  }

  for (const cnpj of diffBaixadosCnpjs) {
    const row = rowLookup.get(cnpj);
    if (row) applyRowMetrics(tree, row, resolveCity, { diff_baixados: 1 });
  }

  const aggregated = sumTreeMetrics(tree);

  return {
    generated_at: generatedAt,
    month,
    cnae: '9313100',
    source,
    totals: {
      ativos: aggregated.ativos,
      entrantes_mes: aggregated.entrantes_mes,
      baixados_mes: aggregated.baixados_mes,
      saldo_mes: aggregated.entrantes_mes - aggregated.baixados_mes,
      diff_novos: diffNovosCnpjs.length,
      diff_baixados: diffBaixadosCnpjs.length,
    },
    by_uf: treeToNodes(tree),
  };
}
