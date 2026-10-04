import type { Txn } from "./bankImport";

/**
 * What a bucket means to the totals and to the FIRE model:
 * - income:    money in (paychecks, interest)
 * - transfer:  moves between your own accounts / card payments — excluded,
 *              otherwise paying a card counts the same spending twice
 * - core:      everyday spending → the model's "core spend"
 * - housing:   mortgage / rent → modeled separately by the mortgage engine
 * - childcare: school / daycare → the model's separate childcare line
 */
export type Role = "income" | "transfer" | "core" | "housing" | "childcare";

export interface Category {
  name: string;
  role: Role;
  /** Case-insensitive substrings matched against the description. */
  keywords: string[];
}

export const ROLE_LABEL: Record<Role, string> = {
  income: "Income",
  transfer: "Transfer (excluded)",
  core: "Spending",
  housing: "Housing",
  childcare: "School / childcare",
};

/**
 * Deliberately few, generic buckets. Rules are checked top to bottom; the
 * first keyword hit wins. Anything unmatched falls back to Income (money in)
 * or Spending (money out). Add your own servicer / school names in the UI.
 */
export const DEFAULT_CATEGORIES: Category[] = [
  {
    name: "Transfer",
    role: "transfer",
    keywords: [
      "transfer",
      "payment thank you",
      "autopay",
      "card payment",
      "crd pmt",
      "credit card",
      "online payment",
      "epay",
      "to savings",
      "from savings",
    ],
  },
  { name: "Income", role: "income", keywords: ["payroll", "direct dep", "dir dep", "salary", "dividend", "interest paid"] },
  { name: "Mortgage", role: "housing", keywords: ["mortgage", "mtg pmt", "home loan"] },
  { name: "School", role: "childcare", keywords: ["tuition", "school", "daycare", "childcare", "preschool"] },
  { name: "Spending", role: "core", keywords: [] },
];

function fallback(cats: Category[], role: Role): Category {
  return (
    cats.find((c) => c.role === role && !c.keywords.some((k) => k.trim())) ??
    cats.find((c) => c.role === role) ?? {
      name: role === "income" ? "Income" : "Spending",
      role,
      keywords: [],
    }
  );
}

/** Bucket one transaction: manual override, then first keyword rule, then fallback. */
export function categorize(t: Txn, cats: Category[], overrides: Record<string, string>): Category {
  const o = overrides[t.id];
  if (o) {
    const c = cats.find((c) => c.name === o);
    if (c) return c;
  }
  const d = t.description.toLowerCase();
  for (const c of cats) {
    if (c.keywords.some((k) => k.trim() && d.includes(k.trim().toLowerCase()))) return c;
  }
  return fallback(cats, t.amount > 0 ? "income" : "core");
}
