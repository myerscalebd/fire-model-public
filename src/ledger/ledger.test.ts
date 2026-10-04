import { describe, expect, it } from "vitest";
import {
  defaultAccountName,
  detectColumns,
  importCsv,
  mergeTxns,
  parseAmount,
  parseDate,
} from "./bankImport";
import { categorize, DEFAULT_CATEGORIES, type Category } from "./categorize";
import { parseCsv } from "./csv";
import { fireSummary, monthly, yearly } from "./summarize";

describe("csv", () => {
  it("handles quoted commas, escaped quotes, CRLF, BOM and blank lines", () => {
    const rows = parseCsv('﻿a,b\r\n"x, y","say ""hi"""\r\n\r\n1,2');
    expect(rows).toEqual([
      ["a", "b"],
      ["x, y", 'say "hi"'],
      ["1", "2"],
    ]);
  });
});

describe("parsing values", () => {
  it("dates in common bank formats", () => {
    expect(parseDate("2026-03-05")).toBe("2026-03-05");
    expect(parseDate("03/05/2026")).toBe("2026-03-05");
    expect(parseDate("3/5/26")).toBe("2026-03-05");
    expect(parseDate("Pending")).toBeNull();
  });

  it("amounts with $, commas, signs and accounting parens", () => {
    expect(parseAmount("$1,234.56")).toBe(1234.56);
    expect(parseAmount("-12.00")).toBe(-12);
    expect(parseAmount("$-12")).toBe(-12);
    expect(parseAmount("(45.10)")).toBe(-45.1);
    expect(parseAmount("")).toBeNull();
    expect(parseAmount("n/a")).toBeNull();
  });

  it("export date is stripped from the default account name", () => {
    expect(defaultAccountName("Chase1234_Activity_20260930.CSV")).toBe("Chase1234_Activity");
    expect(defaultAccountName("checking.csv")).toBe("checking");
  });
});

describe("column detection", () => {
  it("single signed amount (Chase-style card)", () => {
    expect(detectColumns(["Transaction Date", "Post Date", "Description", "Category", "Type", "Amount", "Memo"]))
      .toEqual({ date: 0, description: 2, amount: 5 });
  });

  it("separate debit/credit columns (credit-union style)", () => {
    expect(detectColumns(["Date", "Description", "Debit", "Credit", "Balance"]))
      .toEqual({ date: 0, description: 1, debit: 2, credit: 3 });
  });

  it("'Debit Amount' is a debit column, not the amount column", () => {
    const m = detectColumns(["Posting Date", "Payee", "Debit Amount", "Credit Amount"]);
    expect(m).toEqual({ date: 0, description: 1, debit: 2, credit: 3 });
  });

  it("rejects a row that isn't a header", () => {
    expect(detectColumns(["Account summary", "", ""])).toBeNull();
  });
});

describe("import", () => {
  const card = [
    "Transaction Date,Description,Amount",
    "09/01/2026,KROGER #123,-85.20",
    "09/02/2026,STARBUCKS,-5.00",
    "09/02/2026,STARBUCKS,-5.00",
    "09/10/2026,PAYMENT THANK YOU,500.00",
  ].join("\n");

  it("normalizes rows and keeps genuine same-day duplicates", () => {
    const r = importCsv(card, "Card");
    expect(r.error).toBeUndefined();
    expect(r.txns).toHaveLength(4);
    expect(r.txns[0]).toMatchObject({ date: "2026-09-01", description: "KROGER #123", amount: -85.2 });
    expect(new Set(r.txns.map((t) => t.id)).size).toBe(4); // both coffees survive
  });

  it("finds the header after bank preamble lines", () => {
    const r = importCsv("Account: x1234\nExported 2026-09-30\n" + card, "Card");
    expect(r.txns).toHaveLength(4);
  });

  it("debit/credit layout becomes signed amounts", () => {
    const r = importCsv("Date,Description,Debit,Credit\n09/01/2026,RENT,1200.00,\n09/15/2026,PAYROLL,,3000.00", "Chk");
    expect(r.txns.map((t) => t.amount)).toEqual([-1200, 3000]);
  });

  it("flipSign handles cards that export charges as positive", () => {
    const r = importCsv("Date,Description,Amount\n09/01/2026,TARGET,42.00", "Amex", true);
    expect(r.txns[0].amount).toBe(-42);
  });

  it("re-importing an overlapping export adds nothing new", () => {
    const first = importCsv(card, "Card").txns;
    const again = mergeTxns(first, importCsv(card, "Card").txns);
    expect(again.added).toBe(0);
    expect(again.txns).toHaveLength(4);
  });

  it("reports a file it can't read instead of guessing", () => {
    const r = importCsv("foo,bar\n1,2", "X");
    expect(r.error).toBeDefined();
    expect(r.txns).toHaveLength(0);
  });
});

describe("categorize", () => {
  const t = (description: string, amount: number, id = description) =>
    ({ id, account: "A", date: "2026-09-01", description, amount });

  it("keyword rules, then the in/out fallback", () => {
    expect(categorize(t("PAYMENT THANK YOU", 500), DEFAULT_CATEGORIES, {}).name).toBe("Transfer");
    expect(categorize(t("ACME CORP PAYROLL", 4000), DEFAULT_CATEGORIES, {}).name).toBe("Income");
    expect(categorize(t("ST MARY SCHOOL TUITION", -900), DEFAULT_CATEGORIES, {}).name).toBe("School");
    expect(categorize(t("KROGER", -50), DEFAULT_CATEGORIES, {}).name).toBe("Spending");
    expect(categorize(t("VENMO CASHOUT", 50), DEFAULT_CATEGORIES, {}).name).toBe("Income");
  });

  it("a manual override beats the rules", () => {
    expect(categorize(t("KROGER", -50, "k1"), DEFAULT_CATEGORIES, { k1: "School" }).name).toBe("School");
  });

  it("user-added keywords (e.g. a mortgage servicer) are matched case-insensitively", () => {
    const cats: Category[] = DEFAULT_CATEGORIES.map((c) =>
      c.name === "Mortgage" ? { ...c, keywords: [...c.keywords, "Acme Servicing"] } : c,
    );
    expect(categorize(t("ACME SERVICING LLC", -2400), cats, {}).name).toBe("Mortgage");
  });
});

describe("summaries", () => {
  const txns = [
    { id: "1", account: "A", date: "2026-07-01", description: "PAYROLL", amount: 8000 },
    { id: "2", account: "A", date: "2026-07-03", description: "MORTGAGE", amount: -2400 },
    { id: "3", account: "A", date: "2026-07-05", description: "KROGER", amount: -600 },
    { id: "4", account: "A", date: "2026-07-06", description: "TUITION", amount: -1000 },
    { id: "5", account: "A", date: "2026-07-20", description: "PAYMENT THANK YOU", amount: -900 },
    { id: "6", account: "A", date: "2026-07-21", description: "KROGER REFUND", amount: 100 },
    { id: "7", account: "A", date: "2026-08-01", description: "PAYROLL", amount: 8000 },
    { id: "8", account: "A", date: "2026-08-05", description: "KROGER", amount: -400 },
    { id: "9", account: "A", date: "2026-09-02", description: "KROGER", amount: -999 }, // current month
  ];
  // The refund is unmatched money in → counts as income (keep rules simple;
  // add a rule or override if you want refunds netted against spending).
  const rows = monthly(txns, DEFAULT_CATEGORIES, {});

  it("monthly in/out/net with transfers excluded", () => {
    const jul = rows.find((r) => r.month === "2026-07")!;
    expect(jul.income).toBe(8100);
    expect(jul.out).toBe(4000); // 2400 + 600 + 1000; the 900 card payment is a transfer
    expect(jul.net).toBe(4100);
    expect(jul.transfers).toBe(900);
    expect(jul.byCategory).toEqual({ Mortgage: 2400, Spending: 600, School: 1000 });
  });

  it("an override that puts money-in into an expense bucket nets it as a refund", () => {
    const r = monthly(txns, DEFAULT_CATEGORIES, { "6": "Spending" }).find((m) => m.month === "2026-07")!;
    expect(r.byCategory.Spending).toBe(500);
    expect(r.income).toBe(8000);
  });

  it("yearly totals", () => {
    const y = yearly(rows);
    expect(y).toHaveLength(1);
    expect(y[0].months).toBe(3);
    expect(y[0].out).toBe(4000 + 400 + 999);
  });

  it("FIRE split excludes the current month and annualizes partial data", () => {
    const s = fireSummary(rows, DEFAULT_CATEGORIES, new Date(2026, 8, 15)); // Sep 15, 2026
    expect(s.monthsUsed).toBe(2); // Jul + Aug; Sep is incomplete
    expect(s.from).toBe("2026-07");
    expect(s.to).toBe("2026-08");
    // 2 months annualized ×6: core (600+400)=1000 → 6000; housing 2400 → 14400; school 1000 → 6000
    expect(s.byRole.core).toBeCloseTo(6000, 6);
    expect(s.byRole.housing).toBeCloseTo(14400, 6);
    expect(s.byRole.childcare).toBeCloseTo(6000, 6);
    expect(s.annualIncome).toBeCloseTo((8100 + 8000) * 6, 6);
  });

  it("uses at most the last 12 complete months", () => {
    const many = Array.from({ length: 18 }, (_, i) => {
      const d = new Date(2025, i, 10);
      const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-10`;
      return { id: `m${i}`, account: "A", date: iso, description: "KROGER", amount: -100 };
    });
    const s = fireSummary(monthly(many, DEFAULT_CATEGORIES, {}), DEFAULT_CATEGORIES, new Date(2026, 9, 1));
    expect(s.monthsUsed).toBe(12);
    expect(s.byRole.core).toBeCloseTo(1200, 6);
  });
});
