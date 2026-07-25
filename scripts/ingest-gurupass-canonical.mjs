/**
 * ingest-gurupass-canonical.mjs
 * Accept + plano_minimo: academias GP no geo com crédito mínimo (Ilimitado N).
 * Fonte = GP_ACCEPT_FIXTURE (export buscar-academias — items[] ou academias[]).
 * Gate opcional: GP_USER_CREDITS ou GP_USER_PLAN="Ilimitado 35"
 *   → academia entra se creditos_minimos ≤ user credits.
 *
 * Hot smoke (PowerShell):
 *   $env:GP_ACCEPT_FIXTURE="ingest/fixtures/gp-accept-fortaleza.json"
 *   $env:BAIRRO=""
 *   $env:GP_USER_CREDITS="35"
 *   node scripts/ingest-gurupass-canonical.mjs
 */

import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  parseCreditsFromPlan,
  resolveAcceptList,
  slug,
} from './lib/gpAcceptGeo.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

const GEO = {
  // empty bairro = city-wide (Fortaleza list from buscar-academias)
  bairro: process.env.BAIRRO != null ? process.env.BAIRRO : '',
  cidade: process.env.CIDADE || 'Fortaleza',
  uf: process.env.UF || 'CE',
};
const GP_ACCEPT_FIXTURE =
  process.env.GP_ACCEPT_FIXTURE ||
  'ingest/fixtures/gp-accept-fortaleza.json';
const REQUIRE_ACCEPT_FIXTURE = process.env.REQUIRE_ACCEPT_FIXTURE === '1';
const GEO_FIXTURE = process.env.GEO_FIXTURE || '';
const GP_ACCEPT_REFRESH = process.env.GP_ACCEPT_REFRESH === '1';

function resolveUserCredits() {
  if (process.env.GP_USER_CREDITS != null && process.env.GP_USER_CREDITS !== '') {
    return Number(process.env.GP_USER_CREDITS);
  }
  if (process.env.GP_USER_PLAN) {
    return parseCreditsFromPlan(process.env.GP_USER_PLAN);
  }
  return null;
}

function loadMapsContext() {
  if (!GEO_FIXTURE) return null;
  const abs = isAbsolute(GEO_FIXTURE) ? GEO_FIXTURE : join(ROOT, GEO_FIXTURE);
  return {
    source: { method: 'geo_fixture', fixture: GEO_FIXTURE },
    note: 'Maps context only — does not define GP acceptance',
    exists: existsSync(abs),
  };
}

function buildArtifact({ acceptResolved, mapsContext, userCredits }) {
  const runId = new Date().toISOString().replace(/[:.]/g, '-');
  const accept_list = acceptResolved.accept_list;
  return {
    schema_version: 1,
    ingest_kind: 'gurupass_accept_plan_geo',
    aggregator: 'gurupass',
    run_id: runId,
    geo: GEO,
    user_plan: {
      credits: userCredits,
      plan: process.env.GP_USER_PLAN || null,
      rule: 'creditos_minimos <= user_credits (a partir de)',
    },
    catalog: acceptResolved.catalog,
    accept_source: acceptResolved.source,
    accept_warnings: acceptResolved.warnings,
    accept_list,
    summary: {
      gp_accept_count: accept_list.length,
      geo_count: acceptResolved.source?.geo_count ?? accept_list.length,
      target_geo: GEO,
      user_credits: userCredits,
    },
    maps_context: mapsContext,
    cold_refresh: {
      env: 'GP_ACCEPT_REFRESH',
      requested: GP_ACCEPT_REFRESH,
      status: GP_ACCEPT_REFRESH ? 'not_implemented_stub' : 'idle',
      note: 'Cold browser → buscar-academias/ rewrites fixture with plano_minimo; follow-up',
    },
    rag_chunks: [
      {
        id: `gp-accept-${slug(GEO.cidade)}-${slug(GEO.bairro || 'city')}`,
        type: 'gp_accept_plan_geo',
        text: `Gurupass ${GEO.bairro || 'cidade'} ${GEO.cidade}-${GEO.uf}: ${accept_list.length} academias (user_credits=${userCredits ?? 'any'}) | ${accept_list
          .map(
            (i) =>
              `${i.name} ≥${i.plano_minimo || i.creditos_minimos} R$${i.valor_mensal_brl ?? '?'}`,
          )
          .slice(0, 12)
          .join('; ')}`,
      },
    ],
  };
}

async function main() {
  if (GP_ACCEPT_REFRESH) {
    console.error(
      JSON.stringify({
        error: 'GP_ACCEPT_REFRESH not implemented — stub only',
        hint: 'Export buscar-academias JSON (academias[].plano_minimo) into ingest/fixtures/',
      }),
    );
    process.exit(2);
  }

  const userCredits = resolveUserCredits();
  const acceptResolved = resolveAcceptList({
    fixturePath: GP_ACCEPT_FIXTURE,
    root: ROOT,
    targetGeo: GEO,
    requireFixture: REQUIRE_ACCEPT_FIXTURE,
    userCredits,
  });

  const mapsContext = loadMapsContext();
  const artifact = buildArtifact({ acceptResolved, mapsContext, userCredits });
  const outDir = join(ROOT, 'ingest', 'gurupass');
  mkdirSync(outDir, { recursive: true });
  const out = join(outDir, `${artifact.run_id}.json`);
  writeFileSync(out, JSON.stringify(artifact, null, 2), 'utf8');
  console.log(
    JSON.stringify(
      {
        out: out.replace(ROOT + '\\', '').replace(ROOT + '/', ''),
        aggregator: 'gurupass',
        ingest_kind: artifact.ingest_kind,
        gp_accept_count: artifact.summary.gp_accept_count,
        geo_count: artifact.summary.geo_count,
        user_credits: userCredits,
        accept_preview: artifact.accept_list.map((i) => ({
          name: i.name,
          bairro: i.bairro,
          plano_minimo: i.plano_minimo,
          valor_mensal_brl: i.valor_mensal_brl,
        })),
        catalog_plans: artifact.catalog.plans?.length ?? 0,
        warnings: artifact.accept_warnings,
      },
      null,
      2,
    ),
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
