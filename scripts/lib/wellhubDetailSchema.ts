/**
 * Wellhub Pass 2 — schema extraído da página de detalhe do parceiro.
 * URL: https://wellhub.com/pt-br/search/partners/{gym_id}
 */

export const WELLHUB_PARTNER_DETAIL_URL = (gymId: string): string =>
  `https://wellhub.com/pt-br/search/partners/${gymId}`;

export type WellhubDetailHorarioBloco = {
  plano: string;
  titulo: string | null;
  dias: Record<string, string>;
};

export type WellhubDetailSchema = {
  gym_id: string;
  detail_url: string;
  nome: string | null;
  avaliacao: {
    nota: number | null;
    total_avaliacoes: number | null;
  };
  sobre: string | null;
  endereco_completo: string | null;
  endereco_json_ld: {
    streetAddress?: string;
    addressLocality?: string;
    addressRegion?: string;
    postalCode?: string;
    addressCountry?: string;
  } | null;
  contato: {
    telefone: string | null;
    facebook: string | null;
    instagram: string | null;
    website: string | null;
  };
  comodidades: string[];
  horarios: WellhubDetailHorarioBloco[];
  horarios_json_ld: Array<{ dayOfWeek: string[]; opens: string; closes: string }>;
  atividades: {
    inclusas_horario_especifico: string[];
    outras: string[];
  };
  planos_pagina: Array<{ nome: string; preco: string | null }>;
  planos_acesso: Array<{ plano: string; descricao: string | null; preco: string | null }>;
  fotos: string[];
  maps_url: string | null;
};

type JsonLd = Record<string, unknown>;

function extractJsonLd(html: string): JsonLd | null {
  const m = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
  if (!m) return null;
  try {
    return JSON.parse(m[1]) as JsonLd;
  } catch {
    return null;
  }
}

function parseRating(text: string): { nota: number | null; total: number | null } {
  const notaM = text.match(/(\d+[.,]\d+)\s*\n?\s*\((\d[\d.]*)\s*Avalia/i);
  if (notaM) {
    return {
      nota: Number(notaM[1].replace(',', '.')),
      total: Number(notaM[2].replace(/\./g, '')),
    };
  }
  return { nota: null, total: null };
}

function sectionAfter(text: string, heading: string): string {
  const idx = text.indexOf(heading);
  if (idx < 0) return '';
  return text.slice(idx + heading.length);
}

function linesUntil(text: string, stopWords: string[]): string[] {
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  const out: string[] = [];
  for (const line of lines) {
    if (stopWords.some((s) => line.startsWith(s) || line === s)) break;
    out.push(line);
  }
  return out;
}

export function extractWellhubDetailFromText(
  bodyText: string,
  gymId: string,
  detailUrl: string,
  jsonLd: JsonLd | null,
): WellhubDetailSchema {
  const rating = parseRating(bodyText);
  const sobreBlock = sectionAfter(bodyText, 'Sobre ');
  const sobreLines = linesUntil(sobreBlock, ['Comodidades', 'Horário de funcionamento']);
  const sobre = sobreLines.join(' ').replace(/^[^\n]+\n/, '').trim() || null;

  const comodBlock = sectionAfter(bodyText, 'O que este parceiro oferece');
  const comodidades = linesUntil(comodBlock, ['Horário de funcionamento', 'Horários disponíveis']).filter(
    (l) => l.length > 2 && l.length < 80,
  );

  const contatoBlock = sectionAfter(bodyText, 'Informações de contato');
  const contatoLines = linesUntil(contatoBlock, ['Como chegar', 'Descubra o plano']);
  const telefone = contatoLines.find((l) => /\(\d{2}\)/.test(l)) || null;
  const facebook = contatoLines.find((l) => l.includes('facebook.com')) || null;
  const instagram = contatoLines.find((l) => l.includes('instagram.com')) || null;
  const website =
    contatoLines.find((l) => /^https?:\/\//.test(l) && !l.includes('facebook') && !l.includes('instagram')) ||
    null;

  const enderecoMatch = bodyText.match(
    /Como chegar[\s\S]*?\n([^\n]+(?:Brasil)?)\n/,
  );
  const endereco_completo = enderecoMatch?.[1]?.trim() || null;

  const planos_pagina: WellhubDetailSchema['planos_pagina'] = [];
  for (const m of bodyText.matchAll(/(Basic\+?|Silver|Gold|Diamond|Starter)\n\nR\$ [\d.,]+ \/ mês/g)) {
    const nome = m[1];
    const precoM = m[0].match(/R\$ [\d.,]+ \/ mês/);
    planos_pagina.push({ nome, preco: precoM?.[0] || null });
  }

  const planos_acesso: WellhubDetailSchema['planos_acesso'] = [];
  const acessoM = bodyText.match(
    /Horários específicos com ([^\n]+) • ([^\n]+)\nTodos os horários com ([^\n]+) • ([^\n]+)/,
  );
  if (acessoM) {
    planos_acesso.push({
      plano: acessoM[1].trim(),
      descricao: 'Horários específicos',
      preco: acessoM[2].trim(),
    });
    planos_acesso.push({
      plano: acessoM[3].trim(),
      descricao: 'Todos os horários',
      preco: acessoM[4].trim(),
    });
  }

  const ativEsp = sectionAfter(bodyText, 'Incluso em horários específicos');
  const inclusas = linesUntil(ativEsp, ['Outras atividades', 'Informações de contato']).filter(
    (l) => !l.startsWith('Mostrar'),
  );
  const outrasBlock = sectionAfter(bodyText, 'Outras atividades');
  const outras = linesUntil(outrasBlock, ['Informações de contato']).filter((l) => !l.startsWith('Mostrar'));

  const addr = (jsonLd?.address as WellhubDetailSchema['endereco_json_ld']) || null;
  const opening = Array.isArray(jsonLd?.openingHoursSpecification)
    ? (jsonLd.openingHoursSpecification as WellhubDetailSchema['horarios_json_ld'])
    : [];

  const amenitiesLd = Array.isArray(jsonLd?.amenityFeature)
    ? (jsonLd.amenityFeature as Array<{ name?: string }>).map((a) => a.name).filter(Boolean)
    : [];

  return {
    gym_id: gymId,
    detail_url: detailUrl,
    nome: (jsonLd?.name as string) || null,
    avaliacao: { nota: rating.nota, total_avaliacoes: rating.total },
    sobre,
    endereco_completo,
    endereco_json_ld: addr,
    contato: { telefone, facebook, instagram, website },
    comodidades: comodidades.length ? comodidades : amenitiesLd.filter((x): x is string => !!x),
    horarios: [],
    horarios_json_ld: opening,
    atividades: {
      inclusas_horario_especifico: inclusas,
      outras,
    },
    planos_pagina,
    planos_acesso,
    fotos: jsonLd?.image ? [String(jsonLd.image)] : [],
    maps_url: endereco_completo ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(endereco_completo)}` : null,
  };
}

export function extractWellhubDetailFromHtml(html: string, gymId: string): WellhubDetailSchema {
  const detailUrl = WELLHUB_PARTNER_DETAIL_URL(gymId);
  const jsonLd = extractJsonLd(html);
  const textMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  const roughText = textMatch?.[1]?.replace(/<[^>]+>/g, '\n').replace(/\s+\n/g, '\n') || '';
  return extractWellhubDetailFromText(roughText, gymId, detailUrl, jsonLd);
}

export type WellhubPass2Record = {
  pass1: Record<string, unknown>;
  pass2: WellhubDetailSchema;
  enriched_at: string;
};
