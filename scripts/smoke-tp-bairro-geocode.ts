/**
 * Smoke F2 — reverse geocode TP em POA + SP (amostra).
 * Run: npm run smoke:tp-bairro-geocode
 */
import fs from 'fs/promises';
import path from 'path';
import { reverseGeocodeBairro } from './lib/tpBairroResolver.ts';

const ROOT = process.cwd();
const SAMPLES = [
  { label: 'Salvador IAPI', lat: -12.9570725, lng: -38.487795 },
  { label: 'POA Farroupilha', lat: -30.0346, lng: -51.2177 },
];

type ListGym = {
  id: string;
  attributes?: {
    name?: string;
    location?: { lat?: number; lng?: number };
    municipios_busca?: string[];
  };
};

async function sampleFromRaw(cidade: string, limit: number): Promise<ListGym[]> {
  const raw = JSON.parse(
    await fs.readFile(path.join(ROOT, 'data/raw/totalpass-brasil-all.json'), 'utf8'),
  ) as { data?: ListGym[] };
  const out: ListGym[] = [];
  for (const g of raw.data ?? []) {
    const busca = g.attributes?.municipios_busca ?? [];
    if (!busca.some((m) => m.toLowerCase().includes(cidade.toLowerCase()))) continue;
    const lat = Number(g.attributes?.location?.lat);
    const lng = Number(g.attributes?.location?.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    out.push(g);
    if (out.length >= limit) break;
  }
  return out;
}

async function main(): Promise<void> {
  console.log('Smoke TP bairro geocode\n');

  for (const s of SAMPLES) {
    const r = await reverseGeocodeBairro(s.lat, s.lng);
    console.log(`${s.label}: ${r ? `${r.bairro} (${r.bairro_slug})` : 'FAIL'}`);
    await new Promise((res) => setTimeout(res, 1100));
  }

  console.log('\n--- POA sample (5 gyms) ---');
  const poa = await sampleFromRaw('Porto Alegre', 5);
  for (const g of poa) {
    const lat = Number(g.attributes!.location!.lat);
    const lng = Number(g.attributes!.location!.lng);
    const r = await reverseGeocodeBairro(lat, lng);
    const name = g.attributes?.name ?? g.id.slice(0, 8);
    console.log(`${name}: ${r?.bairro ?? 'FAIL'}`);
    await new Promise((res) => setTimeout(res, 1100));
  }

  console.log('\n--- SP sample (5 gyms) ---');
  const sp = await sampleFromRaw('São Paulo', 5);
  for (const g of sp) {
    const lat = Number(g.attributes!.location!.lat);
    const lng = Number(g.attributes!.location!.lng);
    const r = await reverseGeocodeBairro(lat, lng);
    const name = g.attributes?.name ?? g.id.slice(0, 8);
    console.log(`${name}: ${r?.bairro ?? 'FAIL'}`);
    await new Promise((res) => setTimeout(res, 1100));
  }

  console.log('\nSmoke OK');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
