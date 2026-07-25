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
    const hasBairro = Boolean(raw.bairro);
    if (hasBairro && tb) {
      const b = slug(raw.bairro);
      if (b !== tb && !b.includes(tb) && !tb.includes(b)) continue;
      out.push({ ...raw });
      continue;
    }
    out.push({ ...raw, bairro_unknown: true });
  }
  return out;
}

export function loadAcceptFixture(pathLike, root) {
  const abs = isAbsolute(pathLike) ? pathLike : join(root, pathLike);
  if (!existsSync(abs)) {
    const err = new Error(`GP_ACCEPT_FIXTURE not found: ${abs}`);
    err.code = 'ENOENT';
    throw err;
  }
  const doc = JSON.parse(readFileSync(abs, 'utf8'));
  if (!Array.isArray(doc.items)) {
    throw new Error('GP_ACCEPT_FIXTURE.items must be an array');
  }
  return doc;
}

/**
 * @returns {{ accept_list: object[], warnings: string[], source: object|null }}
 */
export function resolveAcceptList({
  fixturePath,
  root,
  targetGeo,
  requireFixture,
}) {
  const warnings = [];
  if (!fixturePath) {
    if (requireFixture) {
      throw new Error('REQUIRE_ACCEPT_FIXTURE=1 but GP_ACCEPT_FIXTURE is empty');
    }
    warnings.push('GP_ACCEPT_FIXTURE unset — accept_list empty');
    return { accept_list: [], warnings, source: null };
  }
  let doc;
  try {
    doc = loadAcceptFixture(fixturePath, root);
  } catch (e) {
    if (requireFixture) throw e;
    warnings.push(String(e.message || e));
    return { accept_list: [], warnings, source: null };
  }
  if (doc.aggregator && doc.aggregator !== 'gurupass') {
    warnings.push(`fixture aggregator=${doc.aggregator} ≠ gurupass`);
  }
  const accept_list = filterAcceptItems(doc.items, targetGeo);
  return {
    accept_list,
    warnings,
    source: {
      ...(doc.source || {}),
      fixture: fixturePath,
      item_count_raw: doc.items.length,
    },
  };
}

export function catalogOutOfScope() {
  return {
    source: {
      url: 'https://www.gurupass.com.br/nossos-planos/',
      method: 'out_of_scope',
      http_status: null,
    },
    parse_mode: 'out_of_scope',
    prices_seen: [],
    plan: {
      code: 'GP',
      price_brl_month: null,
      parse_warnings: ['plan_catalog_out_of_scope_this_cycle'],
      status: 'out_of_scope',
    },
  };
}
