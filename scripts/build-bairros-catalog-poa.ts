/**
 * Gera data/geo/bairros/porto-alegre-rs.json a partir dos dados oficiais POA (IBGE 2022).
 * Run: npx tsx scripts/build-bairros-catalog-poa.ts
 */
import fs from 'fs/promises';
import path from 'path';
import {
  bairroSlug,
  type BairrosCatalog,
  type BairroCatalogEntry,
} from './lib/wellhubBairrosCatalog.ts';

/** [bairro, area_ha, populacao_2022, densidade_hab_ha, renda_media_sm] */
const POA_BAIRROS: Array<[string, number, number, number, number]> = [
  ['Aberta dos Morros', 376, 9854, 26.2, 2.95],
  ['Agronomia', 886, 2677, 3, 2.59],
  ['Anchieta', 917, 791, 0.9, 1.49],
  ['Arquipélago', 4402, 6411, 1.5, 1.85],
  ['Auxiliadora', 84, 8909, 106.1, 8.89],
  ['Azenha', 139, 12064, 86.8, 5.34],
  ['Bela Vista', 102, 11819, 115.9, 15.8],
  ['Belém Novo', 1486, 9851, 6.6, 3.86],
  ['Belém Velho', 1486, 10893, 7.3, 2.1],
  ['Boa Vista', 169, 9254, 54.8, 11.08],
  ['Boa Vista do Sul', 2437, 2703, 1.1, 2.28],
  ['Bom Jesus', 210, 24589, 117.1, 2.45],
  ['Bom Fim', 50, 10160, 203.2, 7.2],
  ['Camaquã', 190, 17935, 94.4, 3.65],
  ['Campo Novo', 360, 8743, 24.3, 2.04],
  ['Cascata', 535, 9234, 17.3, 1.77],
  ['Cavalhada', 376, 25209, 67.1, 3.88],
  ['Centro', 244, 30569, 125.3, 5.85],
  ['Chácara das Pedras', 109, 5639, 51.7, 11.55],
  ['Chapéu do Sol', 599, 5547, 9.3, 1.88],
  ['Cidade Baixa', 76, 13014, 171.2, 5.3],
  ['Coronel Aparício Borges', 285, 18966, 66.5, 2.11],
  ['Costa e Silva', 179, 13585, 75.9, 2.03],
  ['Cristal', 407, 24851, 61.1, 4.26],
  ['Cristo Redentor', 143, 15144, 105.9, 5.26],
  ['Espírito Santo', 159, 4953, 31.2, 5.8],
  ['Extrema', 2160, 2360, 1.1, 1.73],
  ['Farrapos', 227, 17591, 77.5, 1.85],
  ['Farroupilha', 59, 774, 13.1, 8.1],
  ['Floresta', 187, 8798, 47, 4.82],
  ['Glória', 335, 15248, 45.5, 3.06],
  ['Guarujá', 169, 6145, 36.3, 5.24],
  ['Higienópolis', 106, 10284, 97, 9.78],
  ['Hípica', 1033, 28643, 27.7, 3.06],
  ['Humaitá', 362, 12744, 35.2, 3.55],
  ['Independência', 44, 6885, 156.5, 8.69],
  ['Ipanema', 380, 13403, 35.2, 6.94],
  ['Jardim Botânico', 204, 11349, 55.6, 6.78],
  ['Jardim Carvalho', 392, 23405, 59.7, 3.24],
  ['Jardim Leopoldina', 130, 16151, 124.2, 2.65],
  ['Jardim Floresta', 72, 2228, 30.9, 3.16],
  ['Jardim Isabel', 71, 2592, 36.5, 13.27],
  ['Jardim Europa', 76, 4372, 57.5, 12.84],
  ['Jardim Itu', 256, 17565, 68.6, 5.42],
  ['Jardim Sabará', 208, 11270, 54.2, 3.97],
  ['Jardim Lindóia', 88, 7587, 86.2, 8.85],
  ['Jardim do Salso', 86, 6576, 76.5, 5.96],
  ['Jardim São Pedro', 103, 3320, 32.2, 5.04],
  ['Lageado', 2277, 5676, 2.5, 2.24],
  ['Lami', 1749, 6677, 3.8, 1.87],
  ['Lomba do Pinheiro', 2975, 59200, 19.9, 1.81],
  ['Mário Quintana', 750, 44068, 58.7, 1.54],
  ['Medianeira', 140, 8749, 62.5, 4.68],
  ['Menino Deus', 230, 27961, 121.5, 7.95],
  ['Moinhos de Vento', 131, 9995, 76.3, 12.03],
  ["Mont'Serrat", 79, 10357, 131.1, 11.38],
  ['Morro Santana', 574, 21640, 37.7, 3.09],
  ['Navegantes', 226, 3315, 14.6, 3.22],
  ['Nonoai', 446, 20766, 46.5, 4.18],
  ['Parque Santa Fé', 173, 6673, 38.5, 4.63],
  ['Partenon', 640, 43587, 68.1, 4.01],
  ["Passo D'Areia", 209, 22530, 107.7, 4.73],
  ['Passo das Pedras', 230, 14435, 62.7, 1.76],
  ['Pedra Redonda', 67, 570, 8.5, 16.61],
  ['Petrópolis', 337, 37613, 111.6, 9.69],
  ['Pitinga', 870, 7012, 8, 1.92],
  ['Ponta Grossa', 1064, 8939, 8.4, 2.27],
  ['Praia de Belas', 257, 1522, 5.9, 6.24],
  ['Restinga', 2010, 62448, 31, 1.76],
  ['Rio Branco', 134, 15710, 117.2, 10.9],
  ['Rubem Berta', 269, 27930, 103.8, 2.16],
  ['Santa Cecília', 68, 4640, 68.2, 6.92],
  ['Santa Maria Goretti', 78, 3035, 38.9, 4.01],
  ['Santa Rosa de Lima', 548, 34627, 63.2, 1.88],
  ['Santa Tereza', 452, 31358, 69.4, 3.35],
  ['Santana', 153, 17794, 116.3, 6.63],
  ['Santo Antônio', 137, 13105, 95.6, 4.72],
  ['São Caetano', 830, 733, 0.9, 2.37],
  ['São Geraldo', 174, 6948, 39.9, 3.97],
  ['São João', 159, 10621, 66.8, 6.56],
  ['São Sebastião', 106, 7514, 70.9, 4.78],
  ['Sarandi', 2457, 51539, 20.9, 3.08],
  ['Serraria', 323, 4385, 13.5, 2.5],
  ['Sétimo Céu', 154, 1166, 7.6, 10.91],
  ['Teresópolis', 386, 13072, 33.8, 5.29],
  ['Três Figueiras', 133, 4016, 30.2, 16.1],
  ['Tristeza', 261, 17201, 65.9, 7.88],
  ['Vila Assunção', 136, 3974, 29.2, 10.14],
  ['Vila Conceição', 37, 969, 26.2, 7.93],
  ['Vila Ipiranga', 182, 18041, 99.1, 4.6],
  ['Vila Jardim', 147, 11411, 77.6, 3.53],
  ['Vila João Pessoa', 112, 10431, 93.1, 2.88],
  ['Vila Nova', 1203, 32217, 26.8, 3.14],
  ['Vila São José', 304, 24011, 78.9, 2.09],
];

/**
 * Slugs confirmados via preflight (scripts/probe-wh-bairro-aliases.ts).
 * A Wellhub nem sempre aceita o slug derivado do nome oficial da prefeitura.
 */
const WELLHUB_SLUG_ALIASES: Record<string, string> = {
  'boa-vista-do-sul': 'boa-vista-sul',
  'bom-jesus': 'bom-jesus-porto-alegre',
  'bom-fim': 'bomfim',
  'campo-novo': 'campo-novo-porto-alegre',
  'costa-e-silva': 'costa-e-silva-porto-alegre',
  cristal: 'cristal-porto-alegre',
  extrema: 'extrema-porto-alegre',
  medianeira: 'medianeira-porto-alegre',
  'passo-d-areia': 'passo-de-areia',
  santana: 'santana-porto-alegre',
  'sao-caetano': 'sao-caetano-porto-alegre',
  'sao-sebastiao': 'sao-sebastiao-porto-alegre',
  'vila-conceicao': 'vila-conceicao-porto-alegre',
};

async function main(): Promise<void> {
  const bairros: BairroCatalogEntry[] = POA_BAIRROS.map(
    ([bairro, area_ha, populacao_2022, densidade_hab_ha, renda_media_sm]) => {
      const slug = bairroSlug(bairro);
      const wellhub_slug = WELLHUB_SLUG_ALIASES[slug];
      return {
        slug,
        bairro,
        ...(wellhub_slug ? { wellhub_slug } : {}),
        area_ha,
        populacao_2022,
        densidade_hab_ha,
        renda_media_sm,
      };
    },
  );

  const catalog: BairrosCatalog = {
    cidade: 'Porto Alegre',
    uf: 'RS',
    ibge: '4314902',
    fonte: 'Prefeitura Porto Alegre / IBGE Censo 2022',
    bairros,
  };

  const outPath = path.join(process.cwd(), 'data/geo/bairros/porto-alegre-rs.json');
  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, JSON.stringify(catalog, null, 2), 'utf-8');
  console.log(`Wrote ${bairros.length} bairros → ${outPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
