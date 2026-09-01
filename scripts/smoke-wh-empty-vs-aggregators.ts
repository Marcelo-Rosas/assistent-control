/**
 * Smoke: municípios que o scrape WH marcou "sem academias"
 * × contagem raw TotalPass × raw GuruPass × re-fetch live WH.
 *
 * 3 cidades por região (N/NE/CO/SE/S), preferindo maior população IBGE.
 *
 * Run: npx tsx scripts/smoke-wh-empty-vs-aggregators.ts
 * Env: LIVE_WH=0 para pular re-fetch Playwright (só cruzamento raw)
 */
import fs from 'fs';
import path from 'path';
import { chromium, type Page } from 'playwright';
import {
  buildSearchUrl,
  municipioSlug,
} from './scrape-wellhub-brasil.ts';

const ROOT = process.cwd();
const PROGRESS_PATH = path.join(ROOT, 'data/processed/wellhub-progress.json');
const MUN_PATH = path.join(ROOT, 'data/municipios-brasil.json');
const TP_PATH = path.join(ROOT, 'data/raw/totalpass-brasil-all.json');
const GP_PATH = path.join(ROOT, 'data/raw/gurupass-brasil-all.json');

const REGION_BY_UF: Record<string, string> = {
  AC: 'N', AM: 'N', AP: 'N', PA: 'N', RO: 'N', RR: 'N', TO: 'N',
  AL: 'NE', BA: 'NE', CE: 'NE', MA: 'NE', PB: 'NE', PE: 'NE', PI: 'NE', RN: 'NE', SE: 'NE',
  DF: 'CO', GO: 'CO', MT: 'CO', MS: 'CO',
  ES: 'SE', MG: 'SE', RJ: 'SE', SP: 'SE',
  PR: 'S', RS: 'S', SC: 'S',
};

const REGION_ORDER = ['SE', 'N', 'NE', 'CO', 'S'] as const;
const PER_REGION = 3;
const LIVE_WH = process.env.LIVE_WH !== '0';
const GOTO_TIMEOUT_MS = Number(process.env.GOTO_TIMEOUT_MS || 30_000);
const MAX_RETRIES = Number(process.env.MAX_RETRIES || 3);
const SETTLE_MS = Number(process.env.SETTLE_MS || 1500);

type Failed = { nome: string; key: string; error: string };
type Mun = { nome: string; uf: string; populacao?: number };

function fold(s: string): string {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function parseKey(key: string): { nome: string; uf: string } {
  const i = key.lastIndexOf('-');
  if (i < 0) return { nome: key, uf: '' };
  return { nome: key.slice(0, i), uf: key.slice(i + 1).toUpperCase() };
}

function pickSample(failed: Failed[], munByKey: Map<string, Mun>): Array<Mun & { region: string; error: string }> {
  const byRegion: Record<string, Array<Mun & { error: string }>> = {
    N: [], NE: [], CO: [], SE: [], S: [],
  };

  for (const f of failed) {
    const { nome, uf } = parseKey(f.key);
    const region = REGION_BY_UF[uf];
    if (!region) continue;
    const ibge = munByKey.get(`${fold(nome)}|${uf}`);
    byRegion[region].push({
      nome: ibge?.nome || nome,
      uf,
      populacao: ibge?.populacao || 0,
      error: f.error,
    });
  }

  const out: Array<Mun & { region: string; error: string }> = [];
  for (const region of REGION_ORDER) {
    const list = byRegion[region]
      .sort((a, b) => (b.populacao || 0) - (a.populacao || 0));
    // unique by key
    const seen = new Set<string>();
    for (const m of list) {
      const k = `${fold(m.nome)}|${m.uf}`;
      if (seen.has(k)) continue;
      seen.add(k);
      out.push({ ...m, region });
      if (seen.size >= PER_REGION) break;
    }
  }
  return out;
}

function countTp(tpData: any[], nome: string, uf: string): number {
  const n = fold(nome);
  let c = 0;
  for (const item of tpData) {
    const a = item.attributes || {};
    if (String(a.uf || '').toUpperCase() !== uf) continue;
    const bags = [
      ...(Array.isArray(a.municipios_busca) ? a.municipios_busca : []),
      ...(Array.isArray(a.municipios_relacionados) ? a.municipios_relacionados : []),
    ].map(fold);
    if (bags.includes(n)) c += 1;
  }
  return c;
}

function countGp(gpData: any[], nome: string, uf: string): number {
  const n = fold(nome);
  let c = 0;
  for (const g of gpData) {
    if (String(g.uf || '').toUpperCase() !== uf) continue;
    if (fold(g.city || '') === n) c += 1;
  }
  return c;
}

async function liveWhCount(page: Page, nome: string, uf: string): Promise<{ count: number; retries: number; url: string; lastError?: string }> {
  const url = buildSearchUrl(uf, nome);
  let lastError = '';
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const intercepted: string[] = [];
      const onResponse = async (response: { url: () => string; status: () => number; json: () => Promise<any> }) => {
        try {
          const u = response.url();
          if (!u.includes('/v4/search') || u.includes('recommendation')) return;
          if (response.status() !== 200) return;
          const json = await response.json();
          const results = json?.results || json?.partners || json?.data || [];
          if (Array.isArray(results)) {
            for (const r of results) {
              const id = String(r.id || r.partnerId || r.slug || '');
              if (id) intercepted.push(id);
            }
          }
        } catch { /* ignore */ }
      };
      page.on('response', onResponse);
      try {
        const res = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: GOTO_TIMEOUT_MS });
        if (res && res.status() >= 400) throw new Error(`HTTP ${res.status()}`);
        try {
          await page.waitForFunction(
            () =>
              document.documentElement.innerHTML.includes('fullAddress') ||
              /Parceiros Wellhub em/i.test(document.body?.innerText || '') ||
              /nenhum|não encontr|nao encontr|0 parceiro/i.test(document.body?.innerText || ''),
            { timeout: GOTO_TIMEOUT_MS },
          );
        } catch { /* settle */ }
        await sleep(SETTLE_MS);
        const html = await page.content();
        const fullAddrHits = (html.match(/"fullAddress"/g) || []).length;
        // crude unique: prefer intercepted ids
        const ids = new Set(intercepted);
        const count = ids.size > 0 ? ids.size : fullAddrHits;
        if (count === 0) throw new Error(`sem academias em ${url}`);
        return { count, retries: attempt - 1, url };
      } finally {
        page.off('response', onResponse);
      }
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      if (attempt === MAX_RETRIES) break;
      await sleep(1000 * 2 ** (attempt - 1));
    }
  }
  return { count: 0, retries: MAX_RETRIES, url, lastError };
}

async function main(): Promise<void> {
  const progress = JSON.parse(fs.readFileSync(PROGRESS_PATH, 'utf-8'));
  const failed: Failed[] = Array.isArray(progress.failed) ? progress.failed : [];
  const municipios: Mun[] = JSON.parse(fs.readFileSync(MUN_PATH, 'utf-8'));
  const munByKey = new Map(municipios.map((m) => [`${fold(m.nome)}|${m.uf}`, m]));

  const tp = JSON.parse(fs.readFileSync(TP_PATH, 'utf-8'));
  const gp = JSON.parse(fs.readFileSync(GP_PATH, 'utf-8'));
  const tpData: any[] = tp.data || [];
  const gpData: any[] = gp.data || [];

  const sample = pickSample(failed, munByKey);
  console.log(`WH failed no checkpoint: ${failed.length}`);
  console.log(`Amostra: ${sample.length} municípios (${PER_REGION}×${REGION_ORDER.length} regiões)\n`);

  type Row = {
    region: string;
    cidade: string;
    uf: string;
    pop: number;
    tp_raw: number;
    gp_raw: number;
    wh_live: number | null;
    wh_retries: number | null;
    pattern: string;
  };

  const rows: Row[] = [];

  let browser: Awaited<ReturnType<typeof chromium.launch>> | null = null;
  let page: Page | null = null;
  if (LIVE_WH) {
    browser = await chromium.launch({ headless: true });
    const ctx = await browser.newContext({
      locale: 'pt-BR',
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    });
    page = await ctx.newPage();
  }

  try {
    for (const m of sample) {
      const tp_raw = countTp(tpData, m.nome, m.uf);
      const gp_raw = countGp(gpData, m.nome, m.uf);
      let wh_live: number | null = null;
      let wh_retries: number | null = null;
      if (page) {
        process.stdout.write(`  live WH ${m.nome}-${m.uf}… `);
        const live = await liveWhCount(page, m.nome, m.uf);
        wh_live = live.count;
        wh_retries = live.retries;
        console.log(`${live.count} (retries=${live.retries})${live.lastError ? ' · ' + live.lastError.slice(0, 60) : ''}`);
      }

      const wh0 = (wh_live ?? 0) === 0;
      const tp0 = tp_raw === 0;
      const gp0 = gp_raw === 0;
      let pattern = '';
      if (wh0 && tp0 && gp0) pattern = 'NENHUM agregador';
      else if (wh0 && !tp0 && !gp0) pattern = 'só WH vazio (TP+GP tem)';
      else if (wh0 && !tp0 && gp0) pattern = 'WH+GP vazios (TP tem)';
      else if (wh0 && tp0 && !gp0) pattern = 'WH+TP vazios (GP tem)';
      else if (!wh0) pattern = 'FALSO NEGATIVO WH (live achou)';
      else pattern = 'misto';

      rows.push({
        region: m.region,
        cidade: m.nome,
        uf: m.uf,
        pop: m.populacao || 0,
        tp_raw,
        gp_raw,
        wh_live,
        wh_retries,
        pattern,
      });
    }
  } finally {
    await browser?.close();
  }

  console.log('\n=== RESULTADO ===\n');
  console.log(
    'reg'.padEnd(4),
    'cidade'.padEnd(28),
    'UF'.padEnd(3),
    'pop'.padStart(8),
    'WH_live'.padStart(8),
    'TP'.padStart(5),
    'GP'.padStart(5),
    'padrão',
  );
  for (const r of rows) {
    console.log(
      r.region.padEnd(4),
      r.cidade.slice(0, 27).padEnd(28),
      r.uf.padEnd(3),
      String(r.pop).padStart(8),
      String(r.wh_live ?? '—').padStart(8),
      String(r.tp_raw).padStart(5),
      String(r.gp_raw).padStart(5),
      r.pattern,
    );
  }

  const tally: Record<string, number> = {};
  for (const r of rows) tally[r.pattern] = (tally[r.pattern] || 0) + 1;
  console.log('\n=== TALLY ===');
  for (const [k, v] of Object.entries(tally).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${v}× ${k}`);
  }

  const outPath = path.join(ROOT, 'data/processed/smoke-wh-empty-vs-aggregators.json');
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(
    outPath,
    JSON.stringify(
      {
        generated_at: new Date().toISOString(),
        wh_failed_total: failed.length,
        sample: rows,
        tally,
        note: 'WH_live = re-fetch Playwright com retries; TP/GP = raw scrape (não Eros DB).',
      },
      null,
      2,
    ),
  );
  console.log(`\nSalvo: ${outPath}`);
  // keep import used
  void municipioSlug;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
