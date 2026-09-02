/**
 * Receita CNAE wellness — segment match, dedup, tags.
 */
import fs from 'fs';
import path from 'path';

export type WellnessSegment = {
  id: string;
  cnae: string;
  label: string;
};

export type WellnessTagRule =
  | { id: string; match: 'nome_fantasia'; pattern: string }
  | { id: string; match: 'cnae'; cnae: string };

export type WellnessConfig = {
  version: number;
  segments: WellnessSegment[];
  segment_groups?: Record<string, string[]>;
  tags?: WellnessTagRule[];
};

export type WellnessEstabRow = {
  cnpj: string;
  nome_fantasia?: string | null;
  cnae_fiscal_principal?: string | null;
  cnae_fiscal_secundaria?: string | null;
  situacao_cadastral?: string | null;
  [key: string]: unknown;
};

export type WellnessEnrichedRow = WellnessEstabRow & {
  cnae_match: 'principal' | 'secundario';
  cnae_segment: string;
  cnae_fiscal_matched: string;
  cnae_tags: string[];
};

const ROOT = process.cwd();

export function loadWellnessConfig(configPath?: string): WellnessConfig {
  const p =
    configPath ?? path.join(ROOT, 'data/config/receita-cnae-segments.json');
  return JSON.parse(fs.readFileSync(p, 'utf8')) as WellnessConfig;
}

export function cnaeInSecondary(cnae: string, secundaria: string | null | undefined): boolean {
  if (!secundaria?.trim()) return false;
  const parts = secundaria.split(',').map((s) => s.trim());
  return parts.includes(cnae);
}

export function rowHasCnae(
  row: WellnessEstabRow,
  cnae: string,
): { hit: boolean; match: 'principal' | 'secundario' | null } {
  if (row.cnae_fiscal_principal === cnae) {
    return { hit: true, match: 'principal' };
  }
  if (cnaeInSecondary(cnae, row.cnae_fiscal_secundaria)) {
    return { hit: true, match: 'secundario' };
  }
  return { hit: false, match: null };
}

type SegmentHit = {
  order: number;
  segment: WellnessSegment;
  match: 'principal' | 'secundario';
};

export function findSegmentHits(row: WellnessEstabRow, segments: WellnessSegment[]): SegmentHit[] {
  const hits: SegmentHit[] = [];
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    const { hit, match } = rowHasCnae(row, seg.cnae);
    if (hit && match) hits.push({ order: i, segment: seg, match });
  }
  return hits;
}

export function pickWinningHit(hits: SegmentHit[]): SegmentHit | null {
  if (!hits.length) return null;
  const principals = hits.filter((h) => h.match === 'principal');
  const pool = principals.length ? principals : hits;
  return pool.reduce((best, cur) => (cur.order < best.order ? cur : best));
}

export function applyTagRules(row: WellnessEstabRow, rules: WellnessTagRule[] = []): string[] {
  const tags = new Set<string>();
  const nome = String(row.nome_fantasia ?? '');

  for (const rule of rules) {
    if (rule.match === 'nome_fantasia') {
      const pat = rule.pattern.replace(/^\(\?i\)/, '');
      if (new RegExp(pat, 'i').test(nome)) tags.add(rule.id);
      continue;
    }
    const { hit } = rowHasCnae(row, rule.cnae);
    if (hit) tags.add(rule.id);
  }

  return [...tags].sort();
}

export function enrichWellnessRow(
  row: WellnessEstabRow,
  config: WellnessConfig,
): WellnessEnrichedRow | null {
  const hits = findSegmentHits(row, config.segments);
  const winner = pickWinningHit(hits);
  if (!winner) return null;

  return {
    ...row,
    cnae_match: winner.match,
    cnae_segment: winner.segment.id,
    cnae_fiscal_matched: winner.segment.cnae,
    cnae_tags: applyTagRules(row, config.tags ?? []),
  };
}

/** Dedup by CNPJ — one row per estabelecimento. */
export function dedupeWellnessRows(
  rows: WellnessEstabRow[],
  config: WellnessConfig,
): WellnessEnrichedRow[] {
  const byCnpj = new Map<string, WellnessEnrichedRow>();

  for (const row of rows) {
    if (!row.cnpj) continue;
    const enriched = enrichWellnessRow(row, config);
    if (!enriched) continue;

    const prev = byCnpj.get(row.cnpj);
    if (!prev) {
      byCnpj.set(row.cnpj, enriched);
      continue;
    }

    const prevHits = findSegmentHits(prev, config.segments);
    const nextHits = findSegmentHits(row, config.segments);
    const prevWinner = pickWinningHit(prevHits);
    const nextWinner = pickWinningHit(nextHits);
    if (!prevWinner || !nextWinner) continue;

    const prevScore = prevWinner.match === 'principal' ? 0 : 1;
    const nextScore = nextWinner.match === 'principal' ? 0 : 1;
    if (
      nextScore < prevScore ||
      (nextScore === prevScore && nextWinner.order < prevWinner.order)
    ) {
      byCnpj.set(row.cnpj, enriched);
    }
  }

  return [...byCnpj.values()];
}

export function countBySegment(rows: WellnessEnrichedRow[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const row of rows) {
    counts[row.cnae_segment] = (counts[row.cnae_segment] ?? 0) + 1;
  }
  return counts;
}

export function segmentGroupFor(segmentId: string, config: WellnessConfig): string | null {
  for (const [group, ids] of Object.entries(config.segment_groups ?? {})) {
    if (ids.includes(segmentId)) return group;
  }
  return null;
}
