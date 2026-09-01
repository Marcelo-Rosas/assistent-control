/**
 * GuruPass Pass 2 — schema, busca API (citySlug) e enrich via payload Next.js.
 * Port de gurupass_scraper.py (2026-08-28).
 */

import { extractBalancedJson } from './nextJsPayload.ts';

export const GURUPASS_BASE_URL = 'https://www.gurupass.com.br';
export const GURUPASS_API_BASE = 'https://api.gurupass.com.br';
export const GURUPASS_SEARCH_ENDPOINT = `${GURUPASS_API_BASE}/user/establishments/search`;
export const GURUPASS_PAGE_LIMIT = 200;

export type GuruPassNamedRef = { name?: string; code?: string };
export type GuruPassPhoto = { url?: string; [key: string]: unknown };
export type GuruPassProduct = {
  id?: string;
  name?: string;
  cost_credits?: number;
  final_cost_credits?: number;
  cost_cents?: number;
  description?: string;
  [key: string]: unknown;
};

export type GuruPassOpeningStatus = {
  open?: boolean;
  nextClosing?: { time?: string; breakTime?: string | null; breakReturn?: string | null };
  nextOpening?: { day?: string; time?: string };
};

export type GuruPassProdutoPlano = {
  nome: string | null;
  horario: string | null;
  creditos: number | null;
  preco_centavos: number | null;
};

export type GuruPassMenorPreco = {
  hasProduct?: boolean;
  name?: string;
  lowerPrice?: number;
};

export type GuruPassSearchGymRaw = {
  gurupass_id?: string;
  id?: string;
  slug?: string;
  name?: string;
  fullAddres?: string;
  fullAddress?: string;
  neighborhood?: string | GuruPassNamedRef;
  city?: string | GuruPassNamedRef;
  state?: string | GuruPassNamedRef;
  latitude?: string | number;
  longitude?: string | number;
  distance?: string | number;
  modalities?: string[];
  tags?: string[];
  description?: string;
  isPartner?: boolean;
  isNew?: boolean;
  lowestPrice?: GuruPassMenorPreco;
  photos?: GuruPassPhoto[];
  products?: GuruPassProduct[];
  openingStatus?: GuruPassOpeningStatus;
  [key: string]: unknown;
};

export type GuruPassEstablishmentRaw = {
  id?: string;
  name?: string;
  slug?: string;
  fullAddress?: string;
  description?: string;
  phone?: string | null;
  website?: string | null;
  working_hours_text?: string | null;
  googlePlaceId?: string | null;
  neighborhood?: GuruPassNamedRef;
  city?: GuruPassNamedRef;
  state?: GuruPassNamedRef;
  openingStatus?: GuruPassOpeningStatus;
  modalities?: Array<{ name?: string }>;
  products?: GuruPassProduct[];
  lowestPrice?: GuruPassMenorPreco;
  photos?: GuruPassPhoto[];
  latitude?: string | number;
  longitude?: string | number;
  [key: string]: unknown;
};

export type GuruPassSearchResponse = {
  data?: GuruPassSearchGymRaw[];
  total?: number;
  currentPage?: number;
  totalPages?: number;
};

export type GuruPassGymNormalized = {
  id: string;
  slug: string | null;
  nome: string | null;
  endereco: string | null;
  bairro: string | null;
  cidade: string | null;
  uf: string | null;
  localizacao: { lat: string | number | null; lng: string | number | null };
  distancia_do_ponto_buscado_km: string | number | null;
  modalidades: string[];
  tags: string[];
  descricao: string | null;
  parceiro: boolean;
  novo_parceiro: boolean;
  telefone: string | null;
  site: string | null;
  horario_texto: string | null;
  google_place_id?: string | null;
  status_funcionamento: GuruPassOpeningStatus | null;
  modalidades_detalhe?: string[];
  produtos_planos: GuruPassProdutoPlano[];
  menor_preco: GuruPassMenorPreco | null;
  fotos: string[];
  url_detalhe: string | null;
  erro_ao_buscar_detalhes?: string;
};

export type GuruPassDetailSchema = {
  academia: string;
  slug: string;
  url: string;
  endereco_completo: string | null;
  descricao: string | null;
  telefone: string | null;
  site: string | null;
  horario_texto: string | null;
  google_place_id: string | null;
  bairro: string | null;
  cidade: string | null;
  estado: string | null;
  status_funcionamento: GuruPassOpeningStatus | null;
  modalidades: string[];
  produtos_planos: GuruPassProdutoPlano[];
  menor_preco: GuruPassMenorPreco | null;
  fotos: string[];
  comodidades: null;
};

const FETCH_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (compatible; GymSitePipeline/1.0)',
  'Accept-Language': 'pt-BR,pt;q=0.9',
};

const DEFAULT_MAX_RETRIES = 3;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchWithRetry(url: string, init: RequestInit, attempt = 1): Promise<Response> {
  const res = await fetch(url, init);
  if ((res.status === 429 || res.status >= 500) && attempt < DEFAULT_MAX_RETRIES) {
    const backoff = 500 * 2 ** (attempt - 1);
    await sleep(backoff);
    return fetchWithRetry(url, init, attempt + 1);
  }
  return res;
}

export function normalizeCompareText(value: string | null | undefined): string | null {
  if (value == null) return null;
  const t = value.replace(/\s+/g, ' ').trim();
  return t || null;
}

function refName(value: string | GuruPassNamedRef | undefined): string | null {
  if (value == null) return null;
  if (typeof value === 'string') return value.trim() || null;
  return value.name?.trim() || null;
}

function refUf(value: string | GuruPassNamedRef | undefined): string | null {
  if (value == null) return null;
  if (typeof value === 'string') return value.trim() || null;
  return value.code?.trim() || value.name?.trim() || null;
}

export function slugifyCity(text: string): string {
  const ascii = text
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
  return ascii || 'cidade';
}

export function detailUrl(slug: string): string {
  return `${GURUPASS_BASE_URL}/detalhes-da-academia/${slug}/`;
}

export function mapProductsToPlanos(products: GuruPassProduct[] | undefined): GuruPassProdutoPlano[] {
  return (products ?? []).map((p) => ({
    nome: p.name ?? null,
    horario: normalizeCompareText(p.description ?? null),
    creditos: typeof p.cost_credits === 'number' ? p.cost_credits : null,
    preco_centavos: typeof p.cost_cents === 'number' ? p.cost_cents : null,
  }));
}

export function photoUrls(photos: GuruPassPhoto[] | undefined): string[] {
  return (photos ?? [])
    .map((p) => p.url)
    .filter((url): url is string => typeof url === 'string' && url.length > 0);
}

export function normalizeGymFromList(raw: GuruPassSearchGymRaw): GuruPassGymNormalized {
  const id = raw.gurupass_id || raw.id || '';
  const slug = raw.slug ?? null;
  return {
    id,
    slug,
    nome: raw.name ?? null,
    endereco: raw.fullAddres ?? raw.fullAddress ?? null,
    bairro: normalizeCompareText(refName(raw.neighborhood)),
    cidade: normalizeCompareText(refName(raw.city)),
    uf: refUf(raw.state),
    localizacao: { lat: raw.latitude ?? null, lng: raw.longitude ?? null },
    distancia_do_ponto_buscado_km: raw.distance ?? null,
    modalidades: Array.isArray(raw.modalities) ? raw.modalities : [],
    tags: Array.isArray(raw.tags) ? raw.tags : [],
    descricao: raw.description ?? null,
    parceiro: Boolean(raw.isPartner),
    novo_parceiro: Boolean(raw.isNew),
    telefone: null,
    site: null,
    horario_texto: null,
    status_funcionamento: raw.openingStatus ?? null,
    produtos_planos: mapProductsToPlanos(raw.products),
    menor_preco: raw.lowestPrice ?? null,
    fotos: photoUrls(raw.photos),
    url_detalhe: slug ? detailUrl(slug) : null,
  };
}

export function establishmentToDetailSchema(
  est: GuruPassEstablishmentRaw,
  pageUrl: string,
): GuruPassDetailSchema {
  return {
    academia: est.name ?? '',
    slug: est.slug ?? '',
    url: pageUrl,
    endereco_completo: est.fullAddress ?? null,
    descricao: est.description ?? null,
    telefone: est.phone ?? null,
    site: est.website ?? null,
    horario_texto: est.working_hours_text ?? null,
    google_place_id: est.googlePlaceId ?? null,
    bairro: refName(est.neighborhood),
    cidade: refName(est.city),
    estado: refUf(est.state),
    status_funcionamento: est.openingStatus ?? null,
    modalidades: (est.modalities ?? []).map((m) => m.name).filter((n): n is string => !!n),
    produtos_planos: mapProductsToPlanos(est.products),
    menor_preco: est.lowestPrice ?? null,
    fotos: photoUrls(est.photos),
    comodidades: null,
  };
}

export function extractEstablishment(html: string): GuruPassEstablishmentRaw | null {
  return extractBalancedJson<GuruPassEstablishmentRaw>(html, 'establishment', '{', '}');
}

export function extractGuruPassDetailSchema(html: string, pageUrl: string): GuruPassDetailSchema | null {
  const est = extractEstablishment(html);
  if (!est) return null;
  return establishmentToDetailSchema(est, pageUrl);
}

export function mergeGymWithDetail(
  list: GuruPassGymNormalized,
  detail: GuruPassDetailSchema,
): GuruPassGymNormalized {
  return {
    ...list,
    endereco: detail.endereco_completo ?? list.endereco,
    descricao: detail.descricao ?? list.descricao,
    telefone: detail.telefone,
    site: detail.site,
    horario_texto: detail.horario_texto,
    google_place_id: detail.google_place_id,
    bairro: detail.bairro ?? list.bairro,
    cidade: detail.cidade ?? list.cidade,
    uf: detail.estado ?? list.uf,
    status_funcionamento: detail.status_funcionamento ?? list.status_funcionamento,
    modalidades_detalhe: detail.modalidades,
    produtos_planos: detail.produtos_planos.length ? detail.produtos_planos : list.produtos_planos,
    menor_preco: detail.menor_preco ?? list.menor_preco,
    fotos: detail.fotos.length ? detail.fotos : list.fotos,
    url_detalhe: detail.url,
  };
}

export async function fetchGuruPassDetailSchema(slug: string): Promise<GuruPassDetailSchema> {
  const url = detailUrl(slug);
  const res = await fetchWithRetry(url, { headers: FETCH_HEADERS });
  if (!res.ok) throw new Error(`HTTP ${res.status} em ${url}`);
  const html = await res.text();
  const schema = extractGuruPassDetailSchema(html, url);
  if (!schema) throw new Error(`objeto 'establishment' não encontrado em ${url}`);
  return schema;
}

export function buildSearchUrl(citySlug: string, page: number, limit = GURUPASS_PAGE_LIMIT): string {
  const params = new URLSearchParams({
    citySlug,
    page: String(page),
    limit: String(limit),
  });
  return `${GURUPASS_SEARCH_ENDPOINT}?${params.toString()}`;
}

export async function fetchSearchPage(
  citySlug: string,
  page: number,
  limit = GURUPASS_PAGE_LIMIT,
): Promise<GuruPassSearchResponse> {
  const url = buildSearchUrl(citySlug, page, limit);
  const res = await fetchWithRetry(url, {
    headers: { ...FETCH_HEADERS, Accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${url}`);
  return (await res.json()) as GuruPassSearchResponse;
}

export type ListSearchRawOptions = {
  limit?: number;
  maxPages?: number;
  delayMs?: number;
};

export async function listSearchRawByCitySlug(
  citySlug: string,
  options: ListSearchRawOptions = {},
): Promise<{ rows: GuruPassSearchGymRaw[]; total: number; totalPages: number }> {
  const limit = options.limit ?? GURUPASS_PAGE_LIMIT;
  const maxPages = options.maxPages ?? 0;
  const delayMs = options.delayMs ?? 0;

  const first = await fetchSearchPage(citySlug, 1, limit);
  const total = first.total ?? 0;
  const totalPages = first.totalPages ?? 1;
  const cap = maxPages > 0 ? Math.min(maxPages, totalPages) : totalPages;
  const rows: GuruPassSearchGymRaw[] = [...(first.data ?? [])];

  for (let page = 2; page <= cap; page += 1) {
    if (delayMs > 0) await sleep(Math.min(delayMs, 300));
    const data = await fetchSearchPage(citySlug, page, limit);
    const chunk = data.data ?? [];
    if (!chunk.length) break;
    rows.push(...chunk);
  }

  return { rows, total, totalPages };
}

export async function listGymsByCitySlug(
  citySlug: string,
  options: ListSearchRawOptions = {},
): Promise<{ gyms: GuruPassGymNormalized[]; total: number; totalPages: number }> {
  const { rows, total, totalPages } = await listSearchRawByCitySlug(citySlug, options);
  return { gyms: rows.map(normalizeGymFromList), total, totalPages };
}
