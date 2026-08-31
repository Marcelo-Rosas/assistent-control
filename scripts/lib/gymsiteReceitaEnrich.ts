import { createClient } from '@supabase/supabase-js';
import type { ReceitaBlogFicha } from './receitaBlogReport.ts';

export type GymsiteBloco = ReceitaBlogFicha['gymsite'];

type QueryResult<T> = { data: T[] | null; error: { message?: string } | null };

/** Minimal surface used by enrich — injectable for tests. */
export type GymsiteEnrichClient = {
  from: (table: string) => {
    select: (cols: string) => {
      eq: (col: string, val: string) => {
        limit: (n: number) => PromiseLike<QueryResult<Record<string, unknown>>>;
      };
    };
  };
};

export type EnrichOpts = {
  url?: string;
  key?: string;
  client?: GymsiteEnrichClient;
};

type PibRow = {
  id_municipio: string;
  populacao: number;
  pib_reais: number;
  pib_per_capita: number;
  ano: number;
  fonte: string;
};

type RendaRow = {
  bairro: string;
  renda_pc: number | null;
  renda_media?: number | null;
};

function median(nums: number[]): number | null {
  if (nums.length === 0) return null;
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1]! + sorted[mid]!) / 2;
  }
  return sorted[mid]!;
}

function resolveCreds(opts: EnrichOpts): { url: string; key: string } | null {
  const url =
    opts.url ??
    process.env.GYMSITE_SUPABASE_URL ??
    process.env.SUPABASE_URL ??
    '';
  const key =
    opts.key ??
    process.env.GYMSITE_SUPABASE_SERVICE_ROLE_KEY ??
    process.env.SUPABASE_SERVICE_ROLE_KEY ??
    '';
  if (!url.trim() || !key.trim()) return null;
  return { url, key };
}

export async function enrichCityFromGymsite(
  ibge: string,
  opts: EnrichOpts = {},
): Promise<GymsiteBloco> {
  if (!ibge?.trim()) {
    return { status: 'indisponivel', motivo: 'missing_ibge' };
  }

  let cli: GymsiteEnrichClient;
  if (opts.client) {
    cli = opts.client;
  } else {
    const creds = resolveCreds(opts);
    if (!creds) {
      return { status: 'indisponivel', motivo: 'missing_gymsite_supabase_env' };
    }
    cli = createClient(creds.url, creds.key) as unknown as GymsiteEnrichClient;
  }

  try {
    const pibRes = await cli
      .from('municipio_pib')
      .select('id_municipio,populacao,pib_reais,pib_per_capita,ano,fonte')
      .eq('id_municipio', ibge)
      .limit(1);

    if (pibRes.error) {
      return {
        status: 'indisponivel',
        motivo: `municipio_pib: ${pibRes.error.message ?? 'error'}`.slice(0, 200),
      };
    }

    const rendaRes = await cli
      .from('renda_bairro')
      .select('bairro,renda_pc,renda_media')
      .eq('municipio_cod', ibge)
      .limit(5000);

    if (rendaRes.error) {
      return {
        status: 'indisponivel',
        motivo: `renda_bairro: ${rendaRes.error.message ?? 'error'}`.slice(0, 200),
      };
    }

    const pibRow = (pibRes.data?.[0] ?? null) as PibRow | null;
    const rendaRows = (rendaRes.data ?? []) as RendaRow[];

    if (!pibRow && rendaRows.length === 0) {
      return { status: 'indisponivel', motivo: 'empty_municipio_pib_and_renda_bairro' };
    }

    const pcs = rendaRows
      .map((r) => r.renda_pc)
      .filter((n): n is number => typeof n === 'number' && Number.isFinite(n));
    const top3 = [...rendaRows]
      .filter((r) => typeof r.renda_pc === 'number')
      .sort((a, b) => (b.renda_pc ?? 0) - (a.renda_pc ?? 0))
      .slice(0, 3)
      .map((r) => ({ bairro: r.bairro, renda_pc: r.renda_pc as number }));

    const out: GymsiteBloco = { status: 'ok' };

    if (pibRow) {
      out.pib = {
        populacao: Number(pibRow.populacao),
        pib_reais: Number(pibRow.pib_reais),
        pib_per_capita: Number(pibRow.pib_per_capita),
        ano: Number(pibRow.ano),
        fonte: String(pibRow.fonte || 'municipio_pib'),
      };
    }

    if (rendaRows.length > 0) {
      const med = median(pcs);
      out.renda = {
        n_bairros: rendaRows.length,
        renda_pc_mediana: med ?? 0,
        top3,
        fonte: 'renda_bairro (GymSite / IBGE Censo 2022)',
      };
    }

    if (!out.pib && !out.renda) {
      return { status: 'indisponivel', motivo: 'empty_after_parse' };
    }

    return out;
  } catch (e) {
    return {
      status: 'indisponivel',
      motivo: String(e).slice(0, 200),
    };
  }
}
