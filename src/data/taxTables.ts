/**
 * Tax tables — 2025 married-filing-jointly figures used as a proxy for the
 * whole projection (engine works in real dollars, so bracket edges are
 * treated as inflation-indexed, which they roughly are).
 *
 * APPROXIMATE BY DESIGN: tax law drifts over 50 years (spec §12). Edit here.
 */

export interface Bracket {
  /** Upper edge of the bracket in taxable income; Infinity for the top. */
  upTo: number;
  rate: number;
}

export const FED_STD_DEDUCTION_MFJ = 31_500;

export const FED_ORDINARY_MFJ: Bracket[] = [
  { upTo: 23_850, rate: 0.1 },
  { upTo: 96_950, rate: 0.12 },
  { upTo: 206_700, rate: 0.22 },
  { upTo: 394_600, rate: 0.24 },
  { upTo: 501_050, rate: 0.32 },
  { upTo: 751_600, rate: 0.35 },
  { upTo: Infinity, rate: 0.37 },
];

/** LTCG brackets, thresholds on TAXABLE income (gains stack on ordinary). */
export const FED_LTCG_MFJ: Bracket[] = [
  { upTo: 96_700, rate: 0 },
  { upTo: 600_050, rate: 0.15 },
  { upTo: Infinity, rate: 0.2 },
];

/**
 * Default state tax: a flat rate on income above an exemption, gains taxed as
 * ordinary income, Social Security exempt. The defaults are Ohio 2026 (2.75%
 * above ~$26,050); set stateTaxRate / stateTaxExemption in the inputs for
 * another flat-tax state, or 0 for a no-income-tax state. Progressive state
 * brackets are not modeled.
 */
export const DEFAULT_STATE_EXEMPT = 26_050;
export const DEFAULT_STATE_RATE = 0.0275;

/** Federal poverty level, 2025 (48 states) — for ACA subsidy math. */
export const FPL_FIRST_PERSON = 15_650;
export const FPL_PER_ADDITIONAL = 5_500;
export function fplForHousehold(size: number): number {
  return FPL_FIRST_PERSON + FPL_PER_ADDITIONAL * Math.max(0, Math.round(size) - 1);
}
export const FPL_FAMILY_OF_4 = fplForHousehold(4);

/**
 * ACA expected-contribution schedule (post-2025, enhanced subsidies expired):
 * % of MAGI you're expected to pay for the benchmark plan, by MAGI as % of FPL.
 * Hard cliff above 400% FPL. Below ~138% FPL Medicaid applies (expansion states) (premium ≈ 0).
 */
export const ACA_CONTRIBUTION_SCHEDULE: { fplPct: number; incomePct: number }[] = [
  { fplPct: 1.38, incomePct: 0.034 },
  { fplPct: 1.5, incomePct: 0.041 },
  { fplPct: 2.0, incomePct: 0.065 },
  { fplPct: 2.5, incomePct: 0.083 },
  { fplPct: 3.0, incomePct: 0.096 },
  { fplPct: 4.0, incomePct: 0.096 },
];
export const ACA_MEDICAID_FPL = 1.38;
export const ACA_CLIFF_FPL = 4.0;

/**
 * IRS Single Life Expectancy table (Pub 590-B, 2022+), ages 30-70 — used for
 * 72(t) SEPP fixed-amortization payments. Values are remaining life expectancy
 * in years at the attained age in the distribution year.
 */
export const IRS_SINGLE_LIFE: Record<number, number> = {
  30: 55.3, 31: 54.4, 32: 53.4, 33: 52.5, 34: 51.5, 35: 50.5, 36: 49.6,
  37: 48.6, 38: 47.7, 39: 46.7, 40: 45.7, 41: 44.8, 42: 43.8, 43: 42.9,
  44: 41.9, 45: 41.0, 46: 40.0, 47: 39.0, 48: 38.1, 49: 37.1, 50: 36.2,
  51: 35.3, 52: 34.3, 53: 33.4, 54: 32.5, 55: 31.6, 56: 30.6, 57: 29.8,
  58: 28.9, 59: 28.0, 60: 27.1, 61: 26.2, 62: 25.4, 63: 24.5, 64: 23.7,
  65: 22.9, 66: 22.0, 67: 21.2, 68: 20.4, 69: 19.6, 70: 18.8,
};

export function singleLifeExpectancy(age: number): number {
  const clamped = Math.max(30, Math.min(70, Math.round(age)));
  return IRS_SINGLE_LIFE[clamped];
}
