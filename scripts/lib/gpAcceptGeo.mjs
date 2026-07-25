import { readFileSync, existsSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';

export function slug(s) {
  return String(s)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

/** "Ilimitado 70" → 70 */
export function parseCreditsFromPlan(planName) {
  if (planName == null || planName === '') return null;
  if (typeof planName === 'number' && Number.isFinite(planName)) return planName;
  const m = String(planName).match(/(\d+)/);
  return m ? Number(m[1]) : null;
}

/** Parse bairro from GP endereco strings. */
export function parseBairroFromEndereco(endereco) {
  if (!endereco) return null;
  const s = String(endereco).trim();
  const m = s.match(/,\s*([^,]+?)\s*(?:-|\,)\s*Fortaleza\b/i);
  if (m) return m[1].trim();
  return null;
}

export function normalizeAcademia(raw, defaultCidade = 'Fortaleza', defaultUf = 'CE') {
  const plano_minimo = raw.plano_minimo || raw.plan_minimo || null;
  const creditos_minimos =
    raw.creditos_minimos ??
    raw.creditos_por_dia ??
    parseCreditsFromPlan(plano_minimo);
  const address = raw.address || raw.endereco || null;
  const bairro =
    raw.bairro || parseBairroFromEndereco(address) || null;
  return {
    name: raw.name || raw.nome || null,
    address,
    bairro,
    cidade: raw.cidade || defaultCidade,
    uf: (raw.uf || defaultUf || '').toUpperCase() || defaultUf,
    modalidades: raw.modalidades || [],
    plano_minimo,
    creditos_minimos,
    valor_mensal_brl:
      raw.valor_mensal_brl != null ? Number(raw.valor_mensal_brl) : null,
    distancia_km: raw.distancia_km ?? null,
    partner_url: raw.partner_url || raw.url || null,
  };
}

/**
 * Accept either { items: [...] } or page export { academias: [...], cidade }.
 */
export function normalizeAcceptDoc(doc) {
  let cidade = 'Fortaleza';
  let uf = 'CE';
  if (doc.target_geo?.cidade) cidade = doc.target_geo.cidade;
  if (doc.target_geo?.uf) uf = doc.target_geo.uf;
  if (typeof doc.cidade === 'string') {
    const m = doc.cidade.match(/([^,]+),\s*([A-Z]{2})\b/i);
    if (m) {
      cidade = m[1].trim();
      uf = m[2].toUpperCase();
    }
  }

  let rawItems;
  if (Array.isArray(doc.items)) rawItems = doc.items;
  else if (Array.isArray(doc.academias)) rawItems = doc.academias;
  else {
    throw new Error('GP_ACCEPT_FIXTURE must have items[] or academias[]');
  }

  return {
    aggregator: doc.aggregator || 'gurupass',
    source: doc.source || null,
    target_geo: doc.target_geo || { cidade, uf },
    items: rawItems.map((r) => normalizeAcademia(r, cidade, uf)),
  };
}

/**
 * Geo filter. Empty target bairro = city-wide (all bairros).
 */
export function filterAcceptItems(items, targetGeo) {
  const tc = slug(targetGeo?.cidade || '');
  const tb = slug(targetGeo?.bairro || '');
  const tuf = (targetGeo?.uf || '').toUpperCase();
  const out = [];
  for (const raw of items || []) {
    const cidade = slug(raw.cidade || '');
    const uf = (raw.uf || '').toUpperCase();
    if (!tc || !cidade || cidade !== tc) continue;
    if (tuf && uf && uf !== tuf) continue;

    if (!tb) {
      out.push({ ...raw });
      continue;
    }

    const hasBairro = Boolean(raw.bairro);
    if (hasBairro) {
      const b = slug(raw.bairro);
      if (b !== tb && !b.includes(tb) && !tb.includes(b)) continue;
      out.push({ ...raw });
      continue;
    }
    out.push({ ...raw, bairro_unknown: true });
  }
  return out;
}

/**
 * Gate like TP: gym plano_minimo credits ≤ user plan credits.
 * If userCredits null → no plan filter (list all GP gyms in geo).
 */
export function filterByUserPlan(items, userCredits) {
  if (userCredits == null || Number.isNaN(Number(userCredits))) {
    return items.map((i) => ({ ...i, user_plan_ok: null }));
  }
  const uc = Number(userCredits);
  return items
    .filter((i) => {
      const c = i.creditos_minimos ?? parseCreditsFromPlan(i.plano_minimo);
      if (c == null) return false;
      return c <= uc;
    })
    .map((i) => ({
      ...i,
      user_plan_ok: true,
      user_credits: uc,
    }));
}

export function buildCatalogFromItems(items) {
  const byPlan = new Map();
  for (const it of items || []) {
    const key = it.plano_minimo || `creditos_${it.creditos_minimos}`;
    if (!key || byPlan.has(key)) continue;
    byPlan.set(key, {
      nome: it.plano_minimo,
      creditos_por_dia: it.creditos_minimos,
      valor_mensal_brl: it.valor_mensal_brl,
    });
  }
  const plans = [...byPlan.values()].sort(
    (a, b) => (a.creditos_por_dia ?? 0) - (b.creditos_por_dia ?? 0),
  );
  return {
    source: {
      method: 'derived_from_accept_list',
      note: 'Prices from buscar-academias page fields; national ladder optional later',
    },
    parse_mode: 'from_gym_plano_minimo',
    prices_seen: plans.map((p) => p.valor_mensal_brl).filter((n) => n != null),
    plans,
    plan: {
      code: 'GP',
      price_brl_month: plans[0]?.valor_mensal_brl ?? null,
      parse_warnings: [],
      status: plans.length ? 'from_accept_list' : 'empty',
    },
  };
}

export function loadAcceptFixture(pathLike, root) {
  const abs = isAbsolute(pathLike) ? pathLike : join(root, pathLike);
  if (!existsSync(abs)) {
    const err = new Error(`GP_ACCEPT_FIXTURE not found: ${abs}`);
    err.code = 'ENOENT';
    throw err;
  }
  const raw = JSON.parse(readFileSync(abs, 'utf8'));
  return normalizeAcceptDoc(raw);
}

/**
 * @returns {{ accept_list: object[], warnings: string[], source: object|null, catalog: object }}
 */
export function resolveAcceptList({
  fixturePath,
  root,
  targetGeo,
  requireFixture,
  userCredits = null,
}) {
  const warnings = [];
  if (!fixturePath) {
    if (requireFixture) {
      throw new Error('REQUIRE_ACCEPT_FIXTURE=1 but GP_ACCEPT_FIXTURE is empty');
    }
    warnings.push('GP_ACCEPT_FIXTURE unset — accept_list empty');
    return {
      accept_list: [],
      warnings,
      source: null,
      catalog: buildCatalogFromItems([]),
    };
  }
  let doc;
  try {
    doc = loadAcceptFixture(fixturePath, root);
  } catch (e) {
    if (requireFixture) throw e;
    warnings.push(String(e.message || e));
    return {
      accept_list: [],
      warnings,
      source: null,
      catalog: buildCatalogFromItems([]),
    };
  }
  if (doc.aggregator && doc.aggregator !== 'gurupass') {
    warnings.push(`fixture aggregator=${doc.aggregator} ≠ gurupass`);
  }
  let accept_list = filterAcceptItems(doc.items, targetGeo);
  const geo_count = accept_list.length;
  accept_list = filterByUserPlan(accept_list, userCredits);
  if (userCredits != null) {
    warnings.push(
      `filtered by user_credits=${userCredits}: ${accept_list.length}/${geo_count} in geo`,
    );
  }
  return {
    accept_list,
    warnings,
    source: {
      ...(doc.source || {}),
      fixture: fixturePath,
      item_count_raw: doc.items.length,
      geo_count,
      user_credits: userCredits,
    },
    catalog: buildCatalogFromItems(doc.items),
  };
}
