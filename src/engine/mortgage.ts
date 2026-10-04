/**
 * Real amortization from the actual statement figures (nominal dollars).
 * The simulation deflates the nominal P&I into real dollars per year;
 * escrow is handled separately in the simulation (it never ends).
 */

export interface AmortYearRow {
  /** Year index (t=0 = the partial first year starting June). */
  t: number;
  /** Regular P&I actually paid this year (nominal $). */
  piPaid: number;
  /** Extra principal paid this year (nominal $). */
  extraPaid: number;
  interestPaid: number;
  endBalance: number;
}

export interface AmortSchedule {
  rows: AmortYearRow[];
  /** Year index in which the balance hits zero, or null if never within horizon. */
  payoffT: number | null;
  /** Total months of payments made. */
  payoffMonths: number | null;
  totalInterest: number;
}

export interface AmortInputs {
  balance: number;
  annualRate: number;
  monthlyPI: number;
  extraMonthly: number;
  /** Months of payments in year 0 (June start → 7). */
  monthsInFirstYear: number;
  horizonYears: number;
}

/** Split of a single month's regular payment at a given balance. */
export function monthlySplit(balance: number, annualRate: number, monthlyPI: number) {
  const interest = (balance * annualRate) / 12;
  return { interest, principal: monthlyPI - interest };
}

export function amortize(inp: AmortInputs): AmortSchedule {
  const r = inp.annualRate / 12;
  let bal = inp.balance;
  let monthsPaid = 0;
  let totalInterest = 0;
  let payoffT: number | null = null;
  let payoffMonths: number | null = null;

  const rows: AmortYearRow[] = [];
  for (let t = 0; t < inp.horizonYears; t++) {
    const months = t === 0 ? inp.monthsInFirstYear : 12;
    const row: AmortYearRow = { t, piPaid: 0, extraPaid: 0, interestPaid: 0, endBalance: bal };
    for (let m = 0; m < months && bal > 0.005; m++) {
      const interest = bal * r;
      // Final payment is capped at what's owed.
      const payment = Math.min(inp.monthlyPI, bal + interest);
      let principal = payment - interest;
      bal -= principal;
      const extra = Math.min(inp.extraMonthly, bal);
      bal -= extra;
      monthsPaid++;
      totalInterest += interest;
      row.piPaid += payment;
      row.extraPaid += extra;
      row.interestPaid += interest;
      if (bal <= 0.005) {
        bal = 0;
        payoffT = t;
        payoffMonths = monthsPaid;
      }
    }
    row.endBalance = bal;
    rows.push(row);
  }
  return { rows, payoffT, payoffMonths, totalInterest };
}
