import type { Txn } from "./bankImport";
import { categorize, type Category, type Role } from "./categorize";

export interface MonthRow {
  /** YYYY-MM */
  month: string;
  income: number;
  /** Total spending (refunds reduce it). Transfers excluded. */
  out: number;
  net: number;
  /** Spending per expense bucket (positive = money out). */
  byCategory: Record<string, number>;
  transfers: number;
  count: number;
}

/** Roll transactions up into calendar months. */
export function monthly(txns: Txn[], cats: Category[], overrides: Record<string, string>): MonthRow[] {
  const map = new Map<string, MonthRow>();
  for (const t of txns) {
    const month = t.date.slice(0, 7);
    let row = map.get(month);
    if (!row) {
      row = { month, income: 0, out: 0, net: 0, byCategory: {}, transfers: 0, count: 0 };
      map.set(month, row);
    }
    row.count++;
    const c = categorize(t, cats, overrides);
    if (c.role === "transfer") {
      row.transfers += Math.abs(t.amount);
      continue;
    }
    if (c.role === "income") {
      row.income += t.amount;
      continue;
    }
    // Expense bucket: money out counts as spend; money in (a refund) offsets it.
    const spend = -t.amount;
    row.out += spend;
    row.byCategory[c.name] = (row.byCategory[c.name] ?? 0) + spend;
  }
  const rows = [...map.values()].sort((a, b) => a.month.localeCompare(b.month));
  for (const r of rows) r.net = r.income - r.out;
  return rows;
}

export interface YearRow {
  year: string;
  income: number;
  out: number;
  net: number;
  months: number;
  byCategory: Record<string, number>;
}

export function yearly(rows: MonthRow[]): YearRow[] {
  const map = new Map<string, YearRow>();
  for (const r of rows) {
    const year = r.month.slice(0, 4);
    let y = map.get(year);
    if (!y) {
      y = { year, income: 0, out: 0, net: 0, months: 0, byCategory: {} };
      map.set(year, y);
    }
    y.income += r.income;
    y.out += r.out;
    y.net += r.net;
    y.months++;
    for (const [k, v] of Object.entries(r.byCategory)) y.byCategory[k] = (y.byCategory[k] ?? 0) + v;
  }
  return [...map.values()].sort((a, b) => a.year.localeCompare(b.year));
}

type SpendRole = Exclude<Role, "income" | "transfer">;

export interface FireSummary {
  /** Complete months used (up to 12, most recent first excluded if it's this month). */
  monthsUsed: number;
  from: string | null;
  to: string | null;
  annualIncome: number;
  annualOut: number;
  /** Annualized spend split the way the FIRE model wants it. */
  byRole: Record<SpendRole, number>;
}

/**
 * Trailing-12-month spend, annualized if there's less than a year of data.
 * The current calendar month is excluded as incomplete.
 */
export function fireSummary(rows: MonthRow[], cats: Category[], today: Date): FireSummary {
  const current = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}`;
  const used = rows.filter((r) => r.month < current).slice(-12);
  const n = used.length;
  const scale = n ? 12 / n : 0;
  const roleOf = (name: string): Role => cats.find((c) => c.name === name)?.role ?? "core";

  let income = 0;
  let out = 0;
  const byRole: Record<SpendRole, number> = { core: 0, housing: 0, childcare: 0 };
  for (const r of used) {
    income += r.income;
    out += r.out;
    for (const [name, v] of Object.entries(r.byCategory)) {
      const role = roleOf(name);
      byRole[role === "housing" || role === "childcare" ? role : "core"] += v;
    }
  }
  return {
    monthsUsed: n,
    from: used[0]?.month ?? null,
    to: used[n - 1]?.month ?? null,
    annualIncome: income * scale,
    annualOut: out * scale,
    byRole: {
      core: byRole.core * scale,
      housing: byRole.housing * scale,
      childcare: byRole.childcare * scale,
    },
  };
}
