/**
 * Core types for the FIRE bridge model engine.
 * All engine dollar amounts are REAL (start-year dollars) unless a field
 * says nominal. Years are indexed t = 0..horizonYears-1, calendar year =
 * startYear + t.
 */

/** A pending Roth conversion waiting out its 5-year clock. */
export interface PipelineEntry {
  /** Year index at which this conversion becomes withdrawable basis. */
  maturesAt: number;
  amount: number;
}

/** Per-spouse retirement accounts. Roth basis vs earnings tracked separately. */
export interface SpouseAccounts {
  /** Roth contributions + matured conversions — withdrawable anytime, tax/penalty free. */
  rothBasis: number;
  /** Roth growth — locked until owner is 59½. */
  rothEarnings: number;
  /** Conversions younger than 5 years — locked until maturity (or owner 59½). */
  rothPipeline: PipelineEntry[];
  /** Traditional 401k/IRA — locked until owner 59½ (or Rule of 55). */
  trad: number;
}

export interface HouseholdState {
  taxable: { value: number; basis: number };
  cash: number;
  spouseA: SpouseAccounts;
  spouseB: SpouseAccounts;
  hsa: number;
  /** Accumulated unreimbursed medical receipts — makes HSA quasi-accessible pre-65. */
  hsaReceipts: number;
  everSqueezed: boolean;
  ruined: boolean;
}

export type ConversionMode = "off" | "fixed" | "fillBracket";
export type ReturnModel = "gaussian" | "bootstrap" | "cohorts";

/** One year of asset-class real returns; the sim blends them by that year's equity weight. */
export interface YearReturns {
  stock: number;
  bond: number;
  /** CPI inflation for the year — deflates fixed-nominal items (mortgage P&I, non-COLA pension). */
  inflation: number;
}

/**
 * Starting account balances (real $ at startYear). Part of the saved profile so
 * the whole financial picture is one serializable object — nothing personal is
 * hardcoded in the source. The `spouseA`/`spouseB` keys are internal identifiers for
 * the two people (spouse A / spouse B); their display names are `nameA`/`nameB`.
 */
export interface Balances {
  taxable: number;
  cash: number;
  rothBasisA: number;
  tradA: number;
  rothBasisB: number;
  tradB: number;
  hsa: number;
}

export interface SimInputs {
  /** Display names for the two people (engine keys stay spouseA/spouseB internally). */
  nameA: string;
  nameB: string;
  /** Starting balances — see Balances. */
  balances: Balances;

  startYear: number;
  horizonYears: number;
  startAgeA: number;
  startAgeB: number;

  /** Calendar year in which each spouse stops working (retired for that whole year). */
  retireYearA: number;
  retireYearB: number;

  /** Take-home pay per year while working (after taxes AND after payroll retirement contributions). */
  netIncomeA: number;
  netIncomeB: number;
  /** Annual retirement-account contributions while that spouse works (funded from gross, so not deducted from net income). */
  contribTradA: number;
  contribRothA: number;
  contribTradB: number;
  contribRothB: number;
  /** Blunt lever: extra after-tax income in EVERY fully-retired year (unconditional backstop). */
  reentryIncome: number;

  /**
   * Reactive backstop: someone returns to work only WHEN accessible funds run
   * low, and stops once they recover — the realistic response to a squeeze,
   * separate from the always-on `reentryIncome`.
   */
  reactiveReentryEnabled: boolean;
  /** After-tax income earned per year while re-engaged. */
  reactiveReentryIncome: number;
  /** Trigger when accessible funds fall below this many years of spending. */
  reactiveReentryTriggerYears: number;
  /** Once back, work at least this many years (a real job commitment; avoids flip-flopping). */
  reactiveReentryMinYears: number;
  /** Nobody re-enters once the younger spouse is past this age. */
  reactiveReentryMaxAge: number;

  // --- Access ages (the walls the whole tool is about; adjustable) ---
  /** Age traditional + Roth earnings unlock. Integer-year proxy for 59½ (default 60). */
  unlockAge: number;
  /** Age HSA becomes usable for any expense without receipts (default 65). */
  hsaUnlockAge: number;
  /** Age Medicare replaces ACA per spouse (default 65). */
  medicareAge: number;
  /** Rule-of-55 qualifying age: work through the year you turn this (default 55). */
  ruleOf55Age: number;

  // --- 72(t) / SEPP: substantially equal periodic payments ---
  /**
   * Fixed-amortization SEPP from a spouse's traditional bucket: penalty-free
   * distributions at ANY age, but rigid — once started the payment is fixed in
   * NOMINAL dollars and must continue until the LATER of 5 years or 59½, or
   * all distributions are retroactively penalized (the model doesn't allow
   * busting; it just runs the required duration). While a SEPP runs, that
   * spouse's traditional account is excluded from the Roth conversion ladder
   * (a conversion would be a busting modification).
   */
  sepp72tA: boolean;
  sepp72tStartYearA: number;
  sepp72tB: boolean;
  sepp72tStartYearB: number;
  /** Amortization interest rate — IRS cap is max(5%, 120% of mid-term rate). */
  sepp72tRate: number;

  /** Annual spend EXCLUDING housing, childcare and healthcare (those are modeled separately). */
  coreSpend: number;
  childcareAnnual: number;
  /** Last calendar year childcare is paid. */
  childcareLastYear: number;

  /** Floor-spending rule: cut coreSpend by this much in the year after a bad return. */
  floorEnabled: boolean;
  floorCutAmount: number;
  /** Return at or below this triggers the cut (e.g. -0.20). */
  floorTriggerReturn: number;

  /**
   * Guyton-Klinger style guardrails: adjust core spend up or down based on the
   * current withdrawal rate (annual portfolio draw ÷ total wealth). Symmetric —
   * cuts when a bad sequence pushes the rate high, RAISES when the portfolio
   * runs ahead. Adjustments persist (ratchet) until the next trigger.
   */
  guardrailsEnabled: boolean;
  /** Withdrawal rate above this → cut spending (e.g. 0.055). */
  guardrailUpperRate: number;
  /** Withdrawal rate below this → raise spending (e.g. 0.03). */
  guardrailLowerRate: number;
  /** Fractional spend change per trigger (e.g. 0.10 = ±10%). */
  guardrailAdjustPct: number;
  /** Spend multiplier bounds so it can't drift to zero or the moon. */
  guardrailMinMult: number;
  guardrailMaxMult: number;

  // Mortgage (nominal figures straight from the statement)
  mortgageBalance0: number;
  mortgageRate: number;
  mortgageMonthlyPI: number;
  /** Property tax + insurance, continues forever (real). */
  escrowAnnual: number;
  extraPrincipalMonthly: number;
  /** true: extra goes to principal. false: extra redirected to taxable brokerage. */
  prepay: boolean;

  /** Used only to deflate fixed-NOMINAL items (mortgage P&I, non-COLA pension) into real dollars. */
  inflation: number;

  // Healthcare
  /** Unsubsidized ACA family premium, real $/yr, while neither spouse has employer coverage and both < 65. */
  acaGrossPremium: number;
  /** Medicare+Medigap+dental for the couple, real $/yr, once 65+. */
  medicareAnnualCouple: number;
  /** People on the tax return (sets the poverty line for ACA subsidy math). */
  householdSize: number;

  // State income tax (flat rate above an exemption; gains taxed, SS exempt)
  stateTaxRate: number;
  stateTaxExemption: number;

  // Other income
  /** Pension, NOMINAL $/yr (non-COLA — deflated in real terms). */
  pensionAnnual: number;
  /** Whose pension it is — pensionStartAge is that spouse's age. */
  pensionOwner: "A" | "B";
  pensionStartAge: number;
  /** Social Security, real $/yr each, at ssStartAge (own age). */
  ssA: number;
  ssB: number;
  ssStartAge: number;

  // Roth conversion ladder
  conversionMode: ConversionMode;
  conversionFixed: number;
  /** For fillBracket mode: convert until federal TAXABLE ordinary income reaches this (e.g. top of 12% bracket). */
  conversionBracketTop: number;

  ruleOf55A: boolean;
  ruleOf55B: boolean;

  // Taxable brokerage cost basis at t=0, as a fraction of value.
  taxableBasisFraction: number;

  // HSA receipts
  hsaReceipts0: number;
  hsaAnnualReceipts: number;

  // Portfolio allocation. The whole portfolio (all buckets) is rebalanced
  // annually to the equity weight; the rest earns the bond return.
  /** Equity fraction when glidepath is off (and during working years when on). */
  equityPct: number;
  /** Bond-tent glidepath: de-risk during the bridge, re-risk after 59½. */
  glidepathEnabled: boolean;
  /** Equity fraction while fully retired and pre-59½ (the bridge). */
  equityPctBridge: number;
  /** Equity fraction once the younger spouse reaches 59½. */
  equityPctLate: number;
  /** Expected real bond return (Gaussian model + deterministic path). */
  bondRealReturn: number;
  /** Bond volatility for the Gaussian model. */
  bondVol: number;

  // Returns / Monte Carlo
  expectedRealReturn: number;
  returnVol: number;
  returnModel: ReturnModel;
  bootstrapBlockYears: number;
  /** Shift bootstrap sample mean to expectedRealReturn. */
  bootstrapMatchMean: boolean;
  numPaths: number;
  seed: number;

  /** Locked money above this at time of squeeze = "liquidity squeeze", not ruin. */
  squeezeLockedThreshold: number;
  /** Early-withdrawal penalty applied to emergency locked-trad withdrawals. */
  penaltyRate: number;
}

/** One simulated year, for the funding table and charts. */
export interface YearRecord {
  t: number;
  year: number;
  ageA: number;
  ageB: number;
  phase: "both" | "onlyA" | "onlyB" | "retired";
  grossReturn: number;
  /** CPI inflation applied this year (real historical value under cohort/bootstrap). */
  inflation: number;

  employmentIncome: number;
  /** Portion of employmentIncome from a forced/reactive re-entry to work this year. */
  reentryReactive: number;
  pensionIncome: number;
  ssIncome: number;

  coreSpend: number;
  /** Guardrail spend multiplier applied this year (1.0 = no adjustment). */
  spendMultiplier: number;
  childcare: number;
  housingPI: number;
  escrow: number;
  healthcare: number;
  totalSpend: number;

  conversion: number;
  /** Penalty-free 72(t) SEPP distribution received this year (real $). */
  sepp72t: number;
  taxesPaid: number;
  penaltyPaid: number;

  wTaxable: number;
  wRothBasis: number;
  wTrad: number;
  wHsa: number;
  wPenalized: number;

  savedToTaxable: number;

  // End-of-year balances
  taxable: number;
  cash: number;
  rothBasisTotal: number;
  rothEarningsTotal: number;
  rothPipelineTotal: number;
  tradA: number;
  tradB: number;
  hsa: number;
  mortgageBalance: number;

  accessible: number;
  locked: number;
  netWorth: number;

  squeezed: boolean;
  ruined: boolean;
  /** Spending that could not be funded even after penalty withdrawals. */
  shortfall: number;
}

/**
 * Path outcomes, best to worst:
 * - fullSuccess: money lasted to the end, never squeezed, never needed to work.
 * - backToWork: avoided a squeeze/ruin ONLY because reactive re-entry kicked in.
 * - liquiditySqueeze: accessible funds ran dry pre-59½ while wealth remained.
 * - trueRuin: actually out of money.
 */
export type Classification = "fullSuccess" | "backToWork" | "liquiditySqueeze" | "trueRuin";

export interface PathResult {
  years: YearRecord[];
  classification: Classification;
  firstSqueezeYear: number | null;
  ruinYear: number | null;
  /** First year reactive re-entry fired, or null if never. */
  firstReentryYear: number | null;
  /** Number of years reactive re-entry fired on this path. */
  reentryYears: number;
  /** Cumulative 10% early-withdrawal penalties actually paid over the path. */
  totalPenalties: number;
  endingNetWorth: number;
  endingAccessible: number;
}

/** One historical-cohort backtest: the plan replayed over the actual return
 *  sequence that began in `startYear`. */
export interface CohortResult {
  startYear: number;
  classification: Classification;
  endingNetWorth: number;
  firstSqueezeYear: number | null;
  ruinYear: number | null;
  reentryYears: number;
}

export interface HistogramBin {
  /** Inclusive lower edge (real $). */
  from: number;
  /** Exclusive upper edge; Infinity for the catch-all top bucket. */
  to: number;
  count: number;
}

export interface MonteCarloSummary {
  numPaths: number;
  fullSuccessPct: number;
  backToWorkPct: number;
  liquiditySqueezePct: number;
  trueRuinPct: number;
  /** Median years of forced re-entry among paths that went back to work. */
  medianReentryYears: number | null;
  /** Median total penalty dollars paid among squeezed paths — how bad amber really is. */
  medianSqueezePenalty: number | null;
  /** Blended annual portfolio returns for a sample of paths (spaghetti chart). */
  returnPaths: number[][];
  endingNetWorthP10: number;
  endingNetWorthP50: number;
  endingNetWorthP90: number;
  medianSqueezeYear: number | null;
  medianRuinYear: number | null;
  histogram: HistogramBin[];
  /** Raw ending net worths — lets the UI re-bin with a different cap without re-simulating. */
  endingNetWorths: number[];
  /** Per-year accessible-wealth percentiles for the fan chart. */
  accessibleP10: number[];
  accessibleP50: number[];
  accessibleP90: number[];
  /** Present only for the historical-cohort model: one entry per start year. */
  cohorts?: CohortResult[];
}

/** One input's swing in a tornado / sensitivity analysis. */
export interface TornadoRow {
  key: keyof SimInputs;
  label: string;
  /** Baseline full-success %. */
  base: number;
  /** Full-success % at the low and high perturbation. */
  lowPct: number;
  highPct: number;
  /** Human-readable perturbed values, for the tooltip. */
  lowLabel: string;
  highLabel: string;
  /** Largest absolute deviation from base — bars are sorted by this. */
  swing: number;
}

/** Result of the earliest-retirement-year solver. */
export interface SolveResult {
  spouse: "spouseA" | "spouseB";
  targetPct: number;
  /** Earliest retirement year meeting the target, or null if even the latest candidate fails. */
  year: number | null;
  /** Full-success % at that year. */
  pct: number | null;
  /** Every year the search evaluated, for transparency. */
  checked: { year: number; pct: number }[];
}
