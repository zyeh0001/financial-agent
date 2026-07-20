/** Display-oriented percentage change kept in finance-core so UI adapters never duplicate arithmetic. */
export function calculatePercentChange(reference: number | null, current: number | null): number | null {
  if (reference === null || current === null || !Number.isFinite(reference) || !Number.isFinite(current) || reference <= 0) {
    return null;
  }
  return ((current - reference) / reference) * 100;
}
