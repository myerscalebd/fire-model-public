import { describe, expect, it } from "vitest";
import { amortize, monthlySplit } from "./mortgage";
import { DEFAULT_INPUTS as D } from "../data/assumptions";

const BASE = {
  balance: D.mortgageBalance0,
  annualRate: D.mortgageRate,
  monthlyPI: D.mortgageMonthlyPI,
  monthsInFirstYear: 7,
  horizonYears: 50,
};

describe("mortgage amortization (example $400k @ 6% 30-yr loan)", () => {
  it("first-month P/I split matches the closed-form amortization", () => {
    const { interest, principal } = monthlySplit(D.mortgageBalance0, D.mortgageRate, D.mortgageMonthlyPI);
    // $400k @ 6%: first-month interest = 400000·0.005 = $2,000; principal = P&I − interest.
    expect(Math.abs(interest - 2000)).toBeLessThan(2);
    expect(Math.abs(principal - 398)).toBeLessThan(2);
  });

  it("pays off and total principal equals the starting balance", () => {
    const s = amortize({ ...BASE, extraMonthly: 0 });
    expect(s.payoffT).not.toBeNull();
    const totalPrincipal = s.rows.reduce(
      (a, r) => a + (r.piPaid - r.interestPaid) + r.extraPaid,
      0,
    );
    expect(totalPrincipal).toBeCloseTo(D.mortgageBalance0, 0);
    expect(s.rows[s.payoffT!].endBalance).toBe(0);
  });

  it("prepay shortens payoff and reduces total interest", () => {
    const noExtra = amortize({ ...BASE, extraMonthly: 0 });
    const withExtra = amortize({ ...BASE, extraMonthly: 1000 });
    expect(withExtra.payoffMonths!).toBeLessThan(noExtra.payoffMonths!);
    expect(withExtra.totalInterest).toBeLessThan(noExtra.totalInterest);
  });

  it("a standard 30-yr loan clears in ~30 years; the $1k/mo prepay clears it well sooner", () => {
    const noExtra = amortize({ ...BASE, extraMonthly: 0 });
    const withExtra = amortize({ ...BASE, extraMonthly: 1000 });
    expect(noExtra.payoffMonths).toBeGreaterThan(340);
    expect(noExtra.payoffMonths).toBeLessThanOrEqual(362);
    expect(withExtra.payoffMonths).toBeLessThan(260);
  });

  it("balance never increases", () => {
    const s = amortize({ ...BASE, extraMonthly: 1000 });
    for (let i = 1; i < s.rows.length; i++) {
      expect(s.rows[i].endBalance).toBeLessThanOrEqual(s.rows[i - 1].endBalance);
    }
  });
});
