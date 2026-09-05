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

/** Amenity-like tokens that TP sometimes puts in `modalities`. Folded (PT, no accent). */
export const TP_AMENITY_ALIASES: Record<string, string> = {
  'area infantil': 'Espaço Kids',
  'area infantil supervisada': 'Espaço Kids',
  'area infantil supervisionada': 'Espaço Kids',
  'espaco kids': 'Espaço Kids',
  'espaco kid': 'Espaço Kids',
  'banheiro infantil': 'Banheiro Infantil',
  'vestiario infantil': 'Vestiário Infantil',
  playground: 'Playground',
  bercario: 'Berçário',
  fraldario: 'Fraldário',
};

export function normalizeTpLabel(raw: string): string {
  return String(raw ?? '').replace(/\s+/g, ' ').trim();
}

function foldPt(s: string): string {
  return normalizeTpLabel(s)
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase();
}

function isSnakeCaseSlug(s: string): boolean {
  return /^[a-z0-9]+(?:_[a-z0-9]+)+$/.test(s);
}

/** Prefers translated_name over snake_case `name` slug. */
export function pickDisplayName(name?: string, translatedName?: string): string {
  const translated = normalizeTpLabel(translatedName ?? '');
  const slugOrName = normalizeTpLabel(name ?? '');
  if (translated && !isSnakeCaseSlug(translated)) return translated;
  if (slugOrName && !isSnakeCaseSlug(slugOrName)) return slugOrName;
  return translated || slugOrName;
}

export function amenityCanonicalName(label: string): string | null {
  const folded = foldPt(label);
  if (!folded) return null;
  if (TP_AMENITY_ALIASES[folded]) return TP_AMENITY_ALIASES[folded];
  if (folded.startsWith('area infantil ')) return 'Espaço Kids';
  return null;
}

function dedupeLabels(labels: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of labels) {
    const n = normalizeTpLabel(raw);
    if (!n) continue;
    const key = foldPt(n);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(n);
  }
  return out;
}

/** Move amenity-like items from modalidades → comodidades (dedup). Sports stay. */
export function remapAmenityLikeModalities(
  modalidades: string[],
  comodidades: string[],
): { modalidades: string[]; comodidades: string[] } {
  const kept: string[] = [];
  const moved: string[] = [];
  for (const raw of modalidades) {
    const n = normalizeTpLabel(raw);
    if (!n) continue;
    const canon = amenityCanonicalName(n);
    if (canon) moved.push(canon);
    else kept.push(n);
  }
  const amenities = [
    ...comodidades.map((c) => amenityCanonicalName(c) ?? normalizeTpLabel(c)),
    ...moved,
  ];
  return { modalidades: dedupeLabels(kept), comodidades: dedupeLabels(amenities) };
}

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
    /\\"id\\":\\"(\d+)\\"([\s\S]*?)\\"translated_name\\":\\"(.*?)\\"/g,
  )) {
    const rest = m[2];
    const translated = unescapeJs(m[3]);
    const nameM = rest.match(/\\"name\\":\\"(.*?)\\"/);
    const slugName = nameM ? unescapeJs(nameM[1]) : undefined;
    out.push({ id: m[1], translated_name: pickDisplayName(slugName, translated) });
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
  const translated = [...m[1].matchAll(/\\"translated_name\\":\\"(.*?)\\"/g)].map((x) =>
    unescapeJs(x[1]),
  );
  if (translated.length) return translated;
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

  const remapped = remapAmenityLikeModalities(
    modalities.map((m) => m.translated_name),
    extractStructures(html),
  );

  const modalidades_e_planos: TotalPassDetailSchema['modalidades_e_planos'] = [];
  for (const plan of gymPlans) {
    for (const id of plan.modality_ids) {
      const name = byId.get(id);
      if (!name || amenityCanonicalName(name)) continue;
      modalidades_e_planos.push({
        modalidade: normalizeTpLabel(name),
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
    modalidades: remapped.modalidades,
    modalidades_e_planos,
    horarios_academia: extractGymHours(html),
    comodidades: remapped.comodidades,
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
