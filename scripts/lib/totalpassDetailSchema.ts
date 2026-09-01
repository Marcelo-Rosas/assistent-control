/**
 * Extrai schema de qualidade TotalPass (Pass 2) de uma página de detalhe.
 */

export type TotalPassDetailSchema = {
  academia: string;
  url: string;
  endereco: string;
  contato: {
    telefone: string | null;
    instagram: string | null;
    email: string | null;
  };
  modalidades: string[];
  modalidades_e_planos: Array<{
    modalidade: string;
    categoria: string;
    plano_minimo: string;
  }>;
  horarios_academia: Record<string, string>;
  comodidades: string[];
};

type ModalityRef = { id: string; translated_name: string };
type GymPlan = { categoria: string; plano_minimo: string; modality_ids: string[] };

function unescapeJs(s: string): string {
  try {
    return JSON.parse(`"${s}"`) as string;
  } catch {
    return s.replace(/\\"/g, '"').replace(/\\\\/g, '\\');
  }
}

function extractJsonLd(html: string): Record<string, unknown> {
  const m = html.match(/<script type="application\/ld\+json">(.*?)<\/script>/s);
  if (!m) return {};
  try {
    return JSON.parse(m[1]) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function extractModalities(html: string): ModalityRef[] {
  const blockM = html.match(/\\"modalities\\":\[([\s\S]*?)\]\}/);
  if (!blockM) return [];
  const out: ModalityRef[] = [];
  for (const m of blockM[1].matchAll(
    /\\"id\\":\\"(\d+)\\"[\s\S]*?\\"translated_name\\":\\"(.*?)\\"/g,
  )) {
    out.push({ id: m[1], translated_name: unescapeJs(m[2]) });
  }
  return out;
}

function extractGymPlans(html: string): GymPlan[] {
  const plans: GymPlan[] = [];
  for (const m of html.matchAll(
    /\\"type\\":\\"gym_plan\\"[\s\S]*?\\"name\\":\\"(.*?)\\"[\s\S]*?\\"accessible_from_standard_plan\\":\{\\"name\\":\\"(.*?)\\"[\s\S]*?\\"relationships\\":\{\\"modalities\\":\{\\"data\\":\[([\s\S]*?)\]\}/g,
  )) {
    const ids = [...m[3].matchAll(/\\"id\\":\\"(\d+)\\"/g)].map((x) => x[1]);
    plans.push({
      categoria: unescapeJs(m[1]),
      plano_minimo: unescapeJs(m[2]),
      modality_ids: ids,
    });
  }
  return plans;
}

function extractStructures(html: string): string[] {
  const m = html.match(/\\"structures\\":\[([\s\S]*?)\]/);
  if (!m) return [];
  return [...m[1].matchAll(/\\"(.*?)\\"/g)].map((x) => unescapeJs(x[1]));
}

function extractGymHours(html: string): Record<string, string> {
  const out: Record<string, string> = {};
  const blockM = html.match(/\\"gymHours\\":\[([\s\S]*?)\]/);
  if (!blockM) return out;
  for (const m of blockM[1].matchAll(
    /\\"day\\":\\"(.*?)\\",\\"businessHours\\":\\"(.*?)\\"/g,
  )) {
    const day = unescapeJs(m[1]).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    out[day] = unescapeJs(m[2]);
  }
  return out;
}

function scalarField(html: string, key: string): string | null {
  const m = html.match(new RegExp(`\\\\"${key}\\\\":\\\\"(.*?)\\\\"`));
  return m ? unescapeJs(m[1]) : null;
}

export function extractTotalPassDetailSchema(
  html: string,
  pageUrl: string,
): TotalPassDetailSchema {
  const jsonld = extractJsonLd(html);
  const addr = jsonld.address as { streetAddress?: string } | undefined;
  const modalities = extractModalities(html);
  const byId = new Map(modalities.map((m) => [m.id, m.translated_name]));
  const gymPlans = extractGymPlans(html);
  const website = scalarField(html, 'website');

  const modalidades_e_planos: TotalPassDetailSchema['modalidades_e_planos'] = [];
  for (const plan of gymPlans) {
    for (const id of plan.modality_ids) {
      const name = byId.get(id);
      if (!name) continue;
      modalidades_e_planos.push({
        modalidade: name,
        categoria: plan.categoria,
        plano_minimo: plan.plano_minimo,
      });
    }
  }

  return {
    academia: String(jsonld.name || ''),
    url: pageUrl,
    endereco: addr?.streetAddress || '',
    contato: {
      telefone: (jsonld.telephone as string) || null,
      instagram: website,
      email: scalarField(html, 'email'),
    },
    modalidades: modalities.map((m) => m.translated_name),
    modalidades_e_planos,
    horarios_academia: extractGymHours(html),
    comodidades: extractStructures(html),
  };
}

export async function fetchTotalPassDetailSchema(slug: string): Promise<TotalPassDetailSchema> {
  const url = `https://totalpass.com/br/academias/${slug}/`;
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; GymSitePipeline/1.0)',
      'Accept-Language': 'pt-BR,pt;q=0.9',
    },
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} em ${url}`);
  }
  const html = await res.text();
  return extractTotalPassDetailSchema(html, url);
}
