import {
  FED_ORDINARY_MFJ,
  FED_LTCG_MFJ,
  FED_STD_DEDUCTION_MFJ,
  DEFAULT_STATE_EXEMPT,
  DEFAULT_STATE_RATE,
  type Bracket,
} from "../data/taxTables";

/** Tax on `taxable` income across progressive brackets. */
export function taxFromBrackets(taxable: number, brackets: Bracket[]): number {
  let tax = 0;
  let lower = 0;
  for (const b of brackets) {
    if (taxable <= lower) break;
    const inBracket = Math.min(taxable, b.upTo) - lower;
    tax += inBracket * b.rate;
    lower = b.upTo;
  }
  return tax;
}

/** LTCG tax with gains stacked on top of ordinary taxable income. */
export function ltcgTaxStacked(ordinaryTaxable: number, gains: number): number {
  if (gains <= 0) return 0;
  return (
    taxFromBrackets(ordinaryTaxable + gains, FED_LTCG_MFJ) -
    taxFromBrackets(ordinaryTaxable, FED_LTCG_MFJ)
  );
}

export interface TaxYearInput {
  /** Trad withdrawals + Roth conversions + pension + taxable HSA (real $). */
  ordinaryIncome: number;
  /** Net realized long-term capital gains (real $, floor 0 applied inside). */
  ltcg: number;
  /** Gross Social Security benefits (85% federally taxable approximation). */
  ssGross: number;
  /** Flat state rate above the exemption (default: Ohio). */
  stateRate?: number;
  stateExemption?: number;
}

export interface TaxYearResult {
  federal: number;
  state: number;
  total: number;
  /** MAGI for ACA purposes: AGI + full SS. */
  magi: number;
  /** Federal taxable ordinary income after deduction (for conversion sizing). */
  fedTaxableOrdinary: number;
}

/**
 * Whole-year household tax, MFJ. Simplifications: 85% of SS federally
 * taxable (conservative), no NIIT, no local/city tax, all gains long-term.
 */
export function computeAnnualTax(inp: TaxYearInput): TaxYearResult {
  const gains = Math.max(0, inp.ltcg);
  const taxableSS = 0.85 * inp.ssGross;
  const ordinaryAGI = inp.ordinaryIncome + taxableSS;

  // Standard deduction absorbs ordinary income first, then gains.
  const fedTaxableOrdinary = Math.max(0, ordinaryAGI - FED_STD_DEDUCTION_MFJ);
  const deductionLeft = Math.max(0, FED_STD_DEDUCTION_MFJ - ordinaryAGI);
  const taxableGains = Math.max(0, gains - deductionLeft);

  const federal =
    taxFromBrackets(fedTaxableOrdinary, FED_ORDINARY_MFJ) +
    ltcgTaxStacked(fedTaxableOrdinary, taxableGains);

  // State: flat rate above exemption; taxes gains as ordinary, exempts SS.
  const stateBase = inp.ordinaryIncome + gains;
  const state =
    (inp.stateRate ?? DEFAULT_STATE_RATE) *
    Math.max(0, stateBase - (inp.stateExemption ?? DEFAULT_STATE_EXEMPT));

  return {
    federal,
    state,
    total: federal + state,
    magi: inp.ordinaryIncome + gains + inp.ssGross,
    fedTaxableOrdinary,
  };
}
