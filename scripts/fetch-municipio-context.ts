/**
 * Gera municipio-context.json — renda, empresas (CEMPRE/RAIS proxy), Receita CNAE, PIB GymSite.
 *
 * Run:
 *   npm run fetch:municipio-context
 *   npm run fetch:municipio-context -- --uf SP --gymsite
 */
import path from 'path';
import {
  buildMunicipioContext,
  writeMunicipioContext,
} from './lib/municipioContextBuild.ts';

const ROOT = process.cwd();
const args = process.argv.slice(2);

function arg(flag: string): string | undefined {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
}

const pilotUf = arg('--uf') ?? process.env.PILOT_UF ?? 'SP';
const gymsite = args.includes('--gymsite') || process.env.GYMSITE_ENRICH === '1';

const outData = path.join(ROOT, 'data/municipio-context.json');
const outPublic = path.join(ROOT, 'public/data/municipio-context.json');
const munPath = process.env.MUNICIPIOS_PATH ?? path.join(ROOT, 'data/municipios-brasil.json');

async function main(): Promise<void> {
  const file = await buildMunicipioContext({
    municipiosPath: munPath,
    pilotUf,
    gymsiteEnrich: gymsite,
    gymsiteConcurrency: Number(process.env.GYMSITE_CONCURRENCY || 8),
  });

  writeMunicipioContext(file, outData, outPublic);

  console.log('Stats:', file.stats);
  console.log('Salvo:', outData);
  console.log('Salvo:', outPublic);

  const pontal = file.municipios.find((m) => m.ibge === '3540200');
  if (pontal) {
    console.log('Exemplo Pontal:', {
      pop: pontal.pop,
      renda: pontal.mercado.renda_pc_mediana,
      empresas: pontal.mercado.empresas_atuantes,
      assalariado: pontal.mercado.pessoal_assalariado,
      score_corporativo: pontal.mercado.score_corporativo,
    });
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
