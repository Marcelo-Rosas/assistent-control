/**
 * Smoke compare: nosso scraper TotalPass vs Python (Poá-SP).
 * Run: npx tsx scripts/smoke-totalpass-compare.ts [cidade] [radiusKm]
 */
import fs from 'fs/promises';
import path from 'path';

const API_BASE = 'https://totalpass.com/api/website/gyms/';
const ROOT = process.cwd();
const STORED_PATH = path.join(ROOT, 'data/raw/totalpass-brasil-all.json');

type Gym = {
  id: string;
  attributes: {
    name?: string;
    slug?: string;
    full_address?: string;
    location?: { lat?: number; lng?: number };
    accessible_on_plans?: Array<{ name?: string; price?: number }>;
    accessible_from_company_plan?: { name?: string; price?: number };
    municipios_relacionados?: string[];
    municipios_busca?: string[];
    warning_message?: string;
    [k: string]: unknown;
  };
};

const POA = { nome: 'Poá', uf: 'SP', ibge: '3539806', lat: -23.5333, lng: -46.3473 };

function norm(s: string): string {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

async function fetchPoint(lat: number, lng: number, km: number): Promise<Gym[]> {
  const params = new URLSearchParams({
    locale: 'pt-BR',
    'current_location[latitude]': String(lat),
    'current_location[longitude]': String(lng),
    'location[latitude]': String(lat),
    'location[longitude]': String(lng),
    km_radius: String(km),
  });
  const res = await fetch(`${API_BASE}?${params}`, {
    headers: { Accept: 'application/json', 'User-Agent': 'GymSiteSmoke/1.0' },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = (await res.json()) as { data?: Gym[] };
  return Array.isArray(json.data) ? json.data : [];
}

async function fetchGrid(lat: number, lng: number, km: number, offset = 0.045): Promise<Gym[]> {
  const map = new Map<string, Gym>();
  for (let i = -1; i <= 1; i++) {
    for (let j = -1; j <= 1; j++) {
      const rows = await fetchPoint(lat + i * offset, lng + j * offset, km);
      for (const g of rows) map.set(g.id, g);
    }
  }
  return [...map.values()];
}

function fieldScore(g: Gym): Record<string, boolean> {
  const a = g.attributes;
  return {
    name: !!a.name,
    slug: !!a.slug,
    full_address: !!a.full_address,
    location: !!(a.location?.lat && a.location?.lng),
    plans: Array.isArray(a.accessible_on_plans) && a.accessible_on_plans.length > 0,
    min_plan: !!a.accessible_from_company_plan,
    warning: !!a.warning_message,
    municipios_relacionados: (a.municipios_relacionados?.length || 0) > 0,
  };
}

async function main(): Promise<void> {
  const city = process.argv[2] || 'Poá';
  const radius = Number(process.argv[3] || 10);
  const m = POA;

  const ours5 = await fetchPoint(m.lat, m.lng, 5);
  const ours10 = await fetchPoint(m.lat, m.lng, radius);
  const oursGrid5 = await fetchGrid(m.lat, m.lng, 5);
  const oursGrid10 = await fetchGrid(m.lat, m.lng, radius);

  let storedPoa: Gym[] = [];
  try {
    const raw = JSON.parse(await fs.readFile(STORED_PATH, 'utf-8')) as { data: Gym[] };
    storedPoa = raw.data.filter((g) => {
      const rel = (g.attributes.municipios_relacionados || []).map(norm);
      const busca = (g.attributes.municipios_busca || []).map(norm);
      return rel.includes('poa') || busca.includes('poa');
    });
  } catch {
    // ignore
  }

  const sample = (oursGrid10[0] || ours10[0]) as Gym | undefined;
  const fields = sample ? fieldScore(sample) : {};

  const report = {
    city: `${city}, ${m.uf}`,
    coords: { lat: m.lat, lng: m.lng },
    ours: {
      single_km5: ours5.length,
      single_km10: ours10.length,
      grid3x3_km5: oursGrid5.length,
      grid3x3_km10: oursGrid10.length,
      stored_attributed_poa: storedPoa.length,
      sample_fields_from_list_api: fields,
      sample_plans: sample?.attributes.accessible_on_plans?.slice(0, 3) || [],
      sample_names: oursGrid10.slice(0, 5).map((g) => g.attributes.name),
    },
  };

  console.log(JSON.stringify(report, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
