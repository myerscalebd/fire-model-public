import type { SimInputs } from "../engine/types";
import { EXAMPLE_BALANCES } from "./accounts";
import { DEFAULT_STATE_EXEMPT, DEFAULT_STATE_RATE } from "./taxTables";

/**
 * Neutral EXAMPLE profile — a made-up two-earner household in their late 30s.
 * Nothing here is anyone real; it's a starting point to explore the tool.
 *
 * To use your own numbers without committing them: copy this shape into
 * `src/data/profile.local.ts` (gitignored) exporting a `default` SimInputs, and
 * the app will auto-load it. Or just edit everything in the UI and Export/Import.
 * Real (startYear) dollars unless noted.
 */
export const DEFAULT_INPUTS: SimInputs = {
  // Two people. Engine keys stay spouseA/spouseB internally; these are the labels.
  nameA: "You",
  nameB: "Partner",
  balances: EXAMPLE_BALANCES,

  startYear: 2026,
  horizonYears: 50,
  startAgeA: 35,
  startAgeB: 39,

  // Retirement timing — the sliders the whole tool exists to explore.
  // The older spouse steps back first; the younger works longer to fund the bridge.
  retireYearA: 2036,
  retireYearB: 2028,

  // Take-home pay while working (after taxes AND payroll retirement deferrals).
  netIncomeA: 100_000,
  netIncomeB: 140_000,
  // Pre-tax employee 401k deferrals (added to the trad accounts, not netted here).
  contribTradA: 23_500,
  contribTradB: 23_500,
  // Backdoor Roth IRAs are funded from after-tax take-home, so they are NOT added
  // on top of net income (that double-counts) — set >0 to route surplus to Roth.
  contribRothA: 0,
  contribRothB: 0,
  reentryIncome: 0, // set ~50k to model an always-on re-entry backstop

  // Reactive backstop (on by default — a real household would respond rather
  // than let accessible funds hit zero). Someone works ~$50k/yr only once
  // accessible falls below 2 years of spending, for at least 3 years, and only
  // while the younger spouse is ≤ 60. Turn OFF to see the "do nothing" squeeze.
  reactiveReentryEnabled: true,
  reactiveReentryIncome: 50_000,
  reactiveReentryTriggerYears: 2,
  reactiveReentryMinYears: 3,
  reactiveReentryMaxAge: 60,

  // Access ages. unlockAge 60 is the integer-year proxy for 59½.
  unlockAge: 60,
  hsaUnlockAge: 65,
  medicareAge: 65,
  ruleOf55Age: 55,

  // 72(t) SEPP — off by default.
  sepp72tA: false,
  sepp72tStartYearA: 2036,
  sepp72tB: false,
  sepp72tStartYearB: 2028,
  sepp72tRate: 0.05,

  // Spend = core + childcare + housing (mortgage engine) + healthcare (ACA/Medicare).
  coreSpend: 90_000,
  childcareAnnual: 40_000,
  childcareLastYear: 2027,

  floorEnabled: false,
  floorCutAmount: 40_000,
  floorTriggerReturn: -0.2,

  // Guardrails off by default (baseline shows fixed real spend). Enabling them is
  // the single most powerful robustness lever — and, symmetrically, lets good
  // sequences spend more instead of dying with a huge unspent balance.
  guardrailsEnabled: false,
  guardrailUpperRate: 0.055,
  guardrailLowerRate: 0.03,
  guardrailAdjustPct: 0.1,
  guardrailMinMult: 0.7,
  guardrailMaxMult: 1.5,

  // Mortgage — example 30-yr loan (nominal $). First-month split for $400k @ 6%
  // is ~$398 principal / $2,000 interest, validated in mortgage.test.ts.
  mortgageBalance0: 400_000,
  mortgageRate: 0.06,
  mortgageMonthlyPI: 2_398,
  escrowAnnual: 9_000, // ~$750/mo tax + insurance, never ends
  extraPrincipalMonthly: 1_000,
  prepay: true,

  inflation: 0.025,

  acaGrossPremium: 25_000,
  medicareAnnualCouple: 8_000,
  householdSize: 4,

  // Defaults are Ohio's flat tax; use 0 for a no-income-tax state.
  stateTaxRate: DEFAULT_STATE_RATE,
  stateTaxExemption: DEFAULT_STATE_EXEMPT,

  pensionAnnual: 10_000, // nominal, assumed non-COLA → erodes in real terms
  pensionOwner: "A",
  pensionStartAge: 65,
  ssA: 25_000,
  ssB: 25_000,
  ssStartAge: 67,

  conversionMode: "fillBracket",
  conversionFixed: 60_000,
  conversionBracketTop: 96_950, // top of the 12% federal bracket (2025 MFJ, taxable)

  ruleOf55A: false,
  ruleOf55B: false,

  taxableBasisFraction: 0.7,

  hsaReceipts0: 10_000,
  hsaAnnualReceipts: 2_000,

  // Portfolio: 90/10 by default; enable the glidepath for a "bond tent".
  equityPct: 0.9,
  glidepathEnabled: false,
  equityPctBridge: 0.6,
  equityPctLate: 0.8,
  bondRealReturn: 0.02,
  bondVol: 0.07,

  expectedRealReturn: 0.06,
  returnVol: 0.12,
  returnModel: "bootstrap",
  bootstrapBlockYears: 3,
  bootstrapMatchMean: false,
  numPaths: 1000,
  seed: 20260601,

  squeezeLockedThreshold: 25_000,
  penaltyRate: 0.1,
};
