/**
 * Indexadores multi-domínio: GP / TP / regulatório / genérico.
 * Detecta schema do JSON e emite KnowledgeChunk[].
 */
import { chunksFromGpPayload } from './gpKnowledgeAgent';
import type { KnowledgeChunk, KnowledgeDomain } from './knowledgeTypes';

function slug(s: string) {
  return String(s)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

export function detectDomain(payload: unknown): KnowledgeDomain {
  const doc = (payload || {}) as Record<string, unknown>;
  const agg = String(doc.aggregator || doc.ingest_kind || '').toLowerCase();
  if (agg.includes('gurupass') || Array.isArray(doc.academias)) return 'gurupass';
  if (agg.includes('totalpass') || Array.isArray(doc.partners)) return 'totalpass';
  if (agg.includes('wellhub')) return 'wellhub';
  if (
    agg.includes('regulator') ||
    doc.domain === 'regulatory' ||
    doc.kind === 'regulatory' ||
    Array.isArray(doc.laws) ||
    Array.isArray(doc.normas)
  ) {
    return 'regulatory';
  }
  if (Array.isArray(doc.pages) || Array.isArray(doc.documents) || typeof doc.text === 'string') {
    if (doc.domain === 'regulatory') return 'regulatory';
    return 'generic';
  }
  if (Array.isArray(doc.accept_list)) return 'gurupass';
  return 'generic';
}

/** TP enrich fixture / partners[] */
export function chunksFromTpPayload(payload: unknown, sourceRef: string): KnowledgeChunk[] {
  const doc = payload as Record<string, unknown>;
  const partners = (doc.partners || []) as Array<Record<string, unknown>>;
  const prices = (doc.catalog_prices_brl || {}) as Record<string, number>;
  const chunks: KnowledgeChunk[] = [];

  if (Object.keys(prices).length) {
    chunks.push({
      chunk_id: 'tp-catalog-prices',
      chunk_type: 'tp_catalog',
      text: `TotalPass preços: ${Object.entries(prices)
        .map(([k, v]) => `${k}=R$${v}`)
        .join('; ')}`,
      meta: { domain: 'totalpass', catalog_prices_brl: prices, source_ref: sourceRef },
    });
  }

  for (const p of partners) {
    const hint = (p.plan_hint || {}) as Record<string, unknown>;
    const name = String(p.name || p.slug || 'partner');
    const plan = String(hint.plan_minimo || '');
    const price =
      hint.price_brl_month != null
        ? Number(hint.price_brl_month)
        : prices[plan.replace(/\s+/g, '')] ?? prices[plan] ?? null;
    const partner = {
      name,
      slug: p.slug,
      url: p.url,
      plan_minimo: plan,
      price_brl_month: price,
      modalidades: hint.modalities || [],
      comodidades: p.comodidades || [],
      totalpass_hit: p.totalpass_hit !== false,
    };
    chunks.push({
      chunk_id: `tp-partner-${slug(name)}`,
      chunk_type: 'tp_partner',
      text: `${name} TotalPass | plano_minimo=${plan} | R$${price ?? '?'} | ${(p.comodidades as string[] | undefined)?.slice(0, 6).join(', ') || ''}`,
      meta: { domain: 'totalpass', partner, source_ref: sourceRef },
    });
  }

  if (partners.length) {
    chunks.push({
      chunk_id: 'tp-summary',
      chunk_type: 'summary',
      text: `TotalPass: ${partners.length} partners indexados (plan_minimo + preço).`,
      meta: { domain: 'totalpass', source_ref: sourceRef },
    });
  }

  // Artifact geo_sample with totalpass_hit
  const geo = doc.geo_sample as { items?: Array<Record<string, unknown>> } | undefined;
  if (geo?.items?.length) {
    for (const it of geo.items) {
      if (!it.totalpass_hit && !it.plan_hint) continue;
      const hint = (it.plan_hint || {}) as Record<string, unknown>;
      const name = String(it.name || 'gym');
      chunks.push({
        chunk_id: `tp-geo-${slug(name)}`,
        chunk_type: 'tp_partner',
        text: `${name} | ${it.bairro || '?'} | ${hint.plan_minimo || '?'} | R$${hint.price_brl_month ?? '?'}`,
        meta: {
          domain: 'totalpass',
          partner: {
            name,
            bairro: it.bairro,
            plan_minimo: hint.plan_minimo,
            price_brl_month: hint.price_brl_month,
          },
          source_ref: sourceRef,
        },
      });
    }
  }

  return chunks;
}

/** Leis / normas / páginas estáticas (regulatório ou genérico). */
export function chunksFromPagesPayload(
  payload: unknown,
  sourceRef: string,
  domain: KnowledgeDomain,
): KnowledgeChunk[] {
  const doc = payload as Record<string, unknown>;
  const chunks: KnowledgeChunk[] = [];
  const pages = (doc.pages || doc.documents || doc.laws || doc.normas || []) as Array<
    Record<string, unknown>
  >;

  for (const p of pages) {
    const title = String(p.title || p.name || p.id || 'documento');
    const body = String(p.text || p.body || p.content || p.markdown || '');
    if (!body.trim()) continue;
    // Split long docs into ~1200 char slices
    const size = 1200;
    for (let i = 0, part = 0; i < body.length; i += size, part++) {
      const slice = body.slice(i, i + size);
      chunks.push({
        chunk_id: `${domain}-${slug(title)}-${part}`,
        chunk_type: domain === 'regulatory' ? 'law_chunk' : 'doc_chunk',
        text: `${title}\n${slice}`,
        meta: {
          domain,
          title,
          url: p.url || p.source || null,
          part,
          source_ref: sourceRef,
        },
      });
    }
  }

  if (typeof doc.text === 'string' && doc.text.trim()) {
    const title = String(doc.title || 'texto');
    chunks.push({
      chunk_id: `${domain}-${slug(title)}-0`,
      chunk_type: domain === 'regulatory' ? 'law_chunk' : 'doc_chunk',
      text: `${title}\n${doc.text}`,
      meta: { domain, title, source_ref: sourceRef },
    });
  }

  return chunks;
}

/** Fallback: stringify useful fields / rag_chunks. */
export function chunksFromGenericPayload(payload: unknown, sourceRef: string): KnowledgeChunk[] {
  const doc = payload as Record<string, unknown>;
  const chunks: KnowledgeChunk[] = [];

  if (Array.isArray(doc.rag_chunks)) {
    for (const r of doc.rag_chunks as Array<{ id?: string; type?: string; text?: string }>) {
      if (!r?.text) continue;
      chunks.push({
        chunk_id: r.id || `rag-${chunks.length}`,
        chunk_type: r.type || 'rag',
        text: r.text,
        meta: { domain: 'generic', source_ref: sourceRef },
      });
    }
  }

  if (!chunks.length) {
    const blob = JSON.stringify(doc).slice(0, 8000);
    chunks.push({
      chunk_id: 'generic-json-0',
      chunk_type: 'raw_json',
      text: blob,
      meta: { domain: 'generic', source_ref: sourceRef },
    });
  }

  return chunks;
}

export function buildChunksFromPayload(
  payload: unknown,
  sourceRef: string,
): { domain: KnowledgeDomain; chunks: KnowledgeChunk[] } {
  const domain = detectDomain(payload);
  let chunks: KnowledgeChunk[] = [];

  switch (domain) {
    case 'gurupass':
      chunks = chunksFromGpPayload(payload, sourceRef);
      break;
    case 'totalpass':
      chunks = chunksFromTpPayload(payload, sourceRef);
      break;
    case 'regulatory':
      chunks = chunksFromPagesPayload(payload, sourceRef, 'regulatory');
      if (!chunks.length) chunks = chunksFromGenericPayload(payload, sourceRef);
      break;
    case 'wellhub':
    case 'generic':
    default:
      chunks = [
        ...chunksFromPagesPayload(payload, sourceRef, domain === 'wellhub' ? 'wellhub' : 'generic'),
        ...chunksFromGenericPayload(payload, sourceRef),
      ];
      // dedupe by chunk_id
      {
        const seen = new Set<string>();
        chunks = chunks.filter((c) => {
          if (seen.has(c.chunk_id)) return false;
          seen.add(c.chunk_id);
          return true;
        });
      }
      break;
  }

  // Stamp domain on all metas
  chunks = chunks.map((c) => ({
    ...c,
    meta: { ...c.meta, domain: c.meta?.domain || domain },
  }));

  return { domain, chunks };
}

export function domainsInChunks(chunks: KnowledgeChunk[]): KnowledgeDomain[] {
  const set = new Set<KnowledgeDomain>();
  for (const c of chunks) {
    const d = (c.meta?.domain as KnowledgeDomain) || 'generic';
    set.add(d);
  }
  return [...set];
}
