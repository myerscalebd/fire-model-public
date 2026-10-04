import type { SimInputs } from "../engine/types";

/**
 * TEMPLATE for a private profile. To use your own numbers without committing
 * them: copy this file to `profile.local.ts` (same folder), fill in your
 * figures, and the app auto-loads it. `profile.local.ts` is gitignored, so it
 * never enters git or the shared repo.
 *
 * Only include the fields you want to override — everything else falls back to
 * the neutral example in assumptions.ts. (You can also just edit values in the
 * UI and use Export/Import; the local file is for "load my data automatically".)
 */
const profile: Partial<SimInputs> = {
  nameA: "You",
  nameB: "Partner",

  balances: {
    taxable: 500_000, // taxable brokerage (realizes capital gains when sold)
    cash: 20_000, // bank / money-market
    rothBasisA: 300_000, // spouse A: Roth contributions + matured conversions
    tradA: 400_000, // spouse A: traditional 401k/IRA (locked until 59½)
    rothBasisB: 250_000, // spouse B
    tradB: 800_000, // spouse B
    hsa: 50_000,
  },

  netIncomeA: 110_000, // spouse A take-home while working
  netIncomeB: 120_000, // spouse B take-home while working

  mortgageBalance0: 400_000,
  mortgageRate: 0.06,
  mortgageMonthlyPI: 2_398,
  escrowAnnual: 9_000,

  // householdSize: 4, // people on the tax return (ACA poverty line)
  // stateTaxRate: 0, stateTaxExemption: 0, // e.g. a no-income-tax state
  // pensionOwner: "B", pensionAnnual: 20_000, pensionStartAge: 65,
};

export default profile;
