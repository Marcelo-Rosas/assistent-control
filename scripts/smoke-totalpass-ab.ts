/**
 * Smoke A/B: nosso scraper vs lógica do totalpass_scraper.py (Poá-SP).
 * Run: npx tsx scripts/smoke-totalpass-ab.ts
 */
import fs from 'fs/promises';
import path from 'path';

const BASE = 'https://totalpass.com';
const STORED_PATH = path.join(process.cwd(), 'data/raw/totalpass-brasil-all.json');
const POA = { nome: 'Poá', uf: 'SP', lat: -23.5333, lng: -46.3473 };
const RESULT_CAP = 200;

type Gym = {
  id: string;
  attributes: {
    name?: string;
    slug?: string;
    full_address?: string;
    location?: { lat?: number; lng?: number };
    accessible_on_plans?: Array<{ name?: string; price?: number }>;
    accessible_from_company_plan?: { name?: string; price?: number };
    warning_message?: string;
    municipios_relacionados?: string[];
    municipios_busca?: string[];
    [k: string]: unknown;
  };
};

const headers = {
  Accept: 'application/json',
  'User-Agent': 'Mozilla/5.0 (compatible; TotalPassScraperTemplate/1.0)',
  'Accept-Language': 'pt-BR,pt;q=0.9',
};

function norm(s: string): string {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

async function geocodeCity(query: string): Promise<{ lat: number; lng: number; formatted: string }> {
  const places = await fetch(
    `${BASE}/api/website/places?${new URLSearchParams({ street: query, locale: 'pt-BR' })}`,
    { headers },
  );
  if (!places.ok) throw new Error(`places HTTP ${places.status}`);
  const pj = (await places.json()) as { data?: Array<{ attributes: { place_id: string; formatted_address: string } }> };
  const first = pj.data?.[0];
  if (!first) throw new Error(`no geocode for ${query}`);
  const place = await fetch(
    `${BASE}/api/website/place?${new URLSearchParams({ place: first.attributes.place_id, locale: 'pt-BR' })}`,
    { headers },
  );
  if (!place.ok) throw new Error(`place HTTP ${place.status}`);
  const pj2 = (await place.json()) as { data: { attributes: { latitude: number; longitude: number } } };
  return {
    lat: pj2.data.attributes.latitude,
    lng: pj2.data.attributes.longitude,
    formatted: first.attributes.formatted_address,
  };
}

async function fetchGymsRaw(lat: number, lng: number, km: number): Promise<Gym[]> {
  const params = new URLSearchParams({
    locale: 'pt-BR',
    'current_location[latitude]': String(lat),
    'current_location[longitude]': String(lng),
    'location[latitude]': String(lat),
    'location[longitude]': String(lng),
    km_radius: String(km),
  });
  const res = await fetch(`${BASE}/api/website/gyms?${params}`, { headers });
  if (!res.ok) throw new Error(`gyms HTTP ${res.status}`);
  const json = (await res.json()) as { data?: Gym[] };
  return Array.isArray(json.data) ? json.data : [];
}

async function listGymsTiled(
  lat: number,
  lng: number,
  km: number,
  seen = new Map<string, Gym>(),
  depth = 0,
): Promise<Gym[]> {
  const gyms = await fetchGymsRaw(lat, lng, km);
  for (const g of gyms) seen.set(g.id, g);
  if (gyms.length >= RESULT_CAP && km > 1.5 && depth < 4) {
    const offsetDeg = km / 2 / 111;
    const subRadius = km / 1.5;
    const quads = [
      [lat + offsetDeg, lng + offsetDeg],
      [lat + offsetDeg, lng - offsetDeg],
      [lat - offsetDeg, lng + offsetDeg],
      [lat - offsetDeg, lng - offsetDeg],
    ] as const;
    for (const [la, ln] of quads) {
      await listGymsTiled(la, ln, subRadius, seen, depth + 1);
    }
  }
  return [...seen.values()];
}

async function fetchGridOurs(lat: number, lng: number, km: number, offset = 0.045): Promise<Gym[]> {
  const map = new Map<string, Gym>();
  for (let i = -1; i <= 1; i++) {
    for (let j = -1; j <= 1; j++) {
      const rows = await fetchGymsRaw(lat + i * offset, lng + j * offset, km);
      for (const g of rows) map.set(g.id, g);
    }
  }
  return [...map.values()];
}

function unescapeJsString(s: string): string {
  try {
    return JSON.parse(`"${s}"`) as string;
  } catch {
    return s;
  }
}

function scalarField(html: string, key: string): string | null {
  const m = html.match(new RegExp(`\\\\"${key}\\\\":\\\\"(.*?)\\\\"`));
  return m ? unescapeJsString(m[1]) : null;
}

function arrayBlock(html: string, key: string): string | null {
  const m = html.match(new RegExp(`\\\\"${key}\\\\":\\[(.*?)\\]`));
  return m ? m[1] : null;
}

function extractModalidades(html: string): string[] {
  const block = arrayBlock(html, 'modalities');
  if (!block) return [];
  return [...block.matchAll(/\\"translated_name\\":\\"(.*?)\\"/g)].map((m) => unescapeJsString(m[1]));
}

function extractJsonLd(html: string): Record<string, unknown> {
  const m = html.match(/<script type="application\/ld\+json">(.*?)<\/script>/s);
  if (!m) return {};
  try {
    return JSON.parse(m[1]) as Record<string, unknown>;
  } catch {
    return {};
  }
}

async function scrapeDetail(slug: string): Promise<Record<string, unknown>> {
  const url = `${BASE}/br/academias/${slug}/`;
  const res = await fetch(url, {
    headers: { 'User-Agent': headers['User-Agent'], 'Accept-Language': headers['Accept-Language'] },
  });
  if (!res.ok) throw new Error(`detail HTTP ${res.status}`);
  const html = await res.text();
  const jsonld = extractJsonLd(html);
  return {
    url,
    jsonld_address: jsonld.address,
    jsonld_phone: jsonld.telephone,
    jsonld_hours: jsonld.openingHours,
    modalidades: extractModalidades(html),
    email: scalarField(html, 'email'),
    instagram_ou_site: scalarField(html, 'website'),
  };
}

function listFieldCoverage(gyms: Gym[]): Record<string, number> {
  const keys = ['name', 'slug', 'full_address', 'location', 'plans', 'min_plan'] as const;
  const out: Record<string, number> = {};
  for (const k of keys) {
    out[k] = gyms.filter((g) => {
      const a = g.attributes;
      if (k === 'location') return !!(a.location?.lat && a.location?.lng);
      if (k === 'plans') return Array.isArray(a.accessible_on_plans) && a.accessible_on_plans.length > 0;
      if (k === 'min_plan') return !!a.accessible_from_company_plan;
      return !!a[k as 'name' | 'slug' | 'full_address'];
    }).length;
  }
  return out;
}

async function main(): Promise<void> {
  const radius = 10;
  const geo = await geocodeCity(`${POA.nome}, ${POA.uf}`);

  const [oursSingle5, oursSingle10, oursGrid5, oursGrid10, pySingle10, pyTiled10] = await Promise.all([
    fetchGymsRaw(POA.lat, POA.lng, 5),
    fetchGymsRaw(POA.lat, POA.lng, radius),
    fetchGridOurs(POA.lat, POA.lng, 5),
    fetchGridOurs(POA.lat, POA.lng, radius),
    fetchGymsRaw(geo.lat, geo.lng, radius),
    listGymsTiled(geo.lat, geo.lng, radius),
  ]);

  let storedPoa = 0;
  try {
    const raw = JSON.parse(await fs.readFile(STORED_PATH, 'utf-8')) as { data: Gym[] };
    storedPoa = raw.data.filter((g) => {
      const rel = (g.attributes.municipios_relacionados || []).map(norm);
      const busca = (g.attributes.municipios_busca || []).map(norm);
      return rel.includes('poa') || busca.includes('poa');
    }).length;
  } catch {
    // ignore
  }

  const detailSamples = [];
  for (const g of pyTiled10.slice(0, 3)) {
    const slug = g.attributes.slug;
    if (!slug) continue;
    try {
      detailSamples.push({ nome: g.attributes.name, ...(await scrapeDetail(slug)) });
    } catch (err) {
      detailSamples.push({ nome: g.attributes.name, error: err instanceof Error ? err.message : String(err) });
    }
  }

  const listOnlyFields = listFieldCoverage(pyTiled10);
  const detailModalidades = detailSamples.filter((d) => Array.isArray(d.modalidades) && d.modalidades.length > 0).length;
  const detailJsonLd = detailSamples.filter((d) => d.jsonld_address).length;

  const report = {
    cidade: 'Poá, SP',
    geocode: geo,
    cobertura: {
      nosso_pipeline_km5_single: oursSingle5.length,
      nosso_pipeline_km10_single: oursSingle10.length,
      nosso_pipeline_km5_grid3x3: oursGrid5.length,
      nosso_pipeline_km10_grid3x3: oursGrid10.length,
      nosso_stored_attributed_poa: storedPoa,
      python_like_km10_single: pySingle10.length,
      python_like_km10_tiled: pyTiled10.length,
      python_hit_cap_single: pySingle10.length >= RESULT_CAP,
    },
    qualidade_list_api_pct: Object.fromEntries(
      Object.entries(listFieldCoverage(pyTiled10)).map(([k, n]) => [k, `${((n / pyTiled10.length) * 100).toFixed(0)}%`]),
    ),
    qualidade_detail_3_amostras: {
      com_jsonld_endereco: detailJsonLd,
      com_modalidades_regex: detailModalidades,
      amostras: detailSamples,
    },
    veredito: {
      melhor_cobertura: pyTiled10.length > oursGrid10.length ? 'python_tiled' : oursGrid10.length > pyTiled10.length ? 'nosso_grid' : 'empate',
      melhor_qualidade_resposta: 'python_detail (JSON-LD + modalidades/email/instagram) > list API pura',
      nosso_producao_atual: `usa km5 single (${storedPoa} gyms) — subcaptura vs grid/tiled`,
    },
  };

  console.log(JSON.stringify(report, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
