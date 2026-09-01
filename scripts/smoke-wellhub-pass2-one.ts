/**
 * Smoke Pass 2 — um gym do dump Pass1 + detalhe Wellhub.
 *
 * Run: npx tsx scripts/smoke-wellhub-pass2-one.ts
 * Env: GYM_ID=... OUTPUT_PATH=...
 */
import fs from 'fs/promises';
import path from 'path';
import { chromium } from 'playwright';
import {
  extractWellhubDetailFromText,
  WELLHUB_PARTNER_DETAIL_URL,
  type WellhubPass2Record,
} from './lib/wellhubDetailSchema.ts';
import type { WellhubGymRaw } from './scrape-wellhub-brasil.ts';

const ROOT = process.cwd();
const DUMP_PATH = path.join(ROOT, 'data/raw/wellhub-brasil-all.json');
const DEFAULT_GYM_ID =
  process.env.GYM_ID || 'CXzlnnF9orYbwAPwdUNDMIp5faQRn38KmdHpbGrm81kmNMemxPUUK7YUJl5S5TGL';
const OUTPUT_PATH =
  process.env.OUTPUT_PATH || path.join(ROOT, 'data/processed/wellhub-pass2-example.json');

async function loadPass1(gymId: string): Promise<WellhubGymRaw | null> {
  const raw = JSON.parse(await fs.readFile(DUMP_PATH, 'utf-8')) as
    | WellhubGymRaw[]
    | { data?: WellhubGymRaw[] };
  const rows = Array.isArray(raw) ? raw : raw.data ?? [];
  return rows.find((g) => g.id === gymId) ?? null;
}

async function main(): Promise<void> {
  const gymId = DEFAULT_GYM_ID;
  const detailUrl = WELLHUB_PARTNER_DETAIL_URL(gymId);

  const pass1 = await loadPass1(gymId);
  if (!pass1) {
    console.error(`Gym ${gymId} não encontrado em ${DUMP_PATH}`);
    process.exit(1);
  }

  console.log(`Pass 2 Wellhub: ${pass1.name}`);
  console.log(`Pass1 id=${gymId}`);
  console.log(`Detail ${detailUrl}\n`);

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ locale: 'pt-BR' });
  await page.goto(detailUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(3500);

  const html = await page.content();
  const bodyText = await page.evaluate(() => document.body?.innerText || '');

  const jsonLd = await page.evaluate(() => {
    const el = document.querySelector('script[type="application/ld+json"]');
    if (!el?.textContent) return null;
    try {
      return JSON.parse(el.textContent) as Record<string, unknown>;
    } catch {
      return null;
    }
  });

  await browser.close();

  const pass2 = extractWellhubDetailFromText(bodyText, gymId, detailUrl, jsonLd);

  const horarios = await (async () => {
    // re-open not needed — parse horarios from bodyText blocks
    const blocks: WellhubPass2Record['pass2']['horarios'] = [];
    const re = /A partir do plano ([^\n]+)\n\n([\s\S]*?)(?=A partir do plano |Os horários de funcionamento|$)/g;
    for (const m of bodyText.matchAll(re)) {
      const plano = m[1].trim();
      const body = m[2];
      const dias: Record<string, string> = {};
      for (const dm of body.matchAll(/(Segunda-feira|Terça-feira|Quarta-feira|Quinta-feira|Sexta-feira|Sábado|Domingo)\n\n([\d: -]+)/g)) {
        dias[dm[1]] = dm[2].trim();
      }
      if (Object.keys(dias).length) {
        blocks.push({ plano, titulo: body.split('\n')[0]?.trim() || null, dias });
      }
    }
    return blocks;
  })();
  pass2.horarios = horarios;

  const record: WellhubPass2Record = {
    pass1,
    pass2,
    enriched_at: new Date().toISOString(),
  };

  await fs.mkdir(path.dirname(OUTPUT_PATH), { recursive: true });
  await fs.writeFile(OUTPUT_PATH, JSON.stringify(record, null, 2), 'utf-8');

  console.log('=== Pass 2 OK ===');
  console.log(`nota=${pass2.avaliacao.nota} avaliacoes=${pass2.avaliacao.total_avaliacoes}`);
  console.log(`comodidades=${pass2.comodidades.length} horarios_blocos=${pass2.horarios.length}`);
  console.log(`telefone=${pass2.contato.telefone}`);
  console.log(`atividades=${pass2.atividades.inclusas_horario_especifico.length}+${pass2.atividades.outras.length}`);
  console.log(`Output: ${OUTPUT_PATH}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
