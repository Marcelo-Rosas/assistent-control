/**
 * Libera disco do pipeline TotalPass após scrape completo.
 * Remove totalpass-progress.json (duplica gymById já em totalpass-brasil-all.json).
 *
 * Run: npm run prune:tp-disk
 *
 * Env:
 *   INPUT_PATH=data/raw/totalpass-brasil-all.json
 *   PROGRESS_PATH=data/processed/totalpass-progress.json
 *   MINIFY_ALL=1   — regrava all.json minificado (opcional)
 *   DRY_RUN=1
 */
import fs from 'fs/promises';
import path from 'path';

const ROOT = process.cwd();
const INPUT_PATH = process.env.INPUT_PATH || path.join(ROOT, 'data/raw/totalpass-brasil-all.json');
const PROGRESS_PATH =
  process.env.PROGRESS_PATH || path.join(ROOT, 'data/processed/totalpass-progress.json');
const MINIFY_ALL = process.env.MINIFY_ALL === '1';
const DRY_RUN = process.env.DRY_RUN === '1';

async function fileSizeMb(p: string): Promise<number | null> {
  try {
    const st = await fs.stat(p);
    return st.size / 1024 / 1024;
  } catch {
    return null;
  }
}

async function main(): Promise<void> {
  const beforeProgress = await fileSizeMb(PROGRESS_PATH);
  const beforeAll = await fileSizeMb(INPUT_PATH);

  if (!beforeAll) {
    console.error(`Ausente: ${INPUT_PATH}`);
    process.exit(1);
  }

  const all = JSON.parse(await fs.readFile(INPUT_PATH, 'utf-8')) as {
    data?: unknown[];
    metadata?: Record<string, unknown>;
  };
  const allCount = Array.isArray(all.data) ? all.data.length : 0;
  if (!allCount) {
    console.error('totalpass-brasil-all.json sem data[]');
    process.exit(1);
  }

  let progressCount = 0;
  try {
    const progress = JSON.parse(await fs.readFile(PROGRESS_PATH, 'utf-8')) as {
      gymById?: Record<string, unknown>;
      completed?: unknown[];
    };
    progressCount = Object.keys(progress.gymById || {}).length;
    if (progressCount && progressCount !== allCount) {
      console.error(
        `Mismatch: progress=${progressCount} all.json=${allCount}. Não apague o progress sem revisar.`,
      );
      process.exit(1);
    }
  } catch {
    console.log('Sem totalpass-progress.json — nada a remover.');
  }

  console.log(`all.json: ${allCount} gyms · ${beforeAll?.toFixed(1)} MB`);
  if (beforeProgress) {
    console.log(`progress: ${progressCount} gyms · ${beforeProgress.toFixed(1)} MB (duplicado)`);
  }

  if (DRY_RUN) {
    console.log('\nDRY_RUN=1 — nenhuma alteração.');
    return;
  }

  if (beforeProgress) {
    await fs.unlink(PROGRESS_PATH);
    console.log(`\nRemovido: ${PROGRESS_PATH}`);
  }

  if (MINIFY_ALL) {
    const tmp = `${INPUT_PATH}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(all), 'utf-8');
    await fs.rename(tmp, INPUT_PATH);
    const afterAll = await fileSizeMb(INPUT_PATH);
    console.log(
      `Minificado: ${INPUT_PATH} ${beforeAll?.toFixed(1)} MB → ${afterAll?.toFixed(1)} MB`,
    );
  }

  const afterProgress = await fileSizeMb(PROGRESS_PATH);
  const freed = (beforeProgress || 0) + (MINIFY_ALL && beforeAll ? beforeAll - (await fileSizeMb(INPUT_PATH))! : 0);
  console.log(`\nLiberado ~${freed.toFixed(1)} MB`);
  console.log(`progress restante: ${afterProgress == null ? 'nenhum' : `${afterProgress.toFixed(1)} MB`}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
