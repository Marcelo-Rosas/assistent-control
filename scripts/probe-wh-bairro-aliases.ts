/**
 * Probe alternate Wellhub slugs for empty POA bairros.
 * Run: npx tsx scripts/probe-wh-bairro-aliases.ts
 */
import { extractGymsFromHtml } from './scrape-wellhub-brasil.ts';
import { bairroSlug } from './lib/wellhubBairrosCatalog.ts';

const CANDIDATES: Record<string, string[]> = {
  'boa-vista-do-sul': ['boa-vista-do-sul', 'boa-vista-sul'],
  'bom-jesus': ['bom-jesus', 'bomjesus', 'bom-jesus-rs', 'bom-jesus-porto-alegre'],
  'bom-fim': ['bom-fim', 'bomfim', 'the-bom-fim'],
  'campo-novo': ['campo-novo', 'campo-novo-porto-alegre'],
  'costa-e-silva': ['costa-e-silva', 'costa-e-silva-porto-alegre', 'costa-silva'],
  cristal: ['cristal', 'cristal-porto-alegre', 'bairro-cristal'],
  extrema: ['extrema', 'extrema-porto-alegre'],
  medianeira: ['medianeira', 'medianeira-porto-alegre'],
  'passo-d-areia': ['passo-d-areia', 'passo-dareia', 'passo-de-areia', 'passo-d-areia-porto-alegre'],
  santana: ['santana', 'santana-porto-alegre'],
  'sao-caetano': ['sao-caetano', 'sao-caetano-porto-alegre'],
  'sao-sebastiao': ['sao-sebastiao', 'sao-sebastiao-porto-alegre'],
  'vila-conceicao': ['vila-conceicao', 'vila-conceicao-porto-alegre', 'conceicao'],
};

async function count(slug: string): Promise<number> {
  const url = `https://wellhub.com/pt-br/search/rs/${slug}/?map=1`;
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'GymSitePipeline/1.0', 'Accept-Language': 'pt-BR' },
    });
    if (res.status >= 400) return -res.status;
    const html = await res.text();
    return extractGymsFromHtml(html).length;
  } catch {
    return -1;
  }
}

async function main(): Promise<void> {
  for (const [key, slugs] of Object.entries(CANDIDATES)) {
    console.log(`\n=== ${key} ===`);
    for (const s of slugs) {
      const n = await count(s);
      const mark = n > 0 ? ' ✓' : n === 0 ? ' (vazio)' : ` (err ${n})`;
      console.log(`  ${s}: ${n >= 0 ? n : 'fail'}${mark}`);
      await new Promise((r) => setTimeout(r, 250));
    }
  }

  // Also try Wellhub location API for bairro names
  console.log('\n=== location API ===');
  const terms = ["Passo D'Areia", 'Bom Fim', 'Bom Jesus', 'Cristal', 'Medianeira', 'Santana'];
  for (const term of terms) {
    const u = `https://mep-partner-bff.wellhub.com/v2/search/location?maxResults=4&locale=pt-br&term=${encodeURIComponent(term + '-RS')}`;
    const res = await fetch(u, { headers: { Accept: 'application/json' } });
    const data = (await res.json()) as Array<{ name?: string; slug?: string }>;
    console.log(term, JSON.stringify(data?.slice(0, 3)));
    await new Promise((r) => setTimeout(r, 250));
  }
}

main();
