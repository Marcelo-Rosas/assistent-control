/**
 * Probe Wellhub Pass 2 detail URL / API for one gym id.
 */
import { chromium } from 'playwright';

const GYM_ID = process.env.GYM_ID || 'CXzlnnF9orYbwAPwdUNDMIp5faQRn38KmdHpbGrm81kmNMemxPUUK7YUJl5S5TGL';
const NAME = process.env.GYM_NAME || 'Perfect Body - Cassino';

async function main(): Promise<void> {
  const candidates = [
    `https://wellhub.com/pt-br/search/?partnerId=${GYM_ID}`,
    `https://wellhub.com/pt-br/partners/${GYM_ID}`,
    `https://wellhub.com/pt-br/partner/${GYM_ID}`,
    `https://wellhub.com/pt-br/gyms/${GYM_ID}`,
    `https://wellhub.com/pt-br/activities/gym/${GYM_ID}`,
    `https://wellhub.com/pt-br/search/rj/bangu/?map=1&partnerId=${GYM_ID}`,
  ];

  const apiCandidates = [
    `https://mep-partner-bff.wellhub.com/v4/partners/${GYM_ID}?locale=pt-br`,
    `https://mep-partner-bff.wellhub.com/v2/partners/${GYM_ID}?locale=pt-br`,
    `https://mep-partner-bff.wellhub.com/v4/search/partner/${GYM_ID}?locale=pt-br`,
    `https://mep-partner-bff.wellhub.com/v4/partner/${GYM_ID}?locale=pt-br`,
  ];

  console.log('=== API probe ===');
  for (const url of apiCandidates) {
    try {
      const res = await fetch(url, {
        headers: { Accept: 'application/json', 'User-Agent': 'GymSitePipeline/1.0' },
      });
      const text = await res.text();
      console.log(url, res.status, text.slice(0, 300));
    } catch (err) {
      console.log(url, 'ERR', err instanceof Error ? err.message : err);
    }
  }

  console.log('\n=== Browser probe ===');
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ locale: 'pt-BR' });
  const page = await context.newPage();

  const captured: string[] = [];
  page.on('response', async (res) => {
    const u = res.url();
    if (
      u.includes('mep-partner-bff') ||
      u.includes('/v4/') ||
      u.includes('partner') ||
      u.includes(GYM_ID.slice(0, 20))
    ) {
      if (res.status() === 200) {
        try {
          const body = await res.text();
          if (body.includes(GYM_ID) || body.includes('Perfect Body')) {
            captured.push(`${res.status()} ${u} len=${body.length}`);
          }
        } catch {
          // ignore
        }
      }
    }
  });

  const searchUrl = 'https://wellhub.com/pt-br/search/rj/bangu/?map=1';
  console.log('goto', searchUrl);
  await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(4000);

  const links = await page.evaluate((name) => {
    const out: string[] = [];
    for (const a of document.querySelectorAll('a[href]')) {
      const href = (a as HTMLAnchorElement).href;
      const text = (a.textContent || '').trim();
      if (text.includes('Perfect Body') || href.includes('partner')) out.push(`${text.slice(0, 40)} -> ${href}`);
    }
    return out.slice(0, 20);
  }, NAME);
  console.log('links', links);

  for (const url of candidates) {
    try {
      const res = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
      await page.waitForTimeout(2000);
      console.log('try', url, '->', page.url(), 'status', res?.status());
    } catch (err) {
      console.log('try ERR', url, err instanceof Error ? err.message : err);
    }
  }

  console.log('\ncaptured responses:');
  for (const c of captured) console.log(c);

  await browser.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
