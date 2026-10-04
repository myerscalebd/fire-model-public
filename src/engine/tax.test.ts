import { describe, expect, it } from "vitest";
import { computeAnnualTax, ltcgTaxStacked, taxFromBrackets } from "./tax";
import { FED_ORDINARY_MFJ } from "../data/taxTables";

describe("federal ordinary brackets", () => {
  it("zero income → zero tax", () => {
    expect(taxFromBrackets(0, FED_ORDINARY_MFJ)).toBe(0);
  });
  it("fills the 10% bracket exactly", () => {
    expect(taxFromBrackets(23_850, FED_ORDINARY_MFJ)).toBeCloseTo(2_385, 5);
  });
  it("fills through the 12% bracket", () => {
    // 2,385 + (96,950 − 23,850) × 12% = 11,157
    expect(taxFromBrackets(96_950, FED_ORDINARY_MFJ)).toBeCloseTo(11_157, 5);
  });
});

describe("LTCG stacking", () => {
  it("0% bracket: gains fully inside the threshold are untaxed", () => {
    expect(ltcgTaxStacked(0, 90_000)).toBe(0);
  });
  it("gains straddling the 0%/15% edge are taxed only above it", () => {
    // Ordinary 90k taxable: 6,700 of room at 0%, remaining 13,300 at 15%.
    expect(ltcgTaxStacked(90_000, 20_000)).toBeCloseTo(13_300 * 0.15, 5);
  });
});

describe("computeAnnualTax", () => {
  it("bridge-year case: modest gains only → $0 federal (0% LTCG), small state tax", () => {
    const r = computeAnnualTax({ ordinaryIncome: 0, ltcg: 90_000, ssGross: 0 });
    expect(r.federal).toBe(0);
    expect(r.state).toBeCloseTo(0.0275 * (90_000 - 26_050), 2);
  });
  it("ordinary income case (e.g. conversions)", () => {
    const r = computeAnnualTax({ ordinaryIncome: 100_000, ltcg: 0, ssGross: 0 });
    // Taxable = 68,500 → 2,385 + 44,650 × 12% = 7,743
    expect(r.federal).toBeCloseTo(7_743, 0);
    expect(r.fedTaxableOrdinary).toBeCloseTo(68_500, 5);
  });
  it("MAGI counts full SS and gains", () => {
    const r = computeAnnualTax({ ordinaryIncome: 40_000, ltcg: 10_000, ssGross: 50_000 });
    expect(r.magi).toBe(100_000);
  });
  it("state tax exempts SS", () => {
    const withSS = computeAnnualTax({ ordinaryIncome: 50_000, ltcg: 0, ssGross: 50_000 });
    const withoutSS = computeAnnualTax({ ordinaryIncome: 50_000, ltcg: 0, ssGross: 0 });
    expect(withSS.state).toBeCloseTo(withoutSS.state, 5);
  });
});

describe("state tax", () => {
  it("defaults to the flat-rate state; rate 0 removes it", () => {
    const base = { ordinaryIncome: 100_000, ltcg: 0, ssGross: 0 };
    expect(computeAnnualTax(base).state).toBeGreaterThan(0);
    expect(computeAnnualTax({ ...base, stateRate: 0 }).state).toBe(0);
    expect(computeAnnualTax({ ...base, stateRate: 0.05, stateExemption: 0 }).state).toBeCloseTo(5_000, 5);
  });
});
