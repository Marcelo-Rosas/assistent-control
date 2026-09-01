/**
 * Gera data/geo/bairros/sao-paulo-sp.json — universo oficial de bairros de
 * São Paulo/SP = os 96 DISTRITOS municipais.
 *
 * Fonte do universo: Prefeitura de São Paulo, Lei municipal nº 11.220/1992
 *   (institui os 96 distritos), consolidada em
 *   https://pt.wikipedia.org/wiki/Divisão_territorial_e_administrativa_do_município_de_São_Paulo
 * Fonte da população: IBGE Censo Demográfico 2022, população por distrito,
 *   tabulada em
 *   https://pt.wikipedia.org/wiki/Lista_dos_distritos_de_São_Paulo_por_população
 * Extração: 2026-09-01 · 96 distritos.
 *
 * Demografia parcial: apenas populacao_2022 (IBGE 2022). area_ha /
 * densidade_hab_ha / renda_media_sm ficam pendentes de fonte oficial
 * (GeoSampa / Prefeitura Infocidade / IBGE SIDRA) — NÃO inventar.
 *
 * Run: npx tsx scripts/build-bairros-catalog-sao-paulo.ts
 */
import fs from 'fs/promises';
import path from 'path';
import {
  bairroSlug,
  type BairrosCatalog,
  type BairroCatalogEntry,
} from './lib/wellhubBairrosCatalog.ts';

/** [distrito, populacao_2022] — nomes com acentuação oficial. */
const SP_DISTRITOS: Array<[string, number]> = [
  ['Grajaú', 384873],
  ['Jardim Ângela', 311432],
  ['Capão Redondo', 270767],
  ['Sapopemba', 266715],
  ['Sacomã', 261436],
  ['Jardim São Luís', 259377],
  ['Cidade Ademar', 249218],
  ['Brasilândia', 243273],
  ['Campo Limpo', 236162],
  ['Jabaquara', 214982],
  ['Jaraguá', 211617],
  ['Itaquera', 210960],
  ['Itaim Paulista', 205295],
  ['Tremembé', 196563],
  ['Cidade Tiradentes', 194177],
  ['Cidade Dutra', 182459],
  ['Pirituba', 179724],
  ['Vila Andrade', 168669],
  ['Lajeado', 164391],
  ['Pedreira', 163586],
  ['São Mateus', 155682],
  ['Parelheiros', 153687],
  ['Iguatemi', 149700],
  ['São Rafael', 148145],
  ['Cachoeirinha', 143366],
  ['Cangaíba', 141172],
  ['Vila Curuçá', 140673],
  ['São Lucas', 138038],
  ['Freguesia do Ó', 137240],
  ['Cidade Líder', 136660],
  ['Vila Jacuí', 134189],
  ['Penha', 132452],
  ['Rio Pequeno', 131631],
  ['Jardim Helena', 129409],
  ['Saúde', 128469],
  ['José Bonifácio', 128243],
  ['Vila Mariana', 127286],
  ['Vila Sônia', 123748],
  ['Raposo Tavares', 117738],
  ['Ipiranga', 116271],
  ['Campo Grande', 115925],
  ['Santana', 115689],
  ['Vila Medeiros', 114939],
  ['Ermelino Matarazzo', 112333],
  ['Guaianases', 109316],
  ['Vila Maria', 108543],
  ['Vila Prudente', 105690],
  ['Mandaqui', 103665],
  ['Vila Matilde', 103558],
  ['Cursino', 103171],
  ['Perdizes', 102391],
  ['Itaim Bibi', 101452],
  ['Tucuruvi', 99559],
  ['Tatuapé', 98601],
  ['Artur Alvim', 95575],
  ['Vila Formosa', 92186],
  ['Ponte Rasa', 89881],
  ['Aricanduva', 89574],
  ['São Domingos', 88884],
  ['Perus', 87716],
  ['Jaçanã', 87329],
  ['Água Rasa', 85788],
  ['Santo Amaro', 85349],
  ['Carrão', 84397],
  ['Limão', 82373],
  ['Moema', 81899],
  ['Jardim Paulista', 81859],
  ['São Miguel Paulista', 81011],
  ['Santa Cecília', 80972],
  ['Mooca', 80880],
  ['Casa Verde', 80536],
  ['Lapa', 75533],
  ['Anhanguera', 75360],
  ['Parque do Carmo', 74677],
  ['Campo Belo', 71034],
  ['Liberdade', 66056],
  ['Pinheiros', 65145],
  ['República', 60825],
  ['Bela Vista', 60024],
  ['Belém', 55785],
  ['Jaguaré', 55382],
  ['Consolação', 53144],
  ['Vila Guilherme', 52587],
  ['Butantã', 51715],
  ['Vila Leopoldina', 46875],
  ['Cambuci', 45163],
  ['Morumbi', 43690],
  ['Brás', 38750],
  ['Socorro', 38051],
  ['Alto de Pinheiros', 37359],
  ['Bom Retiro', 33520],
  ['Barra Funda', 33436],
  ['Jaguara', 24730],
  ['Sé', 23832],
  ['Pari', 17359],
  ['Marsilac', 11451],
];

/**
 * Slugs alternativos confirmados via preflight
 * (scripts/preflight-wellhub-bairros.ts). A Wellhub costuma desambiguar
 * homônimos de outras cidades com sufixo "-sao-paulo". Preencher APÓS o
 * preflight provar que o slug derivado retorna vazio/404.
 */
const WELLHUB_SLUG_ALIASES: Record<string, string> = {};

async function main(): Promise<void> {
  const bairros: BairroCatalogEntry[] = SP_DISTRITOS.map(
    ([bairro, populacao_2022]) => {
      const slug = bairroSlug(bairro);
      const wellhub_slug = WELLHUB_SLUG_ALIASES[slug];
      return {
        slug,
        bairro,
        ...(wellhub_slug ? { wellhub_slug } : {}),
        populacao_2022,
      };
    },
  );

  const catalog: BairrosCatalog = {
    cidade: 'São Paulo',
    uf: 'SP',
    ibge: '3550308',
    fonte:
      'Prefeitura de São Paulo — Lei municipal 11.220/1992 (96 distritos) / IBGE Censo 2022 (população por distrito)',
    bairros,
  };

  const outPath = path.join(process.cwd(), 'data/geo/bairros/sao-paulo-sp.json');
  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, JSON.stringify(catalog, null, 2), 'utf-8');
  console.log(`Wrote ${bairros.length} distritos → ${outPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
