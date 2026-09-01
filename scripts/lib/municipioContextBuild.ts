import fs from 'fs';
import path from 'path';
import type { ReceitaKpisFile } from './receitaKpis.ts';
import { REGION_BY_UF } from './academia-normalize.ts';
import { enrichCityFromGymsite } from './gymsiteReceitaEnrich.ts';
import { CODIGO_RFB_PARA_MUNICIPIO } from './municipioMapper.ts';
import {
  fetchCempreMunicipios,
  fetchRendaMunicipios,
  pickSidra,
  SIDRA_CEMPRE_VARS,
  SIDRA_RENDA_VARS,
} from './sidraClient.ts';
import type {
  MercadoMunicipio,
  MunicipioContextFile,
  MunicipioContextRecord,
} from '../../src/types/municipioContext.ts';
import { computeMercadoIndices } from '../../src/types/municipioContext.ts';

export type MunicipioBrasilRow = {
  nome: string;
  ibge: string;
  uf: string;
  populacao?: number;
  lat?: number;
  lng?: number;
};

function emptyMercado(): MercadoMunicipio {
  return {
    renda_pc_mediana: null,
    renda_pc_media: null,
    pib_per_capita: null,
    empresas_atuantes: null,
    unidades_locais: null,
    pessoal_ocupado_total: null,
    pessoal_assalariado: null,
    salario_medio_mensal: null,
    academias_receita_ativos: null,
    indice_formal: null,
    empresas_por_mil: null,
    score_corporativo: null,
    fontes: [],
  };
}

function loadReceitaByIbge(receitaPath: string | null): Map<string, number> {
  const out = new Map<string, number>();
  if (!receitaPath || !fs.existsSync(receitaPath)) return out;

  const file = JSON.parse(fs.readFileSync(receitaPath, 'utf-8')) as ReceitaKpisFile;
  for (const ufNode of file.by_uf ?? []) {
    for (const city of ufNode.children ?? []) {
      const rfb = city.key.split('|').pop() ?? '';
      const hit = CODIGO_RFB_PARA_MUNICIPIO[rfb];
      const ibge = hit?.ibge;
      if (ibge?.length === 7) {
        out.set(ibge, city.ativos ?? 0);
      }
    }
  }
  return out;
}

export async function buildMunicipioContext(opts: {
  municipiosPath: string;
  receitaKpisPath?: string | null;
  pilotUf?: string | null;
  gymsiteEnrich?: boolean;
  gymsiteConcurrency?: number;
}): Promise<MunicipioContextFile> {
  const munis = JSON.parse(
    fs.readFileSync(opts.municipiosPath, 'utf-8'),
  ) as MunicipioBrasilRow[];

  const pilotUf = opts.pilotUf?.trim().toUpperCase() || null;
  const target = pilotUf ? munis.filter((m) => m.uf === pilotUf) : munis;

  console.log(`IBGE SIDRA CEMPRE + renda (${target.length} municípios)…`);
  const cempre = await fetchCempreMunicipios();
  const renda = await fetchRendaMunicipios();

  const receitaByIbge = loadReceitaByIbge(
    opts.receitaKpisPath ?? path.join(process.cwd(), 'public/receita/kpis-latest.json'),
  );

  const records: MunicipioContextRecord[] = [];

  for (const m of target) {
    const ibge = String(m.ibge).padStart(7, '0');
    const pop = m.populacao ?? 0;
    const cempreRow = cempre.get(ibge);
    const rendaRow = renda.get(ibge);
    const mercado = emptyMercado();

    if (rendaRow) {
      mercado.renda_pc_mediana = pickSidra(rendaRow, SIDRA_RENDA_VARS.renda_pc_mediana);
      mercado.renda_pc_media = pickSidra(rendaRow, SIDRA_RENDA_VARS.renda_pc_media);
      mercado.fontes.push('IBGE SIDRA 10295 (Censo 2022 renda)');
    }

    if (cempreRow) {
      mercado.empresas_atuantes = pickSidra(cempreRow, SIDRA_CEMPRE_VARS.empresas_atuantes);
      mercado.unidades_locais = pickSidra(cempreRow, SIDRA_CEMPRE_VARS.unidades_locais);
      mercado.pessoal_ocupado_total = pickSidra(cempreRow, SIDRA_CEMPRE_VARS.pessoal_ocupado_total);
      mercado.pessoal_assalariado = pickSidra(cempreRow, SIDRA_CEMPRE_VARS.pessoal_assalariado);
      mercado.salario_medio_mensal = pickSidra(cempreRow, SIDRA_CEMPRE_VARS.salario_medio_mensal);
      mercado.fontes.push('IBGE SIDRA 9509 (CEMPRE/RAIS proxy 2022)');
    }

    const receitaAtivos = receitaByIbge.get(ibge);
    if (receitaAtivos != null) {
      mercado.academias_receita_ativos = receitaAtivos;
      mercado.fontes.push('Receita CNAE 9313100 KPIs');
    }

    const indices = computeMercadoIndices(pop, mercado);
    mercado.indice_formal = indices.indice_formal;
    mercado.empresas_por_mil = indices.empresas_por_mil;
    mercado.score_corporativo = indices.score_corporativo;

    records.push({
      ibge,
      cidade: m.nome,
      uf: m.uf,
      region: REGION_BY_UF[m.uf] ?? '?',
      pop,
      lat: m.lat ?? null,
      lng: m.lng ?? null,
      mercado,
    });
  }

  if (opts.gymsiteEnrich) {
    const conc = opts.gymsiteConcurrency ?? 8;
    console.log(`GymSite PIB (concurrency ${conc})…`);
    let i = 0;
    async function worker() {
      while (i < records.length) {
        const idx = i++;
        const rec = records[idx]!;
        const enrich = await enrichCityFromGymsite(rec.ibge);
        if (enrich.status === 'ok' && enrich.pib?.pib_per_capita) {
          rec.mercado.pib_per_capita = enrich.pib.pib_per_capita;
          rec.mercado.fontes.push('GymSite municipio_pib');
        }
      }
    }
    await Promise.all(Array.from({ length: conc }, () => worker()));
  }

  const stats = {
    n_municipios: records.length,
    n_with_renda: records.filter((r) => r.mercado.renda_pc_mediana != null).length,
    n_with_empresas: records.filter((r) => r.mercado.empresas_atuantes != null).length,
    n_with_receita: records.filter((r) => r.mercado.academias_receita_ativos != null).length,
    n_with_gymsite_pib: records.filter((r) => r.mercado.pib_per_capita != null).length,
  };

  return {
    version: '1',
    generated_at: new Date().toISOString(),
    pilot_uf: pilotUf,
    definition:
      'Contexto municipal: renda (IBGE), empresas/pessoal assalariado (CEMPRE proxy RAIS), Receita CNAE academias, PIB GymSite opcional. Base corporativa WH+TP.',
    sources: {
      ibge_cempre: 'SIDRA t/9509 n6 2022',
      ibge_renda: 'SIDRA t/10295 n6 2022',
      receita_cnae: receitaByIbge.size > 0 ? 'public/receita/kpis-latest.json' : null,
      gymsite_supabase: opts.gymsiteEnrich ? 'municipio_pib' : null,
    },
    stats,
    municipios: records.sort((a, b) => b.pop - a.pop || a.cidade.localeCompare(b.cidade, 'pt-BR')),
  };
}

export function writeMunicipioContext(file: MunicipioContextFile, outData: string, outPublic: string): void {
  const json = JSON.stringify(file, null, 2);
  fs.mkdirSync(path.dirname(outData), { recursive: true });
  fs.mkdirSync(path.dirname(outPublic), { recursive: true });
  fs.writeFileSync(outData, json, 'utf-8');
  fs.writeFileSync(outPublic, json, 'utf-8');
}
