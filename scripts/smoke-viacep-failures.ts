/**
 * Smoke ViaCEP F2.2 on failures elegíveis (read-only, no index write).
 * Run: npx tsx scripts/smoke-viacep-failures.ts --limit=15
 */
import {
  loadTpBairroIndex,
} from './lib/tpBairroResolver.ts';
import { loadTpReceitaCepMap } from './lib/tpReceitaCepMatch.ts';
import {
  buildLogradouroSearchQueries,
  isCepGenerico,
  lookupBairroFromCep,
  refineCepViaLogradouro,
} from './lib/tpCepResolver.ts';

const LIMIT = Number(process.argv.find((a) => a.startsWith('--limit='))?.split('=')[1] || 15);
const DELAY_MS = Number(process.env.DELAY_MS || 1100);

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function main(): Promise<void> {
  console.log(`ViaCEP smoke F2.2 (limit=${LIMIT})\n`);

  const index = (await loadTpBairroIndex('data/processed/tp-bairro-index.json'))!;
  const map = await loadTpReceitaCepMap();
  const failIds = (index.failures ?? []).map((f) => f.gym_id);

  let tested = 0;
  let ok = 0;

  for (const id of failIds) {
    const hit = map.get(id);
    if (!hit || !isCepGenerico(hit.cep)) continue;

    tested += 1;
    if (tested > LIMIT) break;

    const queries = buildLogradouroSearchQueries(hit.tipo_logradouro, hit.logradouro);
    const refined = await refineCepViaLogradouro({
      cep_rf: hit.cep,
      uf: hit.uf,
      municipio: hit.municipio,
      logradouro: hit.logradouro,
      tipo_logradouro: hit.tipo_logradouro,
      numero: hit.numero,
    });

    const lookup =
      refined.ok ? await lookupBairroFromCep(refined.cep) : null;

    if (lookup) ok += 1;

    console.log(
      [
        hit.tp_name?.slice(0, 36) ?? id.slice(0, 8),
        `cep_rf=${hit.cep}`,
        `q=[${queries.slice(0, 2).join(' | ')}]`,
        refined.ok ? `→ ${refined.cep}` : `→ ${refined.reason}`,
        lookup ? lookup.bairro : '-',
      ].join(' · '),
    );

    if (tested < LIMIT) await sleep(DELAY_MS);
  }

  console.log(`\nSMOKE: tested=${tested} ok=${ok}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
