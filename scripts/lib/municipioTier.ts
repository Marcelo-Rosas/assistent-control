/**
 * Tiers de município por população (comercial / WH-P2 T3–T4).
 * T4 = maiores; T3+ = T3 ∪ T4.
 */
export type MunicipioTier = 'T1' | 'T2' | 'T3' | 'T4';

const TIER_ORDER: Record<MunicipioTier, number> = {
  T1: 1,
  T2: 2,
  T3: 3,
  T4: 4,
};

/** Limiares: T4 ≥500k · T3 ≥100k · T2 ≥50k · T1 <50k */
export function classifyMunicipioTier(
  populacao: number | null | undefined,
): MunicipioTier | null {
  if (populacao == null || !Number.isFinite(populacao) || populacao < 0) return null;
  if (populacao >= 500_000) return 'T4';
  if (populacao >= 100_000) return 'T3';
  if (populacao >= 50_000) return 'T2';
  return 'T1';
}

export function isTierAtLeast(
  tier: MunicipioTier | null | undefined,
  min: MunicipioTier,
): boolean {
  if (!tier) return false;
  return TIER_ORDER[tier] >= TIER_ORDER[min];
}

export const MUNICIPIO_TIER_DEFINITION =
  'T4≥500k · T3≥100k · T2≥50k · T1<50k (pop IBGE em municipios-brasil.json)';
