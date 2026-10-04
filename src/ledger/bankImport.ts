import { parseCsv } from "./csv";

/** One bank/card transaction. amount > 0 = money in, < 0 = money out. */
export interface Txn {
  id: string;
  account: string;
  /** ISO YYYY-MM-DD. */
  date: string;
  description: string;
  amount: number;
}

/** Column indexes found in a bank export's header row. */
export interface ColumnMap {
  date: number;
  description: number;
  /** Single signed amount column… */
  amount?: number;
  /** …or separate unsigned debit / credit columns. */
  debit?: number;
  credit?: number;
}

const DEBIT_NAMES = ["debit", "debits", "debit amount", "withdrawal", "withdrawals", "outflow", "money out"];
const CREDIT_NAMES = ["credit", "credits", "credit amount", "deposit", "deposits", "inflow", "money in"];

/** Recognize the common US bank/card export layouts from a header row. */
export function detectColumns(header: string[]): ColumnMap | null {
  const h = header.map((x) => x.trim().toLowerCase());
  const find = (pred: (x: string) => boolean) => h.findIndex(pred);

  let date = find((x) => x.includes("transaction date") || x === "trans. date" || x === "trans date");
  if (date < 0) date = find((x) => x === "date" || x.includes("date"));

  let description = find((x) =>
    ["description", "payee", "name", "merchant", "transaction description", "details"].includes(x),
  );
  if (description < 0) description = find((x) => x.includes("description") || x.includes("payee") || x.includes("merchant"));
  if (description < 0) description = find((x) => x.includes("memo"));

  const amount = find(
    (x) =>
      x === "amount" ||
      (x.includes("amount") && !x.includes("balance") && !x.includes("debit") && !x.includes("credit")),
  );
  const debit = find((x) => DEBIT_NAMES.includes(x));
  const credit = find((x) => CREDIT_NAMES.includes(x));

  if (date < 0 || description < 0) return null;
  if (amount >= 0) return { date, description, amount };
  if (debit >= 0 || credit >= 0) {
    return {
      date,
      description,
      debit: debit >= 0 ? debit : undefined,
      credit: credit >= 0 ? credit : undefined,
    };
  }
  return null;
}

const pad = (n: number) => String(n).padStart(2, "0");

/** Accepts YYYY-MM-DD, MM/DD/YYYY and M/D/YY. Returns ISO or null. */
export function parseDate(raw: string): string | null {
  const s = raw.trim();
  let y: number, mo: number, d: number;
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) {
    [y, mo, d] = [+m[1], +m[2], +m[3]];
  } else {
    m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
    if (!m) return null;
    [mo, d, y] = [+m[1], +m[2], +m[3]];
    if (y < 100) y += 2000;
  }
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return `${y}-${pad(mo)}-${pad(d)}`;
}

/** Accepts "$1,234.56", "-12.00", "$-12", "(12.00)" (accounting negative). */
export function parseAmount(raw: string): number | null {
  let s = raw.trim();
  if (!s) return null;
  let neg = false;
  if (/^\(.*\)$/.test(s)) {
    neg = true;
    s = s.slice(1, -1);
  }
  s = s.replace(/[$,\s]/g, "");
  if (s.startsWith("-")) {
    neg = !neg;
    s = s.slice(1);
  } else if (s.startsWith("+")) {
    s = s.slice(1);
  }
  if (!/^\d*\.?\d+$/.test(s)) return null;
  const v = parseFloat(s);
  return neg ? -v : v;
}

export interface ImportResult {
  txns: Txn[];
  /** Rows that couldn't be read (summary lines, blank amounts, etc.). */
  skipped: number;
  /** Share of rows that are inflows — near 1 suggests a card that exports charges as positive. */
  positiveShare: number;
  error?: string;
}

/**
 * Parse a bank/card CSV export. Finds the header row (some banks put a few
 * preamble lines first), maps the columns, and normalizes every row to a Txn.
 *
 * IDs are deterministic (account + date + amount + description + occurrence
 * within the file), so re-importing an overlapping export doesn't double count,
 * while two genuinely identical purchases on the same day both survive.
 */
export function importCsv(text: string, account: string, flipSign = false): ImportResult {
  const rows = parseCsv(text);
  let headerIdx = -1;
  let map: ColumnMap | null = null;
  for (let i = 0; i < Math.min(rows.length, 15); i++) {
    map = detectColumns(rows[i]);
    if (map) {
      headerIdx = i;
      break;
    }
  }
  if (!map) {
    return {
      txns: [],
      skipped: rows.length,
      positiveShare: 0,
      error: "couldn't find Date / Description / Amount columns in this file.",
    };
  }

  const seen = new Map<string, number>();
  const txns: Txn[] = [];
  let skipped = 0;
  for (const r of rows.slice(headerIdx + 1)) {
    const date = parseDate(r[map.date] ?? "");
    const description = (r[map.description] ?? "").trim().replace(/\s+/g, " ");
    let amount: number | null;
    if (map.amount !== undefined) {
      amount = parseAmount(r[map.amount] ?? "");
    } else {
      const d = map.debit !== undefined ? parseAmount(r[map.debit] ?? "") : null;
      const c = map.credit !== undefined ? parseAmount(r[map.credit] ?? "") : null;
      amount = d === null && c === null ? null : Math.abs(c ?? 0) - Math.abs(d ?? 0);
    }
    if (!date || amount === null || !description) {
      skipped++;
      continue;
    }
    if (flipSign) amount = -amount;
    amount = Math.round(amount * 100) / 100;

    const key = `${account}|${date}|${amount.toFixed(2)}|${description.toLowerCase()}`;
    const n = seen.get(key) ?? 0;
    seen.set(key, n + 1);
    txns.push({ id: `${key}|${n}`, account, date, description, amount });
  }

  const positives = txns.filter((t) => t.amount > 0).length;
  return { txns, skipped, positiveShare: txns.length ? positives / txns.length : 0 };
}

/** Add new transactions, skipping any already present (by id). */
export function mergeTxns(existing: Txn[], incoming: Txn[]): { txns: Txn[]; added: number } {
  const ids = new Set(existing.map((t) => t.id));
  const fresh = incoming.filter((t) => !ids.has(t.id));
  const txns = [...existing, ...fresh].sort((a, b) => a.date.localeCompare(b.date));
  return { txns, added: fresh.length };
}

/** "Chase1234_Activity_20260930.CSV" → "Chase1234_Activity" — strip the export date. */
export function defaultAccountName(fileName: string): string {
  return (
    fileName
      .replace(/\.csv$/i, "")
      .replace(/[_\-\s]*\d{6,8}.*$/, "")
      .trim() || "Account"
  );
}
