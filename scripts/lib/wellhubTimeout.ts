/**
 * Fórmula determinística de timeout Wellhub + vereditos de auditoria.
 * Uma única fonte de verdade — sem estimativas vagas.
 */

export const WELLHUB_TIMEOUT_DEFAULTS = {
  CITY_TIMEOUT_FLOOR_MS: 180_000,
  GRID_DELAY_MS: 500,
  SETTLE_MS: 2_000,
  PER_BAIRRO_EXTRA_MS: 4_000,
  CITY_PASS_MS: 10_000, // SETTLE_MS + 8_000
  GEO_POINTS: 8,
  BUFFER_MS: 120_000,
  HEURISTIC_BAIRRO_CAP: 50,
  AUDIT_OK_MISSING_PCT: 5,
  AUDIT_WARN_MISSING_PCT: 10,
} as const;

export type CityTimeoutInput = {
  /** Bairros no catálogo oficial. `null` → usa HEURISTIC_BAIRRO_CAP (50). */
  catalog_bairros: number | null;
  floor_ms?: number;
  grid_delay_ms?: number;
  settle_ms?: number;
  per_bairro_extra_ms?: number;
  geo_points?: number;
  buffer_ms?: number;
  heuristic_bairro_cap?: number;
};

export type CityTimeoutBreakdown = {
  floor_ms: number;
  city_pass_ms: number;
  bairro_count: number;
  per_bairro_ms: number;
  bairros_ms: number;
  geo_points: number;
  geo_point_ms: number;
  geo_ms: number;
  buffer_ms: number;
  subtotal_ms: number;
  timeout_ms: number;
  rule: string;
};

export type AuditVerdictCode =
  | 'OK_EXACT'
  | 'OK_MISSING_LTE_5PCT'
  | 'WARN_MISSING_6_TO_10PCT'
  | 'WARN_DIVERGE'
  | 'LOSS_TIMEOUT'
  | 'LOSS_EMPTY'
  | 'OK_NO_BASELINE'
  | 'INCOMPLETE';

export type AuditVerdict = {
  code: AuditVerdictCode;
  label: string;
  baseline_count: number;
  normal_count: number;
  missing_count: number;
  missing_pct: number;
  within_ok: boolean;
  within_warn: boolean;
};

export type ScrapeOutcome = 'PENDING' | 'COMPLETE' | 'TIMEOUT_WITH_DATA' | 'TIMEOUT_EMPTY';

export function perBairroMs(
  grid_delay_ms = WELLHUB_TIMEOUT_DEFAULTS.GRID_DELAY_MS,
  settle_ms = WELLHUB_TIMEOUT_DEFAULTS.SETTLE_MS,
  per_bairro_extra_ms = WELLHUB_TIMEOUT_DEFAULTS.PER_BAIRRO_EXTRA_MS,
): number {
  return grid_delay_ms + settle_ms + per_bairro_extra_ms;
}

export function geoPointMs(
  grid_delay_ms = WELLHUB_TIMEOUT_DEFAULTS.GRID_DELAY_MS,
  settle_ms = WELLHUB_TIMEOUT_DEFAULTS.SETTLE_MS,
  per_bairro_extra_ms = WELLHUB_TIMEOUT_DEFAULTS.PER_BAIRRO_EXTRA_MS,
): number {
  return perBairroMs(grid_delay_ms, settle_ms, per_bairro_extra_ms);
}

/** timeout_ms = max(floor, city_pass + bairros×per_bairro + geo×geo_point + buffer) */
export function computeCityTimeout(input: CityTimeoutInput = { catalog_bairros: null }): CityTimeoutBreakdown {
  const d = WELLHUB_TIMEOUT_DEFAULTS;
  const floor_ms = input.floor_ms ?? d.CITY_TIMEOUT_FLOOR_MS;
  const grid_delay_ms = input.grid_delay_ms ?? d.GRID_DELAY_MS;
  const settle_ms = input.settle_ms ?? d.SETTLE_MS;
  const per_bairro_extra_ms = input.per_bairro_extra_ms ?? d.PER_BAIRRO_EXTRA_MS;
  const geo_points = input.geo_points ?? d.GEO_POINTS;
  const buffer_ms = input.buffer_ms ?? d.BUFFER_MS;
  const heuristic_cap = input.heuristic_bairro_cap ?? d.HEURISTIC_BAIRRO_CAP;

  const bairro_count =
    input.catalog_bairros != null && input.catalog_bairros > 0
      ? input.catalog_bairros
      : heuristic_cap;

  const per_bairro_ms = perBairroMs(grid_delay_ms, settle_ms, per_bairro_extra_ms);
  const geo_point_ms = geoPointMs(grid_delay_ms, settle_ms, per_bairro_extra_ms);
  const city_pass_ms = d.CITY_PASS_MS;
  const bairros_ms = bairro_count * per_bairro_ms;
  const geo_ms = geo_points * geo_point_ms;
  const subtotal_ms = city_pass_ms + bairros_ms + geo_ms + buffer_ms;
  const timeout_ms = Math.max(floor_ms, subtotal_ms);

  const rule =
    input.catalog_bairros != null && input.catalog_bairros > 0
      ? `max(${floor_ms}, ${city_pass_ms} + ${bairro_count}×${per_bairro_ms} + ${geo_points}×${geo_point_ms} + ${buffer_ms})`
      : `max(${floor_ms}, ${city_pass_ms} + ${heuristic_cap}×${per_bairro_ms} + ${geo_points}×${geo_point_ms} + ${buffer_ms}) [heuristic_cap]`;

  return {
    floor_ms,
    city_pass_ms,
    bairro_count,
    per_bairro_ms,
    bairros_ms,
    geo_points,
    geo_point_ms,
    geo_ms,
    buffer_ms,
    subtotal_ms,
    timeout_ms,
    rule,
  };
}

export function missingPct(baseline: number, missing: number): number {
  if (baseline <= 0) return 0;
  return Math.round((missing / baseline) * 1000) / 10;
}

/** Veredito audit — limiares fixos: OK ≤5%, WARN 6–10%, LOSS >10% ou timeout. */
export function auditVerdict(input: {
  baseline_count: number;
  normal_count: number;
  normal_missing: number;
  normal_error?: string;
  normal_ok: boolean;
}): AuditVerdict {
  const { baseline_count, normal_count, normal_missing, normal_error, normal_ok } = input;
  const okPct = WELLHUB_TIMEOUT_DEFAULTS.AUDIT_OK_MISSING_PCT;
  const warnPct = WELLHUB_TIMEOUT_DEFAULTS.AUDIT_WARN_MISSING_PCT;
  const missing_pct = missingPct(baseline_count, normal_missing);

  if (baseline_count === 0) {
    return {
      code: 'OK_NO_BASELINE',
      label: 'OK_NO_BASELINE: baseline=0',
      baseline_count,
      normal_count,
      missing_count: normal_missing,
      missing_pct,
      within_ok: true,
      within_warn: true,
    };
  }

  if (!normal_ok && normal_error && /timeout/i.test(normal_error)) {
    const code: AuditVerdictCode = normal_count === 0 ? 'LOSS_TIMEOUT' : 'LOSS_TIMEOUT';
    return {
      code,
      label: `${code}: normal_count=${normal_count} missing_pct=${missing_pct}`,
      baseline_count,
      normal_count,
      missing_count: normal_missing,
      missing_pct,
      within_ok: false,
      within_warn: false,
    };
  }

  if (normal_count === 0 && normal_missing === baseline_count) {
    return {
      code: 'LOSS_EMPTY',
      label: 'LOSS_EMPTY: normal_count=0',
      baseline_count,
      normal_count,
      missing_count: normal_missing,
      missing_pct: 100,
      within_ok: false,
      within_warn: false,
    };
  }

  if (normal_missing === 0 && normal_ok) {
    return {
      code: 'OK_EXACT',
      label: 'OK_EXACT: missing=0',
      baseline_count,
      normal_count,
      missing_count: 0,
      missing_pct: 0,
      within_ok: true,
      within_warn: true,
    };
  }

  if (missing_pct <= okPct) {
    return {
      code: 'OK_MISSING_LTE_5PCT',
      label: `OK_MISSING_LTE_5PCT: missing_pct=${missing_pct} threshold=${okPct}`,
      baseline_count,
      normal_count,
      missing_count: normal_missing,
      missing_pct,
      within_ok: true,
      within_warn: true,
    };
  }

  if (missing_pct <= warnPct) {
    return {
      code: 'WARN_MISSING_6_TO_10PCT',
      label: `WARN_MISSING_6_TO_10PCT: missing_pct=${missing_pct} threshold=${warnPct}`,
      baseline_count,
      normal_count,
      missing_count: normal_missing,
      missing_pct,
      within_ok: false,
      within_warn: true,
    };
  }

  return {
    code: 'WARN_DIVERGE',
    label: `WARN_DIVERGE: missing_pct=${missing_pct} threshold=${warnPct}`,
    baseline_count,
    normal_count,
    missing_count: normal_missing,
    missing_pct,
    within_ok: false,
    within_warn: false,
  };
}

export function scrapeCompletionStatus(input: {
  outcome: ScrapeOutcome;
  bairros_planned: number;
  bairros_done: number;
  gym_count: number;
  elapsed_ms: number;
  timeout_ms: number;
}): {
  status: ScrapeOutcome;
  bairros_completion_pct: number;
  timed_out: boolean;
} {
  const bairros_completion_pct =
    input.bairros_planned > 0
      ? Math.round((input.bairros_done / input.bairros_planned) * 1000) / 10
      : 100;
  const timed_out = input.outcome === 'TIMEOUT_WITH_DATA' || input.outcome === 'TIMEOUT_EMPTY';
  return {
    status: input.outcome,
    bairros_completion_pct,
    timed_out,
  };
}
