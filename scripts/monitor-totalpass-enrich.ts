/**
 * Monitor do enrich TotalPass — status + falhas.
 * Run: npm run monitor:tp-enrich
 */
import fs from 'fs/promises';
import path from 'path';

const ROOT = process.cwd();
const PROGRESS_PATH =
  process.env.PROGRESS_PATH ||
  path.join(ROOT, 'data/processed/totalpass-enrich-progress.json');
const FAILURES_PATH =
  process.env.FAILURES_PATH ||
  path.join(ROOT, 'data/processed/totalpass-enrich-failures.json');
const OUTPUT_DIR =
  process.env.OUTPUT_DIR || path.join(ROOT, 'data/processed/totalpass-enriched/by-id');
const TOTAL_GYMS = Number(process.env.TOTAL_GYMS || 30706);

type ProgressState = {
  completed: string[];
  failed: Array<{ gym_id: string; slug: string; error: string }>;
  lastUpdate: string;
};

async function syncFailures(progress: ProgressState): Promise<void> {
  const payload = {
    updated_at: new Date().toISOString(),
    summary: {
      total_gyms: TOTAL_GYMS,
      completed: progress.completed.length,
      failed: progress.failed.length,
      pending: TOTAL_GYMS - progress.completed.length - progress.failed.length,
      pct_complete: `${((progress.completed.length / TOTAL_GYMS) * 100).toFixed(1)}%`,
    },
    failures: progress.failed.map((f) => ({
      gym_id: f.gym_id,
      slug: f.slug,
      url: `https://totalpass.com/br/academias/${f.slug}/`,
      error: f.error,
    })),
  };
  const tmp = `${FAILURES_PATH}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(payload, null, 2), 'utf-8');
  await fs.rename(tmp, FAILURES_PATH);
}

async function main(): Promise<void> {
  let progress: ProgressState;
  try {
    progress = JSON.parse(await fs.readFile(PROGRESS_PATH, 'utf-8')) as ProgressState;
  } catch {
    console.error(`Checkpoint ausente: ${PROGRESS_PATH}`);
    process.exit(1);
  }

  await syncFailures(progress);

  let fileCount = 0;
  let sizeMb = 0;
  try {
    const files = await fs.readdir(OUTPUT_DIR);
    for (const f of files) {
      if (!f.endsWith('.json')) continue;
      const st = await fs.stat(path.join(OUTPUT_DIR, f));
      fileCount += 1;
      sizeMb += st.size;
    }
    sizeMb /= 1024 * 1024;
  } catch {
    // ignore
  }

  const running = process.argv.includes('--json')
    ? null
    : 'Use Get-CimInstance para ver processo node enrich-totalpass';

  const report = {
    monitored_at: new Date().toISOString(),
    checkpoint: {
      completed: progress.completed.length,
      failed: progress.failed.length,
      pending: TOTAL_GYMS - progress.completed.length - progress.failed.length,
      pct_complete: `${((progress.completed.length / TOTAL_GYMS) * 100).toFixed(1)}%`,
      last_update: progress.lastUpdate,
    },
    output: { files: fileCount, size_mb: Number(sizeMb.toFixed(1)) },
    failures_path: FAILURES_PATH,
    failures: progress.failed,
  };

  if (process.argv.includes('--json')) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  console.log('=== TotalPass Enrich Monitor ===\n');
  console.log(
    `Progresso: ${report.checkpoint.completed}/${TOTAL_GYMS} (${report.checkpoint.pct_complete})`,
  );
  console.log(`Falhas: ${report.checkpoint.failed} · Pendentes: ${report.checkpoint.pending}`);
  console.log(`Arquivos: ${fileCount} (~${sizeMb.toFixed(1)} MB)`);
  console.log(`Último checkpoint: ${progress.lastUpdate}`);
  console.log(`\nFalhas exportadas → ${FAILURES_PATH}`);

  if (progress.failed.length) {
    console.log('\n--- Falhas ---');
    for (const f of progress.failed) {
      console.log(`• ${f.slug}`);
      console.log(`  ${f.error}`);
    }
  } else {
    console.log('\nNenhuma falha registrada.');
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
