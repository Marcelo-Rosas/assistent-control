/**
 * ingest-gurupass-canonical.mjs
 * Accept-geo: lista academias que ACEITAM Gurupass no geo alvo.
 * Fonte aceite = GP_ACCEPT_FIXTURE (buscar-academias export).
 * Planos/preços = out_of_scope neste ciclo.
 * Maps GEO_FIXTURE = contexto opcional (não define aceite).
 *
 * Hot smoke (PowerShell):
 *   $env:GP_ACCEPT_FIXTURE="ingest/fixtures/gp-accept-coco.json"
 *   node scripts/ingest-gurupass-canonical.mjs
 */

import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  catalogOutOfScope,
  resolveAcceptList,
  slug,
} from './lib/gpAcceptGeo.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

const GEO = {
  bairro: process.env.BAIRRO || 'Cocó',
  cidade: process.env.CIDADE || 'Fortaleza',
  uf: process.env.UF || 'CE',
};
const GP_ACCEPT_FIXTURE = process.env.GP_ACCEPT_FIXTURE || '';
const REQUIRE_ACCEPT_FIXTURE = process.env.REQUIRE_ACCEPT_FIXTURE === '1';
const GEO_FIXTURE = process.env.GEO_FIXTURE || '';
const GP_ACCEPT_REFRESH = process.env.GP_ACCEPT_REFRESH === '1';

function loadMapsContext() {
  if (!GEO_FIXTURE) return null;
  const abs = isAbsolute(GEO_FIXTURE) ? GEO_FIXTURE : join(ROOT, GEO_FIXTURE);
  return {
    source: { method: 'geo_fixture', fixture: GEO_FIXTURE },
    note: 'Maps context only — does not define GP acceptance',
    exists: existsSync(abs),
  };
}

function buildArtifact({ catalog, acceptResolved, mapsContext }) {
  const runId = new Date().toISOString().replace(/[:.]/g, '-');
  const accept_list = acceptResolved.accept_list;
  return {
    schema_version: 1,
    ingest_kind: 'gurupass_accept_geo',
    aggregator: 'gurupass',
    run_id: runId,
    geo: GEO,
    catalog,
    accept_source: acceptResolved.source,
    accept_warnings: acceptResolved.warnings,
    accept_list,
    summary: {
      gp_accept_count: accept_list.length,
      target_geo: GEO,
    },
    maps_context: mapsContext,
    cold_refresh: {
      env: 'GP_ACCEPT_REFRESH',
      requested: GP_ACCEPT_REFRESH,
      status: GP_ACCEPT_REFRESH ? 'not_implemented_stub' : 'idle',
      note: 'Cold browser → buscar-academias/ rewrites GP_ACCEPT_FIXTURE; follow-up',
    },
    rag_chunks: [
      {
        id: `gp-accept-${slug(GEO.cidade)}-${slug(GEO.bairro || 'all')}`,
        type: 'gp_accept_geo',
        text: `Gurupass aceita em ${GEO.bairro || '*'}, ${GEO.cidade}-${GEO.uf}: ${accept_list.length} academias | ${accept_list
          .map((i) => i.name)
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
        hint: 'Populate ingest/fixtures/gp-accept-*.json manually for hot path',
      }),
    );
    process.exit(2);
  }

  const catalog = catalogOutOfScope();
  const acceptResolved = resolveAcceptList({
    fixturePath: GP_ACCEPT_FIXTURE,
    root: ROOT,
    targetGeo: GEO,
    requireFixture: REQUIRE_ACCEPT_FIXTURE,
  });

  const mapsContext = loadMapsContext();
  const artifact = buildArtifact({ catalog, acceptResolved, mapsContext });
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
        accept_names: artifact.accept_list.map((i) => i.name),
        warnings: artifact.accept_warnings,
        catalog_status: catalog.plan.status,
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
