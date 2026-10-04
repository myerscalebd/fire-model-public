import type { Balances, HouseholdState, SimInputs } from "../engine/types";

/**
 * Build the starting household state from the profile's balances. No personal
 * numbers live here anymore — balances are part of SimInputs (see the profile).
 *
 * Current Roth balances are treated as fully accessible BASIS; growth from here
 * accrues to (locked) earnings. Education-only money (529s) is out of scope.
 */
export function initialState(inputs: SimInputs): HouseholdState {
  const b = inputs.balances;
  return {
    taxable: { value: b.taxable, basis: b.taxable * inputs.taxableBasisFraction },
    cash: b.cash,
    spouseA: {
      rothBasis: b.rothBasisA,
      rothEarnings: 0,
      rothPipeline: [],
      trad: b.tradA,
    },
    spouseB: {
      rothBasis: b.rothBasisB,
      rothEarnings: 0,
      rothPipeline: [],
      trad: b.tradB,
    },
    hsa: b.hsa,
    hsaReceipts: inputs.hsaReceipts0,
    everSqueezed: false,
    ruined: false,
  };
}

/** A neutral example household — round numbers, not anyone real. */
export const EXAMPLE_BALANCES: Balances = {
  taxable: 520_000,
  cash: 20_000,
  rothBasisA: 340_000,
  tradA: 410_000,
  rothBasisB: 260_000,
  tradB: 1_200_000,
  hsa: 60_000,
};
