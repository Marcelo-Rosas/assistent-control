/**
 * Probe Wellhub Pass 2 detail page payload.
 */
import fs from 'fs/promises';
import path from 'path';
import { chromium } from 'playwright';

const GYM_ID = process.env.GYM_ID || 'CXzlnnF9orYbwAPwdUNDMIp5faQRn38KmdHpbGrm81kmNMemxPUUK7YUJl5S5TGL';
const DETAIL_URL = `https://wellhub.com/pt-br/search/partners/${GYM_ID}`;
const OUT = path.join(process.cwd(), 'data/processed/wellhub-pass2-probe.json');

async function main(): Promise<void> {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ locale: 'pt-BR' });
  const page = await context.newPage();

  const apiBodies: Array<{ url: string; json: unknown }> = [];
  page.on('response', async (res) => {
    const u = res.url();
    if (!u.includes('wellhub.com') && !u.includes('mep-partner-bff')) return;
    if (res.status() !== 200) return;
    const ct = res.headers()['content-type'] || '';
    if (!ct.includes('json')) return;
    try {
      apiBodies.push({ url: u, json: await res.json() });
    } catch {
      // ignore
    }
  });

  await page.goto(DETAIL_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(4000);
  const html = await page.content();

  const nextChunks: string[] = [];
  for (const m of html.matchAll(/self\.__next_f\.push\(\[1,"([\s\S]*?)"\]\)/g)) {
    nextChunks.push(m[1]);
  }

  const keys = new Set<string>();
  for (const chunk of nextChunks) {
    for (const km of chunk.matchAll(/\\"([a-zA-Z_][a-zA-Z0-9_]*)\\":/g)) keys.add(km[1]);
  }

  const ld = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
  let jsonLd: unknown = null;
  if (ld) {
    try {
      jsonLd = JSON.parse(ld[1]);
    } catch {
      // ignore
    }
  }

  const visible = await page.evaluate(() => {
    const text = document.body?.innerText || '';
    return {
      title: document.title,
      h1: document.querySelector('h1')?.textContent?.trim() || null,
      snippet: text.slice(0, 2500),
    };
  });

  await browser.close();

  const payload = {
    gym_id: GYM_ID,
    detail_url: DETAIL_URL,
    visible,
    json_ld: jsonLd,
    next_keys_sample: [...keys].sort().slice(0, 120),
    api_responses: apiBodies,
    html_len: html.length,
  };

  await fs.mkdir(path.dirname(OUT), { recursive: true });
  await fs.writeFile(OUT, JSON.stringify(payload, null, 2), 'utf-8');
  const htmlPath = path.join(process.cwd(), 'data/processed/wellhub-pass2-probe.html');
  await fs.writeFile(htmlPath, html, 'utf-8');
  console.log('Wrote', OUT);
  console.log('Wrote', htmlPath);
  console.log('api_responses', apiBodies.length);
  console.log('next_keys', keys.size);
  console.log('title', visible.title);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
