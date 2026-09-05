/**
 * Smoke — parse bairro de detail.endereco somente nas falhas do tp-bairro-index.
 * ⚠️ Benchmark exploratório — NÃO é estratégia de produção (ver spec tp-bairro-cep-design).
 *
 * Run: npm run smoke:tp-detail-bairro-failures
 *
 * Output: data/processed/tp-detail-bairro-failures-smoke.json
 */
import fs from 'fs/promises';
import path from 'path';
import { loadTpBairroIndex } from './lib/tpBairroResolver.ts';
import { parseBairroFromDetailEndereco } from './lib/tpDetailEnderecoParser.ts';

const ROOT = process.cwd();
const INDEX_PATH = path.join(ROOT, 'data/processed/tp-bairro-index.json');
const ENRICH_DIR = path.join(ROOT, 'data/processed/totalpass-enriched/by-id');
const RAW_PATH = path.join(ROOT, 'data/raw/totalpass-brasil-all.json');
const OUT_PATH = path.join(ROOT, 'data/processed/tp-detail-bairro-failures-smoke.json');

type ListGym = {
  id: string;
  attributes?: {
    name?: string;
    slug?: string;
    municipios_busca?: string[];
    municipios_relacionados?: string[];
    uf?: string;
  };
};

type EnrichedRecord = {
  gym_id: string;
  slug?: string;
  detail?: { endereco?: string };
  list?: {
    municipios_busca?: string[];
    municipios_relacionados?: string[];
  };
};

type SmokeRow = {
  gym_id: string;
  name: string | null;
  slug: string | null;
  status: 'resolved' | 'no_enrich' | 'empty_endereco' | 'parse_fail';
  endereco: string | null;
  bairro: string | null;
  bairro_slug: string | null;
  cidade: string | null;
  nominatim_error: string;
};

async function main(): Promise<void> {
  console.log('Smoke TP detail bairro — somente falhas Nominatim\n');

  const index = await loadTpBairroIndex(INDEX_PATH);
  if (!index) throw new Error(`Index ausente: ${INDEX_PATH}`);

  const failures = index.failures ?? [];
  console.log(`Falhas no index: ${failures.length}`);

  const raw = JSON.parse(await fs.readFile(RAW_PATH, 'utf8')) as { data?: ListGym[] };
  const gymById = new Map((raw.data ?? []).map((g) => [g.id, g]));

  const rows: SmokeRow[] = [];
  const stats = {
    total_failures: failures.length,
    resolved: 0,
    no_enrich: 0,
    empty_endereco: 0,
    parse_fail: 0,
  };

  for (const f of failures) {
    const gym = gymById.get(f.gym_id);
    const name = gym?.attributes?.name ?? null;
    const slug = gym?.attributes?.slug ?? null;
    const cidade =
      gym?.attributes?.municipios_busca?.[0] ??
      gym?.attributes?.municipios_relacionados?.[0] ??
      null;
    const uf = gym?.attributes?.uf ?? null;

    const enrichPath = path.join(ENRICH_DIR, `${f.gym_id}.json`);
    let enriched: EnrichedRecord | null = null;
    try {
      enriched = JSON.parse(await fs.readFile(enrichPath, 'utf8')) as EnrichedRecord;
    } catch {
      stats.no_enrich += 1;
      rows.push({
        gym_id: f.gym_id,
        name,
        slug,
        status: 'no_enrich',
        endereco: null,
        bairro: null,
        bairro_slug: null,
        cidade,
        nominatim_error: f.error,
      });
      continue;
    }

    const endereco = enriched.detail?.endereco?.trim() ?? '';
    const cidadeEnrich =
      enriched.list?.municipios_busca?.[0] ??
      enriched.list?.municipios_relacionados?.[0] ??
      cidade;

    if (!endereco) {
      stats.empty_endereco += 1;
      rows.push({
        gym_id: f.gym_id,
        name,
        slug,
        status: 'empty_endereco',
        endereco: null,
        bairro: null,
        bairro_slug: null,
        cidade: cidadeEnrich,
        nominatim_error: f.error,
      });
      continue;
    }

    const parsed = parseBairroFromDetailEndereco(endereco, {
      cidade: cidadeEnrich,
      uf,
    });

    if (!parsed) {
      stats.parse_fail += 1;
      rows.push({
        gym_id: f.gym_id,
        name,
        slug,
        status: 'parse_fail',
        endereco,
        bairro: null,
        bairro_slug: null,
        cidade: cidadeEnrich,
        nominatim_error: f.error,
      });
      continue;
    }

    stats.resolved += 1;
    rows.push({
      gym_id: f.gym_id,
      name,
      slug,
      status: 'resolved',
      endereco,
      bairro: parsed.bairro,
      bairro_slug: parsed.bairro_slug,
      cidade: parsed.cidade ?? cidadeEnrich,
      nominatim_error: f.error,
    });
  }

  const pct = failures.length
    ? ((stats.resolved / failures.length) * 100).toFixed(1)
    : '0.0';

  const report = {
    generated_at: new Date().toISOString(),
    stats,
    resolved_pct: Number(pct),
    samples: {
      resolved: rows.filter((r) => r.status === 'resolved').slice(0, 10),
      parse_fail: rows.filter((r) => r.status === 'parse_fail').slice(0, 10),
    },
    rows,
  };

  await fs.mkdir(path.dirname(OUT_PATH), { recursive: true });
  await fs.writeFile(OUT_PATH, JSON.stringify(report, null, 2), 'utf8');

  console.log('\n=== Resumo ===');
  console.log(`Falhas Nominatim:     ${stats.total_failures}`);
  console.log(`Resolved via detail:  ${stats.resolved} (${pct}%)`);
  console.log(`Sem enrich:           ${stats.no_enrich}`);
  console.log(`Endereco vazio:       ${stats.empty_endereco}`);
  console.log(`Parse fail:           ${stats.parse_fail}`);
  console.log(`\nReport: ${OUT_PATH}`);

  if (stats.resolved > 0) {
    console.log('\n--- Amostra resolved ---');
    for (const r of report.samples.resolved.slice(0, 5)) {
      console.log(`  ${r.name ?? r.gym_id.slice(0, 8)} → ${r.bairro} (${r.bairro_slug})`);
    }
  }

  if (stats.parse_fail > 0) {
    console.log('\n--- Amostra parse_fail ---');
    for (const r of report.samples.parse_fail.slice(0, 5)) {
      console.log(`  ${r.name ?? r.gym_id.slice(0, 8)}: "${r.endereco}"`);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
