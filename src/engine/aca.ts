import {
  ACA_CLIFF_FPL,
  ACA_CONTRIBUTION_SCHEDULE,
  ACA_MEDICAID_FPL,
  FPL_FAMILY_OF_4,
} from "../data/taxTables";

/**
 * Net ACA family premium as a function of MAGI (post-2025 rules: expected
 * contribution % of income for the benchmark plan, hard cliff at 400% FPL,
 * Medicaid below ~138% FPL in expansion states).
 *
 * `grossPremium` doubles as the benchmark-plan cost — a deliberate
 * simplification; edit acaGrossPremium to calibrate against healthcare.gov.
 * `fpl` is the poverty line for the household's size (default: family of 4).
 */
export function acaNetPremium(magi: number, grossPremium: number, fpl = FPL_FAMILY_OF_4): number {
  const fplRatio = magi / fpl;
  if (fplRatio <= ACA_MEDICAID_FPL) return 0; // Medicaid
  if (fplRatio >= ACA_CLIFF_FPL) return grossPremium; // subsidy cliff

  // Interpolate the expected-contribution percentage.
  const s = ACA_CONTRIBUTION_SCHEDULE;
  let pct = s[s.length - 1].incomePct;
  for (let i = 0; i < s.length - 1; i++) {
    if (fplRatio <= s[i + 1].fplPct) {
      const w = (fplRatio - s[i].fplPct) / (s[i + 1].fplPct - s[i].fplPct);
      pct = s[i].incomePct + w * (s[i + 1].incomePct - s[i].incomePct);
      break;
    }
  }
  return Math.min(grossPremium, pct * magi);
}
