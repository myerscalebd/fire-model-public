import { describe, expect, it } from "vitest";
import { DEFAULT_INPUTS } from "../data/assumptions";
import type { AccessFlags } from "./withdrawal";
import { allocateWithdrawals, solveFunding } from "./withdrawal";
import type { HouseholdState } from "./types";

const LOCKED: AccessFlags = {
  calebTradUnlocked: false,
  katyTradUnlocked: false,
  calebRothUnlocked: false,
  katyRothUnlocked: false,
  hsaGeneralUnlocked: false,
};

function makeState(over: Partial<HouseholdState> = {}): HouseholdState {
  return {
    taxable: { value: 100_000, basis: 70_000 },
    cash: 10_000,
    caleb: { rothBasis: 50_000, rothEarnings: 20_000, rothPipeline: [], trad: 200_000 },
    katy: { rothBasis: 80_000, rothEarnings: 30_000, rothPipeline: [], trad: 300_000 },
    hsa: 40_000,
    hsaReceipts: 12_000,
    everSqueezed: false,
    ruined: false,
    ...over,
  };
}

describe("withdrawal waterfall order", () => {
  it("cash then taxable first", () => {
    const p = allocateWithdrawals(makeState(), LOCKED, 50_000);
    expect(p.cash).toBe(10_000);
    expect(p.taxable).toBe(40_000);
    expect(p.rothKaty + p.rothCaleb).toBe(0);
  });

  it("realizes proportional gains on taxable sales", () => {
    const p = allocateWithdrawals(makeState(), LOCKED, 60_000);
    // taxable draw 50k at 30% embedded gain
    expect(p.realizedGains).toBeCloseTo(50_000 * 0.3, 5);
  });

  it("Roth basis after taxable, Katy's before Caleb's, earnings stay locked", () => {
    const p = allocateWithdrawals(makeState(), LOCKED, 200_000);
    // 10k cash + 100k taxable + 80k Katy basis + 10k Caleb basis
    expect(p.rothKaty).toBe(80_000);
    expect(p.rothCaleb).toBe(10_000);
    expect(p.rothBasisPart).toBe(90_000);
    expect(p.tradCaleb + p.tradKaty).toBe(0);
    expect(p.penTradCaleb + p.penTradKaty).toBe(0);
  });

  it("locked Roth earnings are NOT withdrawable pre-59½ (spec §8.2)", () => {
    const p = allocateWithdrawals(makeState(), LOCKED, 300_000);
    // Accessible: 10k + 100k + 130k basis + 12k HSA receipts = 252k.
    // The remaining 48k must come from PENALIZED trad, not Roth earnings.
    expect(p.rothKaty).toBe(80_000);
    expect(p.rothCaleb).toBe(50_000);
    expect(p.hsaReceiptsFree).toBe(12_000);
    expect(p.penTradKaty).toBeCloseTo(48_000, 5);
    expect(p.shortfall).toBe(0);
  });

  it("unlocked traditional comes before penalty money", () => {
    const access = { ...LOCKED, katyTradUnlocked: true, katyRothUnlocked: true };
    const p = allocateWithdrawals(makeState(), access, 300_000);
    // 10k + 100k + Katy roth (80k basis + 30k earnings, unlocked) + Caleb basis 50k = 270k,
    // then Katy trad 30k. No penalties.
    expect(p.tradKaty).toBeCloseTo(30_000, 5);
    expect(p.penTradCaleb + p.penTradKaty).toBe(0);
  });

  it("reports shortfall when literally everything is gone", () => {
    const p = allocateWithdrawals(makeState(), LOCKED, 10_000_000);
    expect(p.shortfall).toBeGreaterThan(0);
  });
});

describe("solveFunding fixed point", () => {
  it("grosses up traditional withdrawals for tax (unlocked retiree)", () => {
    const state = makeState({
      taxable: { value: 0, basis: 0 },
      cash: 0,
      caleb: { rothBasis: 0, rothEarnings: 0, rothPipeline: [], trad: 2_000_000 },
      katy: { rothBasis: 0, rothEarnings: 0, rothPipeline: [], trad: 0 },
      hsa: 0,
      hsaReceipts: 0,
    });
    const access: AccessFlags = {
      calebTradUnlocked: true,
      katyTradUnlocked: true,
      calebRothUnlocked: true,
      katyRothUnlocked: true,
      hsaGeneralUnlocked: true,
    };
    const f = solveFunding(
      state,
      access,
      {
        fixedSpend: 100_000,
        netIncome: 0,
        baseOrdinary: 0,
        pensionCash: 0,
        ssGross: 0,
        acaGross: 0,
        medicareCost: 8_000,
      },
      DEFAULT_INPUTS,
    );
    const w = f.plan.tradCaleb;
    // Withdrawal covers spend + its own tax, so it exceeds 108k by the tax bill.
    expect(w).toBeGreaterThan(108_000);
    expect(w).toBeCloseTo(108_000 + f.taxes, 0);
    expect(f.taxes).toBeGreaterThan(0);
    expect(f.plan.shortfall).toBe(0);
  });

  it("ACA premium responds to MAGI inside the solver", () => {
    // Household living off Roth basis: MAGI ≈ 0 → Medicaid/no premium.
    const rothOnly = makeState({
      taxable: { value: 0, basis: 0 },
      cash: 0,
      caleb: { rothBasis: 500_000, rothEarnings: 0, rothPipeline: [], trad: 0 },
      katy: { rothBasis: 500_000, rothEarnings: 0, rothPipeline: [], trad: 0 },
      hsa: 0,
      hsaReceipts: 0,
    });
    const f1 = solveFunding(
      rothOnly,
      LOCKED,
      { fixedSpend: 80_000, netIncome: 0, baseOrdinary: 0, pensionCash: 0, ssGross: 0, acaGross: 25_000, medicareCost: 0 },
      DEFAULT_INPUTS,
    );
    expect(f1.acaCost).toBe(0);

    // Same spend but with a $100k conversion → MAGI high → premium > 0.
    const f2 = solveFunding(
      rothOnly,
      LOCKED,
      { fixedSpend: 80_000, netIncome: 0, baseOrdinary: 100_000, pensionCash: 0, ssGross: 0, acaGross: 25_000, medicareCost: 0 },
      DEFAULT_INPUTS,
    );
    expect(f2.acaCost).toBeGreaterThan(5_000);
  });

  it("working-year surplus flows out, no withdrawals", () => {
    const f = solveFunding(
      makeState(),
      LOCKED,
      { fixedSpend: 150_000, netIncome: 272_000, baseOrdinary: 0, pensionCash: 0, ssGross: 0, acaGross: 0, medicareCost: 0 },
      DEFAULT_INPUTS,
    );
    expect(f.plan.taxable + f.plan.cash).toBe(0);
    expect(f.surplus).toBeCloseTo(122_000, 0);
  });
});
