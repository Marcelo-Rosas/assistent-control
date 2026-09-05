/**
 * Classifica residual CLA-27 (failures no tp-bairro-index).
 * npx tsx scripts/classify-cla27-residual.ts
 */
import fs from 'fs/promises';
import path from 'path';
import { extractCepFromText, isCepGenerico, normalizeCep } from './lib/tpCepResolver.ts';
import { loadTpReceitaCepMap } from './lib/tpReceitaCepMatch.ts';
import { loadTpBairroIndex } from './lib/tpBairroResolver.ts';

const ROOT = process.cwd();
const INDEX_PATH = path.join(ROOT, 'data/processed/tp-bairro-index.json');
const INPUT_PATH = path.join(ROOT, 'data/raw/totalpass-brasil-all.json');
const ENRICH_DIR = path.join(ROOT, 'data/processed/totalpass-enriched/by-id');

async function main() {
  const index = (await loadTpBairroIndex(INDEX_PATH))!;
  const receitaMap = await loadTpReceitaCepMap();
  const raw = JSON.parse(await fs.readFile(INPUT_PATH, 'utf8')) as {
    data?: Array<{
      id: string;
      attributes?: { name?: string; full_address?: string };
    }>;
  };
  const gymById = new Map((raw.data ?? []).map((g) => [g.id, g]));

  const failures = index.failures ?? [];
  console.log('stats', JSON.stringify(index.stats));
  console.log('failures.length', failures.length);

  const tax: Record<string, number> = {};
  let withReceita = 0;
  let withDetailCep = 0;
  let withListCep = 0;
  let detailListNoReceita = 0;
  let anyGenerico = 0;
  let anyFino = 0;
  let semCep = 0;
  let genericoNoReceita = 0;
  let finoNoReceita = 0;
  const samples: string[] = [];

  for (const f of failures) {
    const err = f.error || 'unknown';
    tax[err] = (tax[err] || 0) + 1;
    const gym = gymById.get(f.gym_id);
    const list = gym?.attributes?.full_address ?? '';
    let detail = '';
    try {
      const rawE = await fs.readFile(path.join(ENRICH_DIR, `${f.gym_id}.json`), 'utf8');
      detail = (JSON.parse(rawE) as { detail?: { endereco?: string } }).detail?.endereco ?? '';
    } catch {
      /* none */
    }
    const hit = receitaMap.get(f.gym_id);
    const dCep = extractCepFromText(detail);
    const lCep = extractCepFromText(list);
    const anyCep = dCep || lCep || (hit?.cep ? normalizeCep(hit.cep) : null);
    if (hit) withReceita += 1;
    if (dCep) withDetailCep += 1;
    if (lCep) withListCep += 1;
    if ((dCep || lCep) && !hit) {
      detailListNoReceita += 1;
      if (samples.length < 10) {
        const cep = dCep || lCep;
        samples.push(
          `${f.gym_id.slice(0, 8)} cep=${cep} gen=${cep && isCepGenerico(cep)} name=${gym?.attributes?.name?.slice(0, 40)} detail=${detail.slice(0, 70)}`,
        );
      }
    }
    if (anyCep && isCepGenerico(anyCep)) anyGenerico += 1;
    if (anyCep && !isCepGenerico(anyCep)) anyFino += 1;
    if (!anyCep) semCep += 1;
    if ((dCep || lCep) && !hit) {
      const cep = (dCep || lCep)!;
      if (isCepGenerico(cep)) genericoNoReceita += 1;
      else finoNoReceita += 1;
    }
  }

  console.log('error taxonomy', JSON.stringify(tax, null, 2));
  console.log('with_receita_alta', withReceita);
  console.log('with_detail_cep', withDetailCep);
  console.log('with_list_cep', withListCep);
  console.log('detail/list CEP no receita', detailListNoReceita);
  console.log('  of which generico', genericoNoReceita);
  console.log('  of which fino', finoNoReceita);
  console.log('any generico CEP', anyGenerico);
  console.log('any fino CEP', anyFino);
  console.log('sem_cep_qualquer', semCep);
  console.log('samples detail/list no receita:');
  for (const s of samples) console.log(' ', s);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
