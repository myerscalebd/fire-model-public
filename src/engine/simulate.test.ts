import { describe, expect, it } from "vitest";
import { DEFAULT_INPUTS } from "../data/assumptions";
import { singleLifeExpectancy } from "../data/taxTables";
import { deterministicPath, flatPath } from "./returns";
import { buildContext, runPath, sepp72tPayment } from "./simulate";
import type { SimInputs } from "./types";

function inputs(over: Partial<SimInputs> = {}): SimInputs {
  return { ...DEFAULT_INPUTS, ...over };
}

function run(inp: SimInputs, returns = deterministicPath(inp)) {
  return runPath(buildContext(inp), returns);
}

describe("baseline deterministic projection", () => {
  const res = run(inputs());

  it("succeeds at 6% real with the default stagger (spec: 'the answer is essentially yes')", () => {
    expect(res.classification).toBe("fullSuccess");
    expect(res.ruinYear).toBeNull();
    expect(res.endingNetWorth).toBeGreaterThan(2_000_000);
  });

  it("accumulates while both work — no withdrawals, surplus saved", () => {
    const y0 = res.years[0];
    expect(y0.phase).toBe("both");
    expect(y0.wTaxable + y0.wRothBasis + y0.wTrad + y0.wPenalized).toBe(0);
    expect(y0.savedToTaxable).toBeGreaterThan(0);
  });

  it("childcare ends on schedule", () => {
    const last = res.years.find((y) => y.year === DEFAULT_INPUTS.childcareLastYear)!;
    const after = res.years.find((y) => y.year === DEFAULT_INPUTS.childcareLastYear + 1)!;
    expect(last.childcare).toBe(DEFAULT_INPUTS.childcareAnnual);
    expect(after.childcare).toBe(0);
  });

  it("mortgage P&I ends at payoff, escrow never does", () => {
    const paidOff = res.years.filter((y) => y.mortgageBalance === 0);
    expect(paidOff.length).toBeGreaterThan(30);
    const lastYear = res.years[res.years.length - 1];
    expect(lastYear.housingPI).toBe(0);
    expect(lastYear.escrow).toBe(DEFAULT_INPUTS.escrowAnnual);
  });

  it("healthcare switches from employer ($0) to ACA to Medicare", () => {
    const whileWorking = res.years.find((y) => y.phase !== "retired")!;
    expect(whileWorking.healthcare).toBe(0);
    const retiredPre65 = res.years.find((y) => y.phase === "retired" && y.ageB < 65)!;
    expect(retiredPre65.healthcare).toBeGreaterThanOrEqual(0);
    const both65 = res.years.find((y) => y.ageA >= 65)!;
    expect(both65.healthcare).toBeCloseTo(DEFAULT_INPUTS.medicareAnnualCouple, 0);
  });

  it("SS and pension arrive at the configured ages", () => {
    const atSS = res.years.find((y) => y.ageB === DEFAULT_INPUTS.ssStartAge)!;
    expect(atSS.ssIncome).toBe(DEFAULT_INPUTS.ssB);
    const atPension = res.years.find((y) => y.ageA === DEFAULT_INPUTS.pensionStartAge)!;
    // Non-COLA pension is deflated to real dollars.
    expect(atPension.pensionIncome).toBeGreaterThan(0);
    expect(atPension.pensionIncome).toBeLessThan(DEFAULT_INPUTS.pensionAnnual);
  });

  it("runs Roth conversions only in retired years while trad is locked", () => {
    const convYears = res.years.filter((y) => y.conversion > 0);
    expect(convYears.length).toBeGreaterThan(0);
    for (const y of convYears) {
      expect(y.phase).toBe("retired");
      expect(y.ageA).toBeLessThan(60);
    }
  });
});

describe("failure classification (the key feature)", () => {
  it("high spend → liquidity squeeze while locked money remains", () => {
    const res = run(
      inputs({
        retireYearA: 2026,
        retireYearB: 2026,
        coreSpend: 90_000,
        conversionMode: "off",
        floorEnabled: false,
      }),
    );
    expect(res.classification).toBe("liquiditySqueeze");
    expect(res.firstSqueezeYear).not.toBeNull();
    // Squeeze must happen before spouse B's traditional unlocks (age 60 → 2047).
    expect(res.firstSqueezeYear!).toBeLessThan(2047);
    expect(res.ruinYear).toBeNull();
  });

  it("absurd spend → true ruin", () => {
    const res = run(
      inputs({
        retireYearA: 2026,
        retireYearB: 2026,
        coreSpend: 600_000,
        conversionMode: "off",
      }),
    );
    expect(res.classification).toBe("trueRuin");
    expect(res.ruinYear).not.toBeNull();
  });

  it("squeeze year precedes ruin year when both occur", () => {
    const res = run(
      inputs({ retireYearA: 2026, retireYearB: 2026, coreSpend: 400_000, conversionMode: "off" }),
    );
    if (res.classification === "trueRuin" && res.firstSqueezeYear !== null) {
      expect(res.firstSqueezeYear).toBeLessThanOrEqual(res.ruinYear!);
    }
  });
});

describe("reactive re-entry (auto back-to-work when squeezed)", () => {
  // Both retire immediately into a spend heavy enough to drain accessible funds.
  const stress = {
    retireYearA: 2026,
    retireYearB: 2026,
    coreSpend: 140_000,
    conversionMode: "off" as const,
    floorEnabled: false,
  };

  it("does nothing when disabled", () => {
    const res = run(inputs({ ...stress, reactiveReentryEnabled: false }));
    expect(res.years.every((y) => y.reentryReactive === 0)).toBe(true);
  });

  it("fires only when someone is retired, only while spouse A is of working age, at the set wage", () => {
    const inp = inputs({ ...stress, reactiveReentryEnabled: true });
    const res = run(inp);
    const working = res.years.filter((y) => y.reentryReactive > 0);
    expect(working.length).toBeGreaterThan(0);
    for (const y of working) {
      expect(y.phase).not.toBe("both");
      expect(y.ageA).toBeLessThanOrEqual(inp.reactiveReentryMaxAge);
      expect(y.reentryReactive).toBe(inp.reactiveReentryIncome);
      expect(y.employmentIncome).toBeGreaterThanOrEqual(inp.reactiveReentryIncome);
    }
    // A stint is a real commitment: at least the minimum number of years.
    expect(working.length).toBeGreaterThanOrEqual(inp.reactiveReentryMinYears);
  });

  it("staggered bleed: the retired spouse re-enters even while the other still works", () => {
    // spouse B retires 2028; spouse A works to 70 against a heavy spend that outruns that
    // solo income, so accessible funds bleed dry during the onlyA phase.
    const inp = inputs({
      retireYearA: 2061,
      retireYearB: 2028,
      coreSpend: 200_000,
      conversionMode: "off",
      reactiveReentryEnabled: true,
    });
    const res = run(inp);
    const staggered = res.years.filter((y) => y.phase === "onlyA" && y.reentryReactive > 0);
    expect(staggered.length).toBeGreaterThan(0);
  });

  it("triggers only after accessible funds actually fall (not in year one)", () => {
    const res = run(inputs({ ...stress, reactiveReentryEnabled: true }));
    expect(res.years[0].reentryReactive).toBe(0);
    const firstReentry = res.years.find((y) => y.reentryReactive > 0)!;
    expect(firstReentry.year).toBeGreaterThan(2026);
  });

  it("a bigger reactive wage reduces true ruin across paths", () => {
    const off = runPath(buildContext(inputs({ ...stress, reactiveReentryEnabled: false })), deterministicPath(inputs(stress)));
    const on = run(inputs({ ...stress, reactiveReentryEnabled: true, reactiveReentryIncome: 80_000 }));
    // Re-entry converts otherwise-ruinous years into survivable ones.
    expect(on.endingNetWorth).toBeGreaterThanOrEqual(off.endingNetWorth);
  });
});

describe("Roth ladder mechanics in the full sim", () => {
  it("conversions raise accessible basis ~5 years later", () => {
    const inp = inputs({
      retireYearA: 2026,
      retireYearB: 2026,
      conversionMode: "fixed",
      conversionFixed: 80_000,
    });
    const res = run(inp);
    const y2026 = res.years.find((y) => y.year === 2026)!;
    expect(y2026.conversion).toBe(80_000);
    expect(y2026.rothPipelineTotal).toBeGreaterThanOrEqual(80_000);
    // After 5 years the first rungs have matured out of the pipeline into basis.
    const y2032 = res.years.find((y) => y.year === 2032)!;
    expect(y2032.rothPipelineTotal).toBeLessThanOrEqual(5 * 80_000);
  });
});

describe("floor-spending rule", () => {
  it("cuts core spend the year after a bad return", () => {
    const inp = inputs({ floorEnabled: true, retireYearA: 2026, retireYearB: 2026 });
    const returns = deterministicPath(inp);
    returns[4] = { stock: -0.3, bond: -0.3, inflation: 0.025 }; // crash in year 4
    const res = run(inp, returns);
    expect(res.years[5].coreSpend).toBe(inp.coreSpend - inp.floorCutAmount);
    expect(res.years[4].coreSpend).toBe(inp.coreSpend);
    expect(res.years[6].coreSpend).toBe(inp.coreSpend);
  });
});

describe("spending guardrails (Guyton-Klinger)", () => {
  const retireNow = {
    retireYearA: 2026,
    retireYearB: 2026,
    conversionMode: "off" as const,
    reactiveReentryEnabled: false,
    guardrailsEnabled: true,
  };

  it("does nothing when disabled (multiplier stays 1)", () => {
    const res = run(inputs({ ...retireNow, guardrailsEnabled: false }));
    expect(res.years.every((y) => y.spendMultiplier === 1)).toBe(true);
  });

  it("raises spending when the portfolio runs far ahead (low withdrawal rate)", () => {
    // Modest spend compounding at 6% real → withdrawal rate falls well under the
    // 3% lower rail late in life, so spend ratchets UP to the max multiplier.
    const res = run(inputs({ ...retireNow, coreSpend: 60_000 }));
    const last = res.years[res.years.length - 1];
    expect(last.spendMultiplier).toBeGreaterThan(1);
    expect(last.spendMultiplier).toBeCloseTo(DEFAULT_INPUTS.guardrailMaxMult, 6);
  });

  it("cuts spending when a heavy draw pushes the withdrawal rate high", () => {
    const res = run(inputs({ ...retireNow, coreSpend: 200_000 }));
    const someCut = res.years.some((y) => y.phase === "retired" && y.spendMultiplier < 1);
    expect(someCut).toBe(true);
    for (const y of res.years) {
      expect(y.spendMultiplier).toBeGreaterThanOrEqual(DEFAULT_INPUTS.guardrailMinMult - 1e-9);
    }
  });

  it("core spend reflects the multiplier", () => {
    const res = run(inputs({ ...retireNow, coreSpend: 60_000 }));
    const y = res.years.find((r) => r.year === 2045)!;
    expect(y.coreSpend).toBeCloseTo(60_000 * y.spendMultiplier, 6);
  });
});

describe("prepay vs invest toggle", () => {
  const prepay = run(inputs({ prepay: true }));
  const invest = run(inputs({ prepay: false }));

  it("prepay clears the mortgage years earlier", () => {
    const payoffYear = (r: typeof prepay) => r.years.find((y) => y.mortgageBalance === 0)!.year;
    expect(payoffYear(prepay)).toBeLessThan(payoffYear(invest));
  });

  it("both scenarios stay solvent and end wealthy at 6% real", () => {
    expect(prepay.classification).toBe("fullSuccess");
    expect(invest.classification).toBe("fullSuccess");
  });
});

describe("Rule of 55", () => {
  it("unlocks spouse B's 401k penalty-free once that spouse separates in their 55+ year", () => {
    // spouse B works through 2042 — the calendar year they turn 55 — so their
    // separation year qualifies; then a heavy-spend retirement.
    const base = inputs({
      retireYearA: 2028,
      retireYearB: 2043,
      coreSpend: 200_000,
      conversionMode: "off",
      floorEnabled: false,
    });
    const without = run(inputs({ ...base, ruleOf55B: false }));
    const withRule = run(inputs({ ...base, ruleOf55B: true }));

    const window = (r: typeof without) =>
      r.years.filter((y) => y.year >= 2043 && y.ageB < 60);
    // Without the rule they pay penalties in their 55–59 years; with it they
    // draw their traditional directly, penalty-free.
    expect(window(without).some((y) => y.wPenalized > 0)).toBe(true);
    expect(window(withRule).every((y) => y.wPenalized === 0)).toBe(true);
    expect(window(withRule).some((y) => y.wTrad > 0)).toBe(true);
    expect(withRule.years.filter((y) => y.wPenalized > 0).length).toBeLessThanOrEqual(
      without.years.filter((y) => y.wPenalized > 0).length,
    );
  });
});

describe("72(t) SEPP", () => {
  const base = {
    retireYearA: 2028,
    retireYearB: 2028,
    conversionMode: "off" as const,
    reactiveReentryEnabled: false,
    sepp72tB: true,
    sepp72tStartYearB: 2028,
  };

  it("fixed-amortization payment matches the closed form", () => {
    // Age 45, LE 41.0, 5%: P = B·r / (1 − (1+r)^−LE)
    const p = sepp72tPayment(1_000_000, 45, 0.05);
    const expected = (1_000_000 * 0.05) / (1 - Math.pow(1.05, -singleLifeExpectancy(45)));
    expect(p).toBeCloseTo(expected, 6);
    expect(p).toBeGreaterThan(55_000);
    expect(p).toBeLessThan(62_000);
  });

  it("distributes penalty-free from the start year and reduces that spouse's trad", () => {
    const res = run(inputs(base));
    const y0 = res.years.find((y) => y.year === 2028)!;
    expect(y0.sepp72t).toBeGreaterThan(0);
    expect(y0.wPenalized).toBe(0);
    const before = res.years.find((y) => y.year === 2027)!;
    expect(y0.tradB).toBeLessThan(before.tradB);
  });

  it("runs until the LATER of 5 years or 59½, then stops", () => {
    const res = run(inputs(base));
    // spouse B is 41 in 2028; must run until they reach unlockAge (60) → 2047.
    const running = res.years.filter((y) => y.sepp72t > 0);
    expect(running[0].year).toBe(2028);
    expect(running[running.length - 1].year).toBe(2046); // last year before age 60
    // A late start near 59½ still runs the full 5 years.
    const late = run(inputs({ ...base, sepp72tStartYearB: 2046 })); // spouse B 59
    const lateRun = late.years.filter((y) => y.sepp72t > 0);
    expect(lateRun.length).toBe(5);
  });

  it("payment is fixed in nominal dollars — real value erodes with inflation", () => {
    const res = run(inputs(base)); // flat 2.5% inflation deterministic path
    const first = res.years.find((y) => y.year === 2028)!.sepp72t;
    const second = res.years.find((y) => y.year === 2029)!.sepp72t;
    expect(second).toBeCloseTo(first / 1.025, 6);
  });

  it("SEPP income is taxed as ordinary income", () => {
    const res = run(inputs(base));
    const y0 = res.years.find((y) => y.year === 2028)!;
    // ~$90k+ of SEPP ordinary income with no other income → federal tax due.
    expect(y0.taxesPaid).toBeGreaterThan(0);
  });

  it("a SEPP-active spouse's traditional is excluded from the conversion ladder", () => {
    // SEPP on BOTH spouses → no convertible trad → the ladder must go quiet.
    const bothSepp = inputs({
      ...base,
      conversionMode: "fillBracket" as const,
      sepp72tA: true,
      sepp72tStartYearA: 2028,
    });
    const res = run(bothSepp);
    for (const y of res.years) {
      if (y.sepp72t > 0) expect(y.conversion).toBe(0);
    }
    // Control: without SEPP the same plan converts in those years.
    const control = run(inputs({ ...base, sepp72tB: false, conversionMode: "fillBracket" as const }));
    expect(control.years.some((y) => y.year >= 2028 && y.conversion > 0)).toBe(true);
  });

  it("emergency penalized draws avoid the SEPP account until the other trad is gone", () => {
    // Heavy spend forces escape-valve withdrawals while spouse B's SEPP runs. The
    // invariant: while spouse A still has (non-SEPP) traditional, spouse B's account is
    // only touched by its SEPP payment — never an extra penalized draw.
    const stress = inputs({
      retireYearA: 2026,
      retireYearB: 2026,
      coreSpend: 230_000,
      conversionMode: "off" as const,
      reactiveReentryEnabled: false,
      sepp72tB: true,
      sepp72tStartYearB: 2026,
    });
    const res = run(stress);
    expect(res.years.some((y) => y.wPenalized > 0)).toBe(true); // escape valve engaged
    for (let i = 1; i < res.years.length; i++) {
      const prev = res.years[i - 1];
      const cur = res.years[i];
      if (cur.sepp72t <= 0) continue;
      // A SEPP-only year ends at (start − sepp)·(1+r) (withdraw then grow).
      // If spouse B ends BELOW that, an extra penalized draw hit that account — and
      // that's only allowed once spouse A's traditional is fully drained by year-end.
      const seppOnlyFloor = (prev.tradB - cur.sepp72t) * (1 + cur.grossReturn) - 2;
      if (cur.tradB < seppOnlyFloor) {
        expect(cur.tradA).toBeLessThan(1_000);
      }
    }
  });

  it("bridges the squeeze: SEPP delays accessible exhaustion and cuts penalized years", () => {
    const mild = inputs({
      retireYearA: 2026,
      retireYearB: 2026,
      coreSpend: 90_000,
      conversionMode: "off" as const,
      reactiveReentryEnabled: false,
    });
    const without = runPath(buildContext(mild), deterministicPath(mild));
    const withSepp = runPath(
      buildContext(inputs({ ...mild, sepp72tB: true, sepp72tStartYearB: 2026 })),
      deterministicPath(mild),
    );
    const penYears = (r: typeof without) => r.years.filter((y) => y.wPenalized > 0).length;
    expect(penYears(withSepp)).toBeLessThan(penYears(without));
    if (without.firstSqueezeYear !== null && withSepp.firstSqueezeYear !== null) {
      expect(withSepp.firstSqueezeYear).toBeGreaterThan(without.firstSqueezeYear);
    }
  });
});

describe("adjustable access ages", () => {
  it("lowering unlockAge opens traditional earlier", () => {
    const inp = inputs({
      retireYearA: 2026,
      retireYearB: 2026,
      coreSpend: 90_000,
      conversionMode: "off",
      reactiveReentryEnabled: false,
      unlockAge: 56,
    });
    const res = run(inp);
    // spouse B turns 56 in 2043; unpenalized trad withdrawals should appear then,
    // 4 years earlier than the default-60 world.
    const firstTrad = res.years.find((y) => y.wTrad > 0);
    expect(firstTrad).toBeDefined();
    expect(firstTrad!.ageB).toBeLessThan(60);
    expect(firstTrad!.ageB).toBeGreaterThanOrEqual(56);
    // The year that trad unlocks, it covers the need — no penalty that year.
    // (Penalized draws may resume later from spouse A's still-locked accounts.)
    expect(firstTrad!.wPenalized).toBe(0);
  });

  it("raising medicareAge keeps the couple on the ACA longer", () => {
    const inp = inputs({ retireYearA: 2028, retireYearB: 2028, medicareAge: 68 });
    const res = run(inp);
    const at66B = res.years.find((y) => y.ageB === 66)!;
    // At spouse B 66 (spouse A 62) with medicareAge 68, both are still pre-Medicare →
    // healthcare is the full ACA premium (subsidy-adjusted), not the 1-on-medicare blend.
    const defaultRes = run(inputs({ retireYearA: 2028, retireYearB: 2028 }));
    const defaultBAt66 = defaultRes.years.find((y) => y.ageB === 66)!;
    expect(at66B.healthcare).not.toBe(defaultBAt66.healthcare);
  });
});

describe("asset allocation & glidepath", () => {
  it("equity weight blends the two asset returns (0% equity → pure bond growth)", () => {
    // Stocks +20%/yr, bonds 0%: an all-bond portfolio should see no growth boost.
    const inp = inputs({ equityPct: 0, glidepathEnabled: false, retireYearA: 2060, retireYearB: 2060 });
    const path = Array.from({ length: inp.horizonYears }, () => ({ stock: 0.2, bond: 0, inflation: 0.025 }));
    const allBond = runPath(buildContext(inp), path);
    const allStock = runPath(buildContext(inputs({ ...inp, equityPct: 1 })), path);
    expect(allStock.endingNetWorth).toBeGreaterThan(allBond.endingNetWorth * 2);
  });

  it("recorded gross return equals the blended return", () => {
    const inp = inputs({ equityPct: 0.5, glidepathEnabled: false });
    const path = Array.from({ length: inp.horizonYears }, () => ({ stock: 0.1, bond: 0.02, inflation: 0.025 }));
    const res = runPath(buildContext(inp), path);
    expect(res.years[0].grossReturn).toBeCloseTo(0.5 * 0.1 + 0.5 * 0.02, 10);
  });

  it("bond tent: bridge years use the bridge weight, post-59½ the late weight", () => {
    const inp = inputs({
      glidepathEnabled: true,
      equityPct: 0.9,
      equityPctBridge: 0.4,
      equityPctLate: 0.7,
      retireYearA: 2030,
      retireYearB: 2028,
    });
    const path = Array.from({ length: inp.horizonYears }, () => ({ stock: 0.1, bond: 0.0, inflation: 0.025 }));
    const res = runPath(buildContext(inp), path);
    const working = res.years.find((y) => y.year === 2027)!; // spouse B still working
    const bridge = res.years.find((y) => y.year === 2035)!; // fully retired, spouse A 44
    const late = res.years.find((y) => y.ageA === 61)!;
    expect(working.grossReturn).toBeCloseTo(0.9 * 0.1, 10);
    expect(bridge.grossReturn).toBeCloseTo(0.4 * 0.1, 10);
    expect(late.grossReturn).toBeCloseTo(0.7 * 0.1, 10);
  });
});

describe("accounting identities", () => {
  it("net worth is conserved: only flows and growth change it", () => {
    const inp = inputs({ expectedRealReturn: 0, returnModel: "gaussian" });
    const res = run(inp, flatPath(inp.horizonYears, 0));
    // With 0% growth, ΔNW each year = savings + contributions − withdrawals...
    // weaker but useful invariant: NW never jumps by more than total flows could explain.
    for (let i = 1; i < res.years.length; i++) {
      const delta = Math.abs(res.years[i].netWorth - res.years[i - 1].netWorth);
      expect(delta).toBeLessThan(400_000);
    }
  });

  it("accessible never exceeds net worth", () => {
    const res = run(inputs());
    for (const y of res.years) {
      expect(y.accessible).toBeLessThanOrEqual(y.netWorth + 0.01);
    }
  });
});

describe("who is older is read from the ages, not the labels", () => {
  // Mirror image of the default household: same people, A and B swapped.
  const base = inputs({ retireYearA: 2030, retireYearB: 2030 });
  const d = DEFAULT_INPUTS;
  const swapped = inputs({
    retireYearA: 2030,
    retireYearB: 2030,
    startAgeA: d.startAgeB,
    startAgeB: d.startAgeA,
    netIncomeA: d.netIncomeB,
    netIncomeB: d.netIncomeA,
    contribTradA: d.contribTradB,
    contribRothA: d.contribRothB,
    contribTradB: d.contribTradA,
    contribRothB: d.contribRothA,
    ssA: d.ssB,
    ssB: d.ssA,
    pensionOwner: "B",
    balances: {
      ...d.balances,
      rothBasisA: d.balances.rothBasisB,
      tradA: d.balances.tradB,
      rothBasisB: d.balances.rothBasisA,
      tradB: d.balances.tradA,
    },
  });

  it("swapping which spouse is A gives the same household result", () => {
    const a = runPath(buildContext(base), deterministicPath(base));
    const b = runPath(buildContext(swapped), deterministicPath(swapped));
    expect(b.classification).toBe(a.classification);
    expect(b.endingNetWorth).toBeCloseTo(a.endingNetWorth, 0);
    for (let t = 0; t < a.years.length; t++) {
      expect(b.years[t].accessible).toBeCloseTo(a.years[t].accessible, 0);
      expect(b.years[t].taxesPaid).toBeCloseTo(a.years[t].taxesPaid, 0);
    }
  });

  it("the pension follows its owner's age", () => {
    const res = runPath(buildContext(swapped), deterministicPath(swapped));
    const before = res.years.find((y) => y.ageB === d.pensionStartAge - 1)!;
    const at = res.years.find((y) => y.ageB === d.pensionStartAge)!;
    expect(before.pensionIncome).toBe(0);
    expect(at.pensionIncome).toBeGreaterThan(0);
  });
});

describe("household size and state tax inputs", () => {
  const retired = inputs({ retireYearA: 2026, retireYearB: 2026, conversionMode: "off" });

  it("a no-income-tax state lowers taxes", () => {
    const oh = runPath(buildContext(retired), deterministicPath(retired));
    const none = { ...retired, stateTaxRate: 0 };
    const nt = runPath(buildContext(none), deterministicPath(none));
    const sum = (r: typeof oh) => r.years.reduce((s, y) => s + y.taxesPaid, 0);
    expect(sum(nt)).toBeLessThan(sum(oh));
  });

  it("a smaller household has a lower poverty line → less ACA subsidy", () => {
    const four = runPath(buildContext(retired), deterministicPath(retired));
    const two = { ...retired, householdSize: 2 };
    const tw = runPath(buildContext(two), deterministicPath(two));
    const aca = (r: typeof four) => r.years.reduce((s, y) => s + y.healthcare, 0);
    expect(aca(tw)).toBeGreaterThanOrEqual(aca(four));
  });
});
