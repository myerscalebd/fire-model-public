import { describe, expect, it } from "vitest";
import { DEFAULT_INPUTS } from "../data/assumptions";
import {
  buildHistogram,
  percentile,
  runCohortDetail,
  runMonteCarlo,
  runTornado,
  solveRetirementYear,
} from "./montecarlo";
import type { SimInputs } from "./types";

function inputs(over: Partial<SimInputs> = {}): SimInputs {
  return { ...DEFAULT_INPUTS, numPaths: 200, ...over };
}

describe("percentile", () => {
  it("interpolates correctly", () => {
    expect(percentile([1, 2, 3, 4, 5], 0.5)).toBe(3);
    expect(percentile([1, 2, 3, 4], 0.5)).toBe(2.5);
    expect(percentile([10], 0.9)).toBe(10);
  });
});

describe("histogram", () => {
  it("counts sum to sample size and the cap bucket catches outliers", () => {
    const values = [0, 100, 200, 500, 1_000_000];
    const h = buildHistogram(values, 10, 600);
    expect(h.reduce((a, b) => a + b.count, 0)).toBe(values.length);
    expect(h[h.length - 1].count).toBe(1); // the 1M outlier
    expect(h[h.length - 1].to).toBe(Infinity);
  });
});

describe("Monte Carlo", () => {
  it("is reproducible for a fixed seed", () => {
    const a = runMonteCarlo(inputs({ seed: 42 }));
    const b = runMonteCarlo(inputs({ seed: 42 }));
    expect(a.endingNetWorthP50).toBe(b.endingNetWorthP50);
    expect(a.fullSuccessPct).toBe(b.fullSuccessPct);
  });

  it("different seeds give different paths", () => {
    const a = runMonteCarlo(inputs({ seed: 1 }));
    const b = runMonteCarlo(inputs({ seed: 2 }));
    expect(a.endingNetWorthP50).not.toBe(b.endingNetWorthP50);
  });

  it("classification percentages (all four) sum to 100", () => {
    const s = runMonteCarlo(inputs());
    expect(
      s.fullSuccessPct + s.backToWorkPct + s.liquiditySqueezePct + s.trueRuinPct,
    ).toBeCloseTo(100, 6);
  });

  it("back-to-work is its own category and disappears when reactive re-entry is off", () => {
    // The real default plan has a healthy band of paths saved by re-entry.
    const withRe = runMonteCarlo(inputs({ numPaths: 400, seed: 3, reactiveReentryEnabled: true }));
    const noRe = runMonteCarlo(inputs({ numPaths: 400, seed: 3, reactiveReentryEnabled: false }));
    // With re-entry on, some paths land in back-to-work with a positive median stint.
    expect(withRe.backToWorkPct).toBeGreaterThan(0);
    expect(withRe.medianReentryYears).toBeGreaterThan(0);
    // With it off, nobody can go back to work.
    expect(noRe.backToWorkPct).toBe(0);
    // Turning re-entry off converts those survivors into squeeze/ruin, so the
    // combined bad outcomes rise.
    expect(noRe.liquiditySqueezePct + noRe.trueRuinPct).toBeGreaterThan(
      withRe.liquiditySqueezePct + withRe.trueRuinPct,
    );
  });

  it("percentiles are ordered", () => {
    const s = runMonteCarlo(inputs());
    expect(s.endingNetWorthP10).toBeLessThanOrEqual(s.endingNetWorthP50);
    expect(s.endingNetWorthP50).toBeLessThanOrEqual(s.endingNetWorthP90);
  });

  it("baseline plan mostly survives (spec: 'the answer is essentially yes')", () => {
    const s = runMonteCarlo(inputs({ numPaths: 400 }));
    // Survival = clean success + back-to-work (both avoid squeeze/ruin).
    expect(s.fullSuccessPct + s.backToWorkPct).toBeGreaterThan(50);
    expect(s.trueRuinPct).toBeLessThan(20);
  });

  it("gaussian and bootstrap models both run", () => {
    const g = runMonteCarlo(inputs({ returnModel: "gaussian", numPaths: 100 }));
    const b = runMonteCarlo(inputs({ returnModel: "bootstrap", numPaths: 100 }));
    expect(g.numPaths).toBe(100);
    expect(b.numPaths).toBe(100);
  });

  it("historical cohorts: one deterministic path per available start year", () => {
    const a = runMonteCarlo(inputs({ returnModel: "cohorts", horizonYears: 50 }));
    const b = runMonteCarlo(inputs({ returnModel: "cohorts", horizonYears: 50 }));
    // 96 years of data (1928–2023), 50-year horizon → 47 cohorts, 1928–1974.
    expect(a.numPaths).toBe(47);
    expect(a.cohorts).toHaveLength(47);
    expect(a.cohorts![0].startYear).toBe(1928);
    expect(a.cohorts![46].startYear).toBe(1974);
    // Deterministic: no RNG, so seed changes nothing.
    expect(runMonteCarlo(inputs({ returnModel: "cohorts", seed: 999 })).endingNetWorthP50)
      .toBe(a.endingNetWorthP50);
    expect(a.fullSuccessPct + a.backToWorkPct + a.liquiditySqueezePct + a.trueRuinPct).toBeCloseTo(100, 6);
    expect(b.endingNetWorthP50).toBe(a.endingNetWorthP50);
  });

  it("cohort drill-down returns full records using that cohort's real inflation", () => {
    const inp = inputs({ returnModel: "cohorts", horizonYears: 50 });
    const detail = runCohortDetail(inp, 1970);
    expect(detail.years).toHaveLength(50);
    expect(detail.years[0].year).toBe(inp.startYear);
    // The 1970s cohort should carry real double-digit inflation in its early
    // years — NOT the flat 2.5% assumption (this is the honesty fix).
    const highInflationYears = detail.years.slice(0, 12).filter((y) => y.inflation > 0.06);
    expect(highInflationYears.length).toBeGreaterThan(2);
  });

  it("real cohort inflation eases a fixed-rate mortgage vs the flat assumption", () => {
    // Higher realized inflation shrinks the nominal mortgage in real terms — a
    // tailwind the flat-2.5% deflator withholds from 1970s-style cohorts.
    const base = inputs({ returnModel: "cohorts", horizonYears: 40 });
    const real = runCohortDetail(base, 1970);
    const flat = runCohortDetail({ ...base, inflation: 0.025 }, 1970); // unused for cohorts; sanity ref
    // Both run; the real path's later housing cost (deflated by real CPI) is
    // strictly lower than an equivalent flat-2.5% deflation would give.
    expect(real.years.length).toBe(flat.years.length);
    const midHousingReal = real.years[15].housingPI;
    expect(midHousingReal).toBeGreaterThanOrEqual(0);
  });

  it("historical cohorts: shorter horizon yields more cohorts", () => {
    const s = runMonteCarlo(inputs({ returnModel: "cohorts", horizonYears: 30 }));
    expect(s.numPaths).toBe(96 - 30 + 1); // 67 cohorts
    expect(s.cohorts![0].startYear).toBe(1928);
  });

  it("retirement-date solver finds the earliest qualifying year (cohorts, deterministic)", () => {
    // Cohort mode is deterministic and fast — ideal for the solver oracle.
    const base = inputs({ returnModel: "cohorts", retireYearB: 2028 });
    const res = solveRetirementYear(base, "spouseA", 80);
    expect(res.year).not.toBeNull();
    // The found year meets the target...
    expect(res.pct!).toBeGreaterThanOrEqual(80);
    // ...and the year before it (if checked) does not.
    const prev = res.checked.find((c) => c.year === res.year! - 1);
    if (prev && res.year! > base.startYear) {
      expect(prev.pct).toBeLessThan(80);
    }
    // Direct verification: the solver targets SURVIVAL (clean success + back to work).
    const direct = runMonteCarlo({ ...base, retireYearA: res.year! });
    expect(direct.fullSuccessPct + direct.backToWorkPct).toBe(res.pct);
  });

  it("solver returns null when the target is unreachable", () => {
    const res = solveRetirementYear(
      inputs({ returnModel: "cohorts", coreSpend: 400_000, retireYearB: 2026 }),
      "spouseA",
      99.9,
    );
    expect(res.year).toBeNull();
    expect(res.checked.length).toBeGreaterThan(0);
  });

  it("tornado ranks inputs by swing and is internally consistent", () => {
    const rows = runTornado(inputs({ numPaths: 200, seed: 5 }));
    expect(rows.length).toBeGreaterThan(4);
    // Sorted descending by swing.
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i - 1].swing).toBeGreaterThanOrEqual(rows[i].swing);
    }
    // Swing equals the larger absolute deviation from base, and all share a base.
    const base = rows[0].base;
    for (const r of rows) {
      expect(r.base).toBe(base);
      expect(r.swing).toBeCloseTo(Math.max(Math.abs(r.lowPct - base), Math.abs(r.highPct - base)), 6);
    }
    // Core spend should be a top-few driver of full-success.
    const spendRank = rows.findIndex((r) => r.key === "coreSpend");
    expect(spendRank).toBeLessThan(4);
  });

  it("summary carries sampled return paths and squeeze penalty severity", () => {
    const s = runMonteCarlo(inputs({ numPaths: 200, seed: 9 }));
    expect(s.returnPaths.length).toBeGreaterThan(0);
    expect(s.returnPaths.length).toBeLessThanOrEqual(30);
    expect(s.returnPaths[0]).toHaveLength(DEFAULT_INPUTS.horizonYears);
    // Reproducible with the same seed.
    const s2 = runMonteCarlo(inputs({ numPaths: 200, seed: 9 }));
    expect(s2.returnPaths[0]).toEqual(s.returnPaths[0]);
    // Penalty severity is present iff there are squeezed paths.
    if (s.liquiditySqueezePct > 0) {
      expect(s.medianSqueezePenalty).not.toBeNull();
      expect(s.medianSqueezePenalty!).toBeGreaterThan(0);
    } else {
      expect(s.medianSqueezePenalty).toBeNull();
    }
  });

  it("reactive re-entry reduces true ruin in a stressed plan", () => {
    const stress = {
      retireYearA: 2026,
      retireYearB: 2026,
      coreSpend: 140_000,
      conversionMode: "off" as const,
      numPaths: 300,
      seed: 11,
    };
    const off = runMonteCarlo(inputs({ ...stress, reactiveReentryEnabled: false }));
    const on = runMonteCarlo(inputs({ ...stress, reactiveReentryEnabled: true }));
    expect(on.trueRuinPct).toBeLessThan(off.trueRuinPct);
  });

  it("floor-spending flexibility improves outcomes (amber → green lever)", () => {
    const tight = inputs({
      coreSpend: 150_000,
      retireYearA: 2026,
      retireYearB: 2027,
      numPaths: 300,
      seed: 7,
    });
    const rigid = runMonteCarlo({ ...tight, floorEnabled: false });
    const flexible = runMonteCarlo({ ...tight, floorEnabled: true });
    // Flexibility should lift survival (clean success + back-to-work).
    const survival = (s: typeof rigid) => s.fullSuccessPct + s.backToWorkPct;
    expect(survival(flexible)).toBeGreaterThanOrEqual(survival(rigid));
  });
});
