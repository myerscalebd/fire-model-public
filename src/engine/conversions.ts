import type { SpouseAccounts } from "./types";

export const CONVERSION_SEASONING_YEARS = 5;

/** Move matured pipeline entries into withdrawable Roth basis. */
export function maturePipeline(sp: SpouseAccounts, t: number): void {
  const still: typeof sp.rothPipeline = [];
  for (const e of sp.rothPipeline) {
    if (e.maturesAt <= t) sp.rothBasis += e.amount;
    else still.push(e);
  }
  sp.rothPipeline = still;
}

export function pipelineTotal(sp: SpouseAccounts): number {
  return sp.rothPipeline.reduce((a, e) => a + e.amount, 0);
}

/**
 * Execute a Roth conversion of up to `amount`, drawing from the spouse with
 * the LATER traditional unlock first (their money stays trapped longest).
 * Returns the amount actually converted (limited by trad balances).
 */
export function convert(
  spouses: { sp: SpouseAccounts; unlockT: number }[],
  amount: number,
  t: number,
): number {
  const order = [...spouses].sort((a, b) => b.unlockT - a.unlockT);
  let remaining = amount;
  for (const { sp } of order) {
    if (remaining <= 0) break;
    const take = Math.min(sp.trad, remaining);
    sp.trad -= take;
    sp.rothPipeline.push({ maturesAt: t + CONVERSION_SEASONING_YEARS, amount: take });
    remaining -= take;
  }
  return amount - remaining;
}
