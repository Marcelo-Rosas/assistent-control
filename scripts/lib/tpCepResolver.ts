/**
 * Lookup bairro via CEP — fonte da verdade Correios (ViaCEP / BrasilAPI).
 * Spec: Docs/superpowers/specs/2026-09-02-tp-bairro-cep-design.md
 */
import fs from 'fs/promises';
import path from 'path';
import { bairroSlug } from './wellhubBairrosCatalog.ts';

export type CepProvider = 'viacep' | 'brasilapi';

export type CepLookupOk = {
  cep: string;
  bairro: string;
  bairro_slug: string;
  localidade: string | null;
  uf: string | null;
  logradouro: string | null;
  provider: CepProvider;
  resolved_at: string;
};

export type CepCacheEntry = CepLookupOk | { cep: string; error: string };

export type ViaCepAddressHit = {
  cep: string;
  logradouro?: string;
  complemento?: string;
  bairro?: string;
  localidade?: string;
  uf?: string;
};

export type RefineCepResult =
  | { ok: true; cep: string; cep_rf: string; bairro_hint?: string }
  | { ok: false; reason: 'cep_logradouro_ambiguo' | 'cep_logradouro_vazio' | 'logradouro_curto' };

const DEFAULT_CACHE_PATH = path.join(process.cwd(), 'data/processed/tp-cep-cache.json');
const DEFAULT_LOGRADOURO_CACHE_PATH = path.join(
  process.cwd(),
  'data/processed/tp-cep-logradouro-cache.json',
);

const CEP_IN_TEXT = /\b(\d{5})-?(\d{3})\b/;

/** Normaliza para 8 dígitos ou null se inválido. */
export function normalizeCep(input: string): string | null {
  const digits = String(input ?? '').replace(/\D/g, '');
  if (digits.length !== 8) return null;
  if (/^0+$/.test(digits)) return null;
  return digits;
}

/** Extrai primeiro CEP literal de texto livre (detail/full_address). */
export function extractCepFromText(text: string): string | null {
  const m = String(text ?? '').match(CEP_IN_TEXT);
  if (!m) return null;
  return normalizeCep(`${m[1]}${m[2]}`);
}

export function cepCacheKey(cep: string): string {
  return `cep:${normalizeCep(cep) ?? cep}`;
}

/** CEP município genérico Correios (termina em -000). */
export function isCepGenerico(cep: string): boolean {
  const d = normalizeCep(cep);
  return Boolean(d && d.endsWith('000'));
}

export function logradouroCacheKey(uf: string, municipio: string, logradouro: string): string {
  const norm = (s: string) =>
    s
      .normalize('NFD')
      .replace(/\p{M}/gu, '')
      .toLowerCase()
      .trim();
  return `addr:${norm(uf)}:${norm(municipio)}:${norm(logradouro)}`;
}

export async function loadLogradouroCache(
  cachePath = DEFAULT_LOGRADOURO_CACHE_PATH,
): Promise<Record<string, RefineCepResult>> {
  try {
    const raw = await fs.readFile(cachePath, 'utf8');
    return JSON.parse(raw) as Record<string, RefineCepResult>;
  } catch {
    return {};
  }
}

export async function saveLogradouroCache(
  cache: Record<string, RefineCepResult>,
  cachePath = DEFAULT_LOGRADOURO_CACHE_PATH,
): Promise<void> {
  await fs.mkdir(path.dirname(cachePath), { recursive: true });
  const tmp = `${cachePath}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(cache, null, 2), 'utf8');
  await fs.rename(tmp, cachePath);
}

function sanitizeLogradouroForViaCep(query: string): string {
  return query
    .replace(/\./g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function buildLogradouroQuery(tipoLogradouro: string | undefined, logradouro: string): string {
  const base = logradouro.trim();
  const tipo = String(tipoLogradouro ?? '').trim();
  if (!tipo) return base;
  const tipoNorm = tipo.replace(/\./g, '').toLowerCase();
  if (base.toLowerCase().startsWith(tipoNorm)) return base;
  return `${tipo} ${base}`.trim();
}

const LOGRADOURO_STOP_WORDS = new Set([
  'rua',
  'r',
  'av',
  'avenida',
  'trav',
  'travessa',
  'al',
  'alameda',
  'dr',
  'doutor',
  'prof',
  'professor',
  'rod',
  'rodovia',
  'estr',
  'estrada',
  'pc',
  'praca',
  'lgo',
  'largo',
  'via',
  'vl',
  'vila',
]);

/** ViaCEP pesquisa endereço — tenta query completa e parciais (min 3 chars). */
export function buildLogradouroSearchQueries(
  tipoLogradouro: string | undefined,
  logradouro: string,
): string[] {
  const full = buildLogradouroQuery(tipoLogradouro, logradouro);
  const base = sanitizeLogradouroForViaCep(logradouro.trim());
  const out: string[] = [];

  for (const q of [full, sanitizeLogradouroForViaCep(full), base, logradouro.trim()]) {
    if (q.length >= 3 && !out.includes(q)) out.push(q);
  }

  const tokens = base
    .toLowerCase()
    .split(/\s+/)
    .filter((t) => t.length >= 3 && !LOGRADOURO_STOP_WORDS.has(t));

  if (tokens.length >= 2) {
    const pair = tokens.slice(-2).join(' ');
    if (pair.length >= 3 && !out.includes(pair)) out.push(pair);
  }
  if (tokens.length >= 1) {
    const last = tokens[tokens.length - 1]!;
    if (last.length >= 3 && !out.includes(last)) out.push(last);
  }
  if (tokens.length >= 2) {
    const all = tokens.join(' ');
    if (all.length >= 3 && !out.includes(all)) out.push(all);
  }

  return out;
}

function normalizeForMatch(s: string): string {
  return s
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Testa se `num` (número do imóvel) cai na faixa descrita pelo complemento do
 * ViaCEP (ex.: "de 1200 a 1400", "até 500 - lado par", "de 1 ao fim").
 * Usa faixa + paridade em vez de substring, pra não casar 12 dentro de 1200.
 * `comp` deve vir normalizado (minúsculo, sem acento, via normalizeForMatch).
 */
export function numeroMatchesComplemento(comp: string, num: number): boolean {
  if (!comp || !Number.isFinite(num)) return false;
  const nums = comp.match(/\d+/g)?.map(Number) ?? [];
  if (nums.length === 0) return false;

  // Paridade: "lado par" / "lado impar" (já sem acento).
  if (comp.includes('lado par') && num % 2 !== 0) return false;
  if (comp.includes('lado impar') && num % 2 === 0) return false;

  const hasDe = /\bde\b/.test(comp);
  const hasAte = /\bate\b/.test(comp);
  const openEnded = /\bao?\s+fim\b/.test(comp) || /\bem\s+diante\b/.test(comp);

  let low: number;
  let high: number;
  if (hasAte && !hasDe) {
    // "até X" → 1..X
    low = 1;
    high = nums[0]!;
  } else if (hasDe && (openEnded || nums.length === 1)) {
    // "de X ao fim" / "de X" sem teto → X..∞
    low = nums[0]!;
    high = Number.POSITIVE_INFINITY;
  } else if (nums.length >= 2) {
    // "de X a Y" → X..Y
    low = Math.min(nums[0]!, nums[1]!);
    high = Math.max(nums[0]!, nums[1]!);
  } else {
    // número único sem "de/até" → igualdade exata
    low = nums[0]!;
    high = nums[0]!;
  }

  return num >= low && num <= high;
}

/** Disambiguate ViaCEP address search — unique CEP or unique bairro only. */
export function disambiguateViaCepResults(
  hits: ViaCepAddressHit[],
  numero?: string | null,
): string | null {
  if (hits.length === 0) return null;

  let pool = hits.filter((h) => {
    const cep = normalizeCep(h.cep);
    return cep && !isCepGenerico(cep);
  });
  if (pool.length === 0) return null;
  if (pool.length === 1) return normalizeCep(pool[0]!.cep);

  const num = String(numero ?? '').replace(/\D/g, '');
  if (num.length > 0) {
    const numVal = Number(num);
    const byNum = pool.filter((h) =>
      numeroMatchesComplemento(normalizeForMatch(String(h.complemento ?? '')), numVal),
    );
    if (byNum.length > 0) pool = byNum;
  }

  const ceps = [...new Set(pool.map((h) => normalizeCep(h.cep)).filter(Boolean) as string[])];
  if (ceps.length === 1) return ceps[0]!;

  const bairros = [
    ...new Set(pool.map((h) => normalizeForMatch(String(h.bairro ?? ''))).filter((b) => b.length >= 2)),
  ];
  if (bairros.length === 1) {
    return normalizeCep(pool[0]!.cep);
  }

  return null;
}

// Busca ViaCEP por logradouro para UMA query já pronta. A expansão em variantes
// (completa/parcial/token) é do caller via buildLogradouroSearchQueries — não
// re-expandir aqui evita HTTP redundante e ordem imprevisível.
async function fetchViaCepByLogradouro(
  uf: string,
  municipio: string,
  logradouro: string,
  fetchFn: LookupFetch,
): Promise<ViaCepAddressHit[]> {
  // Sanitiza (remove tokens tipo "DR." que causam HTTP 400 no ViaCEP) mas sem
  // re-expandir em variantes — isso é papel do caller.
  const query = sanitizeLogradouroForViaCep(logradouro);
  if (query.length < 3) return [];

  const url =
    `https://viacep.com.br/ws/${encodeURIComponent(uf)}/` +
    `${encodeURIComponent(municipio)}/${encodeURIComponent(query)}/json/`;
  const res = await fetchFn(url, { headers: { Accept: 'application/json' } });
  if (res.status === 400) return [];
  if (!res.ok) throw new Error(`ViaCEP logradouro HTTP ${res.status}`);
  const body = (await res.json()) as ViaCepAddressHit[] | { erro?: boolean };
  if (!Array.isArray(body)) return [];
  return body;
}

/**
 * F2.2 — CEP genérico (-000) → ViaCEP busca logradouro RF → CEP refinado.
 */
export async function refineCepViaLogradouro(
  opts: {
    cep_rf: string;
    uf: string;
    municipio: string;
    logradouro: string;
    tipo_logradouro?: string;
    numero?: string;
  },
  fetchOpts?: {
    fetch?: LookupFetch;
    cache?: Record<string, RefineCepResult>;
    skipNetwork?: boolean;
  },
): Promise<RefineCepResult> {
  const cepRf = normalizeCep(opts.cep_rf);
  if (!cepRf || !isCepGenerico(cepRf)) {
    return { ok: false, reason: 'cep_logradouro_ambiguo' };
  }

  const queries = buildLogradouroSearchQueries(opts.tipo_logradouro, opts.logradouro);
  const primaryQuery = queries[0] ?? '';
  if (primaryQuery.length < 3) return { ok: false, reason: 'logradouro_curto' };

  const cacheKey = logradouroCacheKey(opts.uf, opts.municipio, primaryQuery);
  const cached = fetchOpts?.cache?.[cacheKey];
  // Cache antigo pode gravar ok:true com CEP ainda genérico (-000) — invalidar.
  if (cached) {
    if (cached.ok === true && isCepGenerico(cached.cep)) {
      delete fetchOpts?.cache?.[cacheKey];
    } else {
      return cached;
    }
  }
  if (fetchOpts?.skipNetwork) return { ok: false, reason: 'cep_logradouro_vazio' };

  const fetchFn = fetchOpts?.fetch ?? fetch;
  let hits: ViaCepAddressHit[] = [];
  let refined: string | null = null;

  for (const query of queries) {
    hits = await fetchViaCepByLogradouro(opts.uf, opts.municipio, query, fetchFn);
    refined = disambiguateViaCepResults(hits, opts.numero);
    if (refined) break;
  }
  let result: RefineCepResult;
  if (!refined || isCepGenerico(refined)) {
    const onlyGeneric =
      hits.length > 0 && hits.every((h) => isCepGenerico(normalizeCep(h.cep) ?? ''));
    result = {
      ok: false,
      reason:
        hits.length === 0 || onlyGeneric ? 'cep_logradouro_vazio' : 'cep_logradouro_ambiguo',
    };
  } else {
    const bairroHint = hits.find((h) => normalizeCep(h.cep) === refined)?.bairro;
    result = { ok: true, cep: refined, cep_rf: cepRf, bairro_hint: bairroHint };
  }

  if (fetchOpts?.cache) fetchOpts.cache[cacheKey] = result;
  return result;
}

export async function loadCepCache(
  cachePath = DEFAULT_CACHE_PATH,
): Promise<Record<string, CepCacheEntry>> {
  try {
    const raw = await fs.readFile(cachePath, 'utf8');
    const parsed = JSON.parse(raw) as Record<string, CepCacheEntry>;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

export async function saveCepCache(
  cache: Record<string, CepCacheEntry>,
  cachePath = DEFAULT_CACHE_PATH,
): Promise<void> {
  await fs.mkdir(path.dirname(cachePath), { recursive: true });
  const tmp = `${cachePath}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(cache, null, 2), 'utf8');
  await fs.rename(tmp, cachePath);
}

type ViaCepResponse = {
  cep?: string;
  logradouro?: string;
  bairro?: string;
  localidade?: string;
  uf?: string;
  erro?: boolean | string;
};

type BrasilApiCepResponse = {
  cep?: string;
  state?: string;
  city?: string;
  neighborhood?: string;
  street?: string;
};

export type LookupFetch = typeof fetch;

function pickBairroFromLookup(bairro: string | undefined | null): string | null {
  const t = String(bairro ?? '').trim();
  if (t.length < 2 || t.length > 64) return null;
  return t;
}

async function fetchViaCep(cep: string, fetchFn: LookupFetch): Promise<CepLookupOk | null> {
  const url = `https://viacep.com.br/ws/${cep}/json/`;
  const res = await fetchFn(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`ViaCEP HTTP ${res.status}`);
  const body = (await res.json()) as ViaCepResponse;
  if (body.erro) return null;
  const bairro = pickBairroFromLookup(body.bairro);
  if (!bairro) return null;
  return {
    cep,
    bairro,
    bairro_slug: bairroSlug(bairro),
    localidade: body.localidade?.trim() || null,
    uf: body.uf?.trim().toUpperCase() || null,
    logradouro: body.logradouro?.trim() || null,
    provider: 'viacep',
    resolved_at: new Date().toISOString(),
  };
}

async function fetchBrasilApi(cep: string, fetchFn: LookupFetch): Promise<CepLookupOk | null> {
  const url = `https://brasilapi.com.br/api/cep/v2/${cep}`;
  const res = await fetchFn(url, { headers: { Accept: 'application/json' } });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`BrasilAPI HTTP ${res.status}`);
  const body = (await res.json()) as BrasilApiCepResponse;
  const bairro = pickBairroFromLookup(body.neighborhood);
  if (!bairro) return null;
  return {
    cep,
    bairro,
    bairro_slug: bairroSlug(bairro),
    localidade: body.city?.trim() || null,
    uf: body.state?.trim().toUpperCase() || null,
    logradouro: body.street?.trim() || null,
    provider: 'brasilapi',
    resolved_at: new Date().toISOString(),
  };
}

/**
 * Erro transitório (rate-limit/outage/rede) que NÃO deve virar negativo
 * permanente no cache — o CEP precisa ser re-tentado numa próxima rodada.
 * HTTP 429 e 5xx são retryáveis; erros sem status (fetch failed, timeout,
 * ECONNRESET, parse de resposta truncada) são tratados como rede → retryáveis.
 * 4xx (exceto 429) é permanente.
 */
function isRetryableCepError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  const m = msg.match(/HTTP (\d{3})/);
  if (m) {
    const status = Number(m[1]);
    return status === 429 || status >= 500;
  }
  return true;
}

export type CepLocalidadeOk = {
  cep: string;
  localidade: string;
  uf: string | null;
  provider: CepProvider;
  resolved_at: string;
};

/**
 * CEP genérico (-000) → só município/UF (ViaCEP devolve localidade com bairro vazio).
 * Não exige bairro. Não grava negativo no cache de bairro.
 */
export async function lookupLocalidadeFromCep(
  rawCep: string,
  opts?: {
    fetch?: LookupFetch;
    skipNetwork?: boolean;
  },
): Promise<CepLocalidadeOk | null> {
  const cep = normalizeCep(rawCep);
  if (!cep || opts?.skipNetwork) return null;

  const fetchFn = opts?.fetch ?? fetch;

  try {
    const url = `https://viacep.com.br/ws/${cep}/json/`;
    const res = await fetchFn(url, { headers: { Accept: 'application/json' } });
    if (res.ok) {
      const body = (await res.json()) as ViaCepResponse;
      if (!body.erro) {
        const localidade = String(body.localidade ?? '').trim();
        if (localidade.length >= 2) {
          return {
            cep,
            localidade,
            uf: body.uf?.trim().toUpperCase() || null,
            provider: 'viacep',
            resolved_at: new Date().toISOString(),
          };
        }
      }
    }
  } catch {
    /* try BrasilAPI */
  }

  try {
    const url = `https://brasilapi.com.br/api/cep/v2/${cep}`;
    const res = await fetchFn(url, { headers: { Accept: 'application/json' } });
    if (!res.ok) return null;
    const body = (await res.json()) as BrasilApiCepResponse;
    const localidade = String(body.city ?? '').trim();
    if (localidade.length < 2) return null;
    return {
      cep,
      localidade,
      uf: body.state?.trim().toUpperCase() || null,
      provider: 'brasilapi',
      resolved_at: new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

/**
 * CEP → bairro (cache → ViaCEP → BrasilAPI).
 * Retorna null se CEP inválido ou lookup sem bairro.
 */
export async function lookupBairroFromCep(
  rawCep: string,
  opts?: {
    cache?: Record<string, CepCacheEntry>;
    fetch?: LookupFetch;
    skipNetwork?: boolean;
  },
): Promise<CepLookupOk | null> {
  const cep = normalizeCep(rawCep);
  if (!cep) return null;

  const key = cepCacheKey(cep);
  const cached = opts?.cache?.[key];
  if (cached && 'bairro' in cached) {
    return { ...cached, resolved_at: cached.resolved_at };
  }
  if (cached && 'error' in cached) return null;
  if (opts?.skipNetwork) return null;

  const fetchFn = opts?.fetch ?? fetch;

  let result: CepLookupOk | null = null;
  let lastErr: unknown = null;

  // ViaCEP primeiro.
  try {
    result = await fetchViaCep(cep, fetchFn);
  } catch (err) {
    lastErr = err;
  }

  // BrasilAPI como fallback tanto quando ViaCEP retorna null (CEP sem bairro)
  // quanto quando ViaCEP lança (outage/5xx/rede) — o segundo provedor pode ter o dado.
  if (!result) {
    try {
      result = await fetchBrasilApi(cep, fetchFn);
      if (result) lastErr = null;
    } catch (err) {
      lastErr = err;
    }
  }

  if (result) {
    if (opts?.cache) opts.cache[key] = result;
    return result;
  }

  // Sem resultado com erro de rede/HTTP: só grava negativo permanente se o erro
  // NÃO for retryável. Retryável (429/5xx/rede) faz rethrow sem poluir o cache,
  // pra que o runner registre falha temporária e o CEP seja re-tentado depois.
  if (lastErr) {
    if (!isRetryableCepError(lastErr) && opts?.cache) {
      opts.cache[key] = {
        cep,
        error: lastErr instanceof Error ? lastErr.message : String(lastErr),
      };
    }
    throw lastErr;
  }

  // Ambos provedores responderam OK porém sem bairro → negativo legítimo, cacheável.
  if (opts?.cache) opts.cache[key] = { cep, error: 'cep_lookup_fail' };
  return null;
}
