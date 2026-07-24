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
    calebRothBasis: 300_000, // spouse A: Roth contributions + matured conversions
    calebTrad: 400_000, // spouse A: traditional 401k/IRA (locked until 59½)
    katyRothBasis: 250_000, // spouse B
    katyTrad: 800_000, // spouse B
    hsa: 50_000,
  },

  calebNetIncome: 110_000, // spouse A take-home while working
  katyNetIncome: 120_000, // spouse B take-home while working

  mortgageBalance0: 400_000,
  mortgageRate: 0.06,
  mortgageMonthlyPI: 2_398,
  escrowAnnual: 9_000,
};

export default profile;
