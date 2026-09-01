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
} from './lib/bairroCoverageAudit.ts';

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

async function main() {
  console.log(`Audit bairro coverage${UF_ARG ? ` UF=${UF_ARG}` : ' (BR)'}`);

  const municipios = await readJson<Array<{ nome: string; uf: string; ibge?: string }>>(
    path.join(ROOT, 'data/municipios-brasil.json'),
    [],
  );

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

  const tpBairroRaw = await readJson<{ by_gym_id?: Record<string, { bairro: string }> }>(
    path.join(ROOT, 'data/processed/tp-bairro-index.json'),
    { by_gym_id: {} },
  );
  const tpBairroByGymId = tpBairroRaw.by_gym_id ?? {};
  console.log(`TP bairro geocode index: ${Object.keys(tpBairroByGymId).length} gyms`);

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

  const report: BairroCoverageAuditReport = summarizeReport(withGyms, UF_ARG);

  const outProcessed = path.join(ROOT, 'data/processed/bairro-coverage-audit.json');
  const outPublic = path.join(ROOT, 'public/data/bairro-coverage-audit.json');
  const payload = JSON.stringify(report, null, 2) + '\n';
  await fs.writeFile(outProcessed, payload, 'utf8');
  await fs.mkdir(path.dirname(outPublic), { recursive: true });
  await fs.writeFile(outPublic, payload, 'utf8');

  console.log('\n--- SUMMARY ---');
  console.log(`Municípios com gyms: ${withGyms.length}`);
  console.log(`Com catálogo oficial: ${report.summary.municipios_with_catalog}`);
  console.log(`Com ref Receita: ${report.summary.municipios_with_receita_ref}`);
  console.log(`Avg WH coverage: ${report.summary.avg_wh_coverage_pct ?? 'n/a'}%`);
  console.log(`Avg TP coverage: ${report.summary.avg_tp_coverage_pct ?? 'n/a'}%`);
  console.log(`Avg GP coverage: ${report.summary.avg_gp_coverage_pct ?? 'n/a'}%`);
  console.log(`\nWrote ${outProcessed}`);
  console.log(`Wrote ${outPublic}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
