import { describe, expect, it } from "vitest";
import { acaNetPremium } from "./aca";
import { FPL_FAMILY_OF_4 } from "../data/taxTables";

const GROSS = 25_000;

describe("ACA subsidy model", () => {
  it("Medicaid below ~138% FPL → $0 premium", () => {
    expect(acaNetPremium(FPL_FAMILY_OF_4 * 1.2, GROSS)).toBe(0);
  });
  it("full gross premium above the 400% FPL cliff", () => {
    expect(acaNetPremium(FPL_FAMILY_OF_4 * 4.01, GROSS)).toBe(GROSS);
  });
  it("expected contribution ≈ 6.5% of MAGI at 200% FPL", () => {
    const magi = FPL_FAMILY_OF_4 * 2;
    expect(acaNetPremium(magi, GROSS)).toBeCloseTo(0.065 * magi, 0);
  });
  it("premium rises with MAGI inside the subsidy range", () => {
    const lo = acaNetPremium(FPL_FAMILY_OF_4 * 1.8, GROSS);
    const hi = acaNetPremium(FPL_FAMILY_OF_4 * 3.5, GROSS);
    expect(hi).toBeGreaterThan(lo);
    expect(hi).toBeLessThan(GROSS);
  });
  it("never exceeds the gross premium", () => {
    expect(acaNetPremium(500_000, 10_000)).toBe(10_000);
  });
});
