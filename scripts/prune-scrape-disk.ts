/**
 * Libera disco dos scrapes — remove gymById duplicado do checkpoint.
 * Fonte canônica: data/raw/*-brasil-all.json
 * Checkpoint slim: completed + failed + meta (retomável via rehydrate no scraper).
 *
 * Run: npm run prune:scrape-disk
 *
 * Env:
 *   MINIFY_ALL=1   — regrava *-brasil-all.json minificado
 *   TRIM_LOGS=1    — trunca logs de scrape/enrich > 100KB
 *   DRY_RUN=1
 */
import fs from 'fs/promises';
import path from 'path';

const ROOT = process.cwd();
const DRY_RUN = process.env.DRY_RUN === '1';
const MINIFY_ALL = process.env.MINIFY_ALL === '1';
const TRIM_LOGS = process.env.TRIM_LOGS !== '0';

type Target = {
  name: string;
  allPath: string;
  progressPath: string;
};

const TARGETS: Target[] = [
  {
    name: 'gurupass',
    allPath: path.join(ROOT, 'data/raw/gurupass-brasil-all.json'),
    progressPath: path.join(ROOT, 'data/processed/gurupass-progress.json'),
  },
  {
    name: 'wellhub',
    allPath: path.join(ROOT, 'data/raw/wellhub-brasil-all.json'),
    progressPath: path.join(ROOT, 'data/processed/wellhub-progress.json'),
  },
  {
    name: 'totalpass',
    allPath: path.join(ROOT, 'data/raw/totalpass-brasil-all.json'),
    progressPath: path.join(ROOT, 'data/processed/totalpass-progress.json'),
  },
];

const LOG_PATHS = [
  path.join(ROOT, 'data/raw/totalpass-enrich.out.log'),
  path.join(ROOT, 'data/raw/totalpass-enrich.err.log'),
  path.join(ROOT, 'data/raw/wellhub-scrape.out.log'),
  path.join(ROOT, 'data/raw/wellhub-scrape.err.log'),
];

async function sizeMb(p: string): Promise<number> {
  try {
    const st = await fs.stat(p);
    return st.size / 1024 / 1024;
  } catch {
    return 0;
  }
}

function gymCountFromAll(raw: unknown): number {
  if (Array.isArray(raw)) return raw.length;
  if (raw && typeof raw === 'object' && Array.isArray((raw as { data?: unknown[] }).data)) {
    return (raw as { data: unknown[] }).data.length;
  }
  return 0;
}

async function slimTarget(t: Target): Promise<number> {
  const beforeProg = await sizeMb(t.progressPath);
  if (!beforeProg) {
    console.log(`[${t.name}] sem progress — skip`);
    return 0;
  }

  let allRaw: unknown;
  try {
    allRaw = JSON.parse(await fs.readFile(t.allPath, 'utf-8'));
  } catch {
    console.log(`[${t.name}] sem ${t.allPath} — skip slim (progress ${beforeProg.toFixed(1)} MB)`);
    return 0;
  }

  const allCount = gymCountFromAll(allRaw);
  const progress = JSON.parse(await fs.readFile(t.progressPath, 'utf-8')) as {
    gymById?: Record<string, unknown>;
    completed?: unknown[];
    failed?: unknown[];
    lastUpdate?: string;
    progressVersion?: number;
    searchMode?: string;
  };

  const progCount = Object.keys(progress.gymById || {}).length;
  if (!progCount) {
    console.log(`[${t.name}] progress já slim (${beforeProg.toFixed(2)} MB)`);
    return 0;
  }
  if (allCount && progCount !== allCount) {
    console.error(`[${t.name}] MISMATCH all=${allCount} progress=${progCount} — não slim`);
    return 0;
  }

  const slim = {
    progressVersion: progress.progressVersion,
    searchMode: progress.searchMode,
    completed: progress.completed ?? [],
    failed: progress.failed ?? [],
    lastUpdate: progress.lastUpdate ?? new Date().toISOString(),
    slimmed_at: new Date().toISOString(),
    gym_count: allCount || progCount,
  };

  console.log(
    `[${t.name}] progress ${beforeProg.toFixed(1)} MB → slim (~${(JSON.stringify(slim).length / 1024).toFixed(0)} KB) · ${slim.completed.length} mun · ${slim.gym_count} gyms`,
  );

  if (!DRY_RUN) {
    const tmp = `${t.progressPath}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(slim), 'utf-8');
    await fs.rename(tmp, t.progressPath);
  }

  const afterProg = DRY_RUN ? beforeProg * 0.01 : await sizeMb(t.progressPath);
  return beforeProg - afterProg;
}

async function minifyAll(t: Target): Promise<number> {
  const before = await sizeMb(t.allPath);
  if (!before) return 0;

  const raw = JSON.parse(await fs.readFile(t.allPath, 'utf-8'));
  const min = JSON.stringify(raw);
  const saved = before - min.length / 1024 / 1024;

  if (saved < 0.5) {
    console.log(`[${t.name}] all.json já compacto (${before.toFixed(1)} MB)`);
    return 0;
  }

  console.log(`[${t.name}] minify all.json ${before.toFixed(1)} MB → ~${(min.length / 1024 / 1024).toFixed(1)} MB`);

  if (!DRY_RUN) {
    const tmp = `${t.allPath}.tmp`;
    await fs.writeFile(tmp, min, 'utf-8');
    await fs.rename(tmp, t.allPath);
  }
  return saved;
}

async function trimLogs(): Promise<number> {
  let freed = 0;
  for (const p of LOG_PATHS) {
    const mb = await sizeMb(p);
    if (mb < 0.1) continue;
    console.log(`log ${path.basename(p)}: ${mb.toFixed(1)} MB → truncado`);
    if (!DRY_RUN) {
      await fs.writeFile(p, `[truncated ${new Date().toISOString()}]\n`, 'utf-8');
    }
    freed += mb;
  }
  return freed;
}

async function main(): Promise<void> {
  console.log(`prune-scrape-disk DRY_RUN=${DRY_RUN} MINIFY_ALL=${MINIFY_ALL}\n`);

  let freed = 0;
  for (const t of TARGETS) {
    freed += await slimTarget(t);
    if (MINIFY_ALL) freed += await minifyAll(t);
  }
  if (TRIM_LOGS) freed += await trimLogs();

  console.log(`\nLiberado ~${freed.toFixed(1)} MB${DRY_RUN ? ' (dry-run)' : ''}`);

  if (!DRY_RUN) {
    const { execSync } = await import('node:child_process');
    try {
      const out = execSync(
        'powershell -NoProfile -Command "[math]::Round((Get-PSDrive C).Free/1GB, 2)"',
        { encoding: 'utf-8' },
      ).trim();
      console.log(`Disco C: livre agora ≈ ${out} GB`);
    } catch {
      /* ignore */
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
