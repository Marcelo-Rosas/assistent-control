/**
 * Auditoria visual: cobertura de bairros por município × agregador (WH/TP/GP).
 *
 * Run: npx tsx scripts/audit-bairro-coverage.ts
 *      npx tsx scripts/audit-bairro-coverage.ts --uf=SP
 *      npm run audit:bairro-coverage
 */
import fs from 'fs/promises';
import path from 'path';
import { cidadeKey } from './lib/academia-normalize.ts';
import {
  buildMunicipioCoverageRows,
  buildReceitaBairrosFromJson,
  loadBairrosCatalogs,
  summarizeReport,
  type BairroCoverageAuditReport,
  type TpIndexAuditStats,
} from './lib/bairroCoverageAudit.ts';
import { MUNICIPIO_TIER_DEFINITION } from './lib/municipioTier.ts';

const ROOT = process.cwd();
const UF_ARG = process.argv.find((a) => a.startsWith('--uf='))?.split('=')[1]?.toUpperCase() ?? null;

async function readJson<T>(p: string, fallback: T): Promise<T> {
  try {
    const raw = await fs.readFile(p, 'utf8');
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function pct(num: number, den: number): number | null {
  if (den <= 0) return null;
  return Math.round((num / den) * 1000) / 10;
}

async function main() {
  console.log(`Audit bairro coverage${UF_ARG ? ` UF=${UF_ARG}` : ' (BR)'}`);

  const municipios = await readJson<
    Array<{ nome: string; uf: string; ibge?: string; populacao?: number }>
  >(path.join(ROOT, 'data/municipios-brasil.json'), []);

  const whRaw = await readJson<{ data?: unknown[] }>(
    path.join(ROOT, 'data/raw/wellhub-brasil-all.json'),
    { data: [] },
  );
  const tpRaw = await readJson<{ data?: unknown[] }>(
    path.join(ROOT, 'data/raw/totalpass-brasil-all.json'),
    { data: [] },
  );
  const gpRaw = await readJson<{ data?: unknown[] }>(
    path.join(ROOT, 'data/raw/gurupass-brasil-all.json'),
    { data: [] },
  );

  const catalogs = await loadBairrosCatalogs(path.join(ROOT, 'data/geo/bairros'));
  console.log(`Catálogos bairro: ${catalogs.size} município(s)`);

  console.log('Carregando referência Receita CNAE 9313100...');
  const receitaByIbge = buildReceitaBairrosFromJson(
    path.join(ROOT, 'data/processed/receita-cnae-9313100-principal-ativos.json'),
  );
  console.log(`Receita IBGE refs: ${receitaByIbge.size} municípios com bairro`);

  const progressRaw = await readJson<{
    completed?: Array<{
      cidade?: string;
      uf?: string;
      bairros_planned?: number;
      bairros_done?: number;
    }>;
  }>(path.join(ROOT, 'data/processed/wellhub-progress.json'), {});

  const whProgress: Record<string, { bairros_planned?: number; bairros_done?: number }> = {};
  for (const c of progressRaw.completed ?? []) {
    if (!c.cidade || !c.uf) continue;
    whProgress[cidadeKey(c.cidade, c.uf)] = {
      bairros_planned: c.bairros_planned,
      bairros_done: c.bairros_done,
    };
  }

  const tpBairroRaw = await readJson<{
    provider?: string;
    stats?: { total?: number; resolved?: number; resolved_cep?: number; failed?: number };
    by_gym_id?: Record<string, { bairro: string; bairro_slug?: string; source?: string; cep?: string }>;
  }>(path.join(ROOT, 'data/processed/tp-bairro-index.json'), { by_gym_id: {} });
  const tpBairroByGymId = tpBairroRaw.by_gym_id ?? {};
  const st = tpBairroRaw.stats ?? {};
  const total = st.total ?? Object.keys(tpBairroByGymId).length;
  const resolved = st.resolved ?? Object.keys(tpBairroByGymId).length;
  const resolvedCep = st.resolved_cep ?? 0;
  const failed = st.failed ?? 0;
  const tpIndexStats: TpIndexAuditStats = {
    total,
    resolved,
    resolved_cep: resolvedCep,
    failed,
    provider: tpBairroRaw.provider ?? null,
    resolved_pct: pct(resolved, total),
    resolved_cep_pct: pct(resolvedCep, total),
  };
  console.log(
    `TP bairro index: ${Object.keys(tpBairroByGymId).length} gyms · resolved ${resolved}/${total} · CEP ${resolvedCep} · fail ${failed}`,
  );

  const rows = buildMunicipioCoverageRows({
    municipios,
    filterUf: UF_ARG,
    catalogs,
    receitaByIbge,
    whGyms: (whRaw.data ?? []) as Parameters<typeof buildMunicipioCoverageRows>[0]['whGyms'],
    tpGyms: (tpRaw.data ?? []) as Parameters<typeof buildMunicipioCoverageRows>[0]['tpGyms'],
    gpGyms: (gpRaw.data ?? []) as Parameters<typeof buildMunicipioCoverageRows>[0]['gpGyms'],
    tpBairroByGymId,
    whProgress,
  });

  const withGyms = rows.filter(
    (r) => r.wellhub.gym_count + r.totalpass.gym_count + r.gurupass.gym_count > 0,
  );

  const report: BairroCoverageAuditReport = summarizeReport(withGyms, UF_ARG, tpIndexStats);

  const outProcessed = path.join(ROOT, 'data/processed/bairro-coverage-audit.json');
  const outPublic = path.join(ROOT, 'public/data/bairro-coverage-audit.json');
  const outMissing = path.join(ROOT, 'data/processed/bairro-coverage-missing-t3plus.json');
  const outMissingPublic = path.join(ROOT, 'public/data/bairro-coverage-missing-t3plus.json');

  const payload = JSON.stringify(report, null, 2) + '\n';
  await fs.writeFile(outProcessed, payload, 'utf8');
  await fs.mkdir(path.dirname(outPublic), { recursive: true });
  await fs.writeFile(outPublic, payload, 'utf8');

  const missingPayload = {
    version: '1' as const,
    generated_at: report.generated_at,
    filter_uf: UF_ARG,
    tier_definition: MUNICIPIO_TIER_DEFINITION,
    baseline_avg_tp_coverage_pct_2026_09_02: 35.6,
    summary: {
      municipios_t3_plus_with_tp: report.missing_bairros_t3_plus.length,
      with_missing: report.missing_bairros_t3_plus.filter((m) => m.missing_bairros.length > 0).length,
      avg_tp_coverage_pct_t3_plus: report.summary.avg_tp_coverage_pct_t3_plus,
      avg_tp_coverage_pct_all: report.summary.avg_tp_coverage_pct,
      tp_index: report.summary.tp_index,
    },
    municipios: report.missing_bairros_t3_plus,
  };
  const missingJson = JSON.stringify(missingPayload, null, 2) + '\n';
  await fs.writeFile(outMissing, missingJson, 'utf8');
  await fs.writeFile(outMissingPublic, missingJson, 'utf8');

  console.log('\n--- SUMMARY ---');
  console.log(`Municípios com gyms: ${withGyms.length}`);
  console.log(`Com catálogo oficial: ${report.summary.municipios_with_catalog}`);
  console.log(`Com ref Receita: ${report.summary.municipios_with_receita_ref}`);
  console.log(`T3+: ${report.summary.municipios_t3_plus}`);
  console.log(`Avg WH coverage: ${report.summary.avg_wh_coverage_pct ?? 'n/a'}%`);
  console.log(
    `Avg TP coverage (pós-CEP): ${report.summary.avg_tp_coverage_pct ?? 'n/a'}% (baseline 35.6%)`,
  );
  console.log(`Avg TP coverage T3+: ${report.summary.avg_tp_coverage_pct_t3_plus ?? 'n/a'}%`);
  console.log(`Avg TP parseable (mun avg): ${report.summary.avg_tp_parseable_pct ?? 'n/a'}%`);
  console.log(
    `Avg TP parseable (gym-wt): ${report.summary.tp_parseable_pct_gym_weighted ?? 'n/a'}%`,
  );
  console.log(`Avg GP coverage: ${report.summary.avg_gp_coverage_pct ?? 'n/a'}%`);
  console.log(
    `TP index CEP: ${tpIndexStats.resolved_cep_pct ?? 'n/a'}% resolved_cep (${resolvedCep}/${total})`,
  );
  console.log(`missing_bairros T3+: ${report.missing_bairros_t3_plus.length} municípios`);
  console.log(`\nWrote ${outProcessed}`);
  console.log(`Wrote ${outPublic}`);
  console.log(`Wrote ${outMissing}`);
  console.log(`Wrote ${outMissingPublic}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
