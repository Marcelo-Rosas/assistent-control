/**
 * Scout CONFEF notícias via Playwright — contorna WAF (/challenge).
 *
 * fetch/curl headless → 302 /challenge. Chromium real resolve o challenge.
 *
 * Run:
 *   npm run scout:regulatorio-browser
 *   npm run scout:regulatorio-browser -- --out data/raw/Regulatorio/inbox/fixtures/confef-noticias.html
 *   npm run scout:regulatorio-browser -- --tick   # grava HTML + roda loop tick scout
 *
 * Env:
 *   HEADLESS=0  — ver browser
 *   SCOUT_TIMEOUT_MS=60000
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import {
  CONFEF_NOTICIAS_URL,
  parseNoticiasHtml,
} from './lib/regulatorioScout.ts';

const ROOT = process.cwd();
const DEFAULT_OUT = path.join(
  ROOT,
  'data',
  'raw',
  'Regulatorio',
  'inbox',
  'fixtures',
  `confef-noticias-${new Date().toISOString().slice(0, 10)}.html`,
);

function argValue(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  if (i < 0) return undefined;
  return process.argv[i + 1];
}

async function main(): Promise<void> {
  const outPath = path.resolve(argValue('--out') || DEFAULT_OUT);
  const runTick = process.argv.includes('--tick');
  const headless = process.env.HEADLESS === '1'; // default headed — headless costuma ficar no /challenge
  const timeoutMs = Number(process.env.SCOUT_TIMEOUT_MS || 90_000);
  const useChannel = process.env.PW_CHANNEL?.trim() || 'chrome';

  fs.mkdirSync(path.dirname(outPath), { recursive: true });

  console.log(`WAF bypass: Playwright → ${CONFEF_NOTICIAS_URL}`);
  console.log(
    `headless=${headless} channel=${useChannel} timeout=${timeoutMs}ms`,
  );
  console.log(
    '(Headless costuma falhar no WAF. Default = headed Chrome instalado. HEADLESS=1 força headless.)',
  );

  let browser;
  try {
    browser = await chromium.launch({
      headless,
      channel: useChannel as 'chrome',
      args: ['--disable-blink-features=AutomationControlled'],
    });
  } catch {
    console.warn(
      `Canal ${useChannel} indisponível — fallback chromium playwright`,
    );
    browser = await chromium.launch({
      headless,
      args: ['--disable-blink-features=AutomationControlled'],
    });
  }

  try {
    const context = await browser.newContext({
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      locale: 'pt-BR',
      viewport: { width: 1400, height: 900 },
    });
    await context.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    });
    const page = await context.newPage();

    await page.goto(CONFEF_NOTICIAS_URL, {
      waitUntil: 'domcontentloaded',
      timeout: timeoutMs,
    });

    // Espera sair de /challenge ou aparecer listagem de notícias
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const u = page.url();
      if (!/\/challenge/i.test(u)) {
        const n = await page.locator('a[href*="/comunicacao/noticias/"]').count();
        if (n >= 3) break;
      }
      await new Promise((r) => setTimeout(r, 1000));
    }

    const finalUrl = page.url();
    if (/\/challenge/i.test(finalUrl)) {
      throw new Error(
        `Ainda em challenge após wait: ${finalUrl}. Abra com Cursor browser ou HEADLESS=0 e resolva o challenge.`,
      );
    }

    await new Promise((r) => setTimeout(r, 1500));

    const html = await page.content();
    fs.writeFileSync(outPath, html, 'utf-8');
    const rel = path.relative(ROOT, outPath).replace(/\\/g, '/');
    console.log(`HTML salvo: ${rel} (${html.length} chars)`);
    console.log(`URL final: ${finalUrl}`);

    const candidates = parseNoticiasHtml(
      html,
      CONFEF_NOTICIAS_URL,
      new Date().toISOString().slice(0, 10),
    );
    console.log(`Parse: ${candidates.length} candidatos`);
    for (const c of candidates.slice(0, 5)) {
      console.log(`  - ${c.date} ${c.url} · ${c.title.slice(0, 70)}`);
    }
    if (candidates.length > 5) {
      console.log(`  … +${candidates.length - 5} mais`);
    }

    if (runTick) {
      console.log('\nRodando loop:regulatorio-tick --scout-html-file …');
      const r = spawnSync(
        'npx',
        [
          'tsx',
          'scripts/regulatorio-loop-tick.ts',
          '--force',
          '--scout-html-file',
          rel,
        ],
        { cwd: ROOT, encoding: 'utf-8', shell: true },
      );
      if (r.stdout) process.stdout.write(r.stdout);
      if (r.stderr) process.stderr.write(r.stderr);
      if (r.status !== 0) {
        process.exit(r.status ?? 1);
      }
    } else {
      console.log(
        `\nPróximo: npm run loop:regulatorio-tick -- --force --scout-html-file ${rel}`,
      );
    }
  } finally {
    await browser.close();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  console.error(
    'Dica: HEADLESS=0 p/ ver challenge; ou use Cursor browser e --scout-html-file.',
  );
  process.exit(1);
});
