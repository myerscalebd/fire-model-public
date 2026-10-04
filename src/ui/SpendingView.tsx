import { useEffect, useMemo, useState } from "react";
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { SimInputs } from "../engine/types";
import { defaultAccountName, importCsv, mergeTxns, type Txn } from "../ledger/bankImport";
import { categorize, DEFAULT_CATEGORIES, ROLE_LABEL, type Category, type Role } from "../ledger/categorize";
import { fireSummary, monthly, yearly } from "../ledger/summarize";
import { fmtMoney } from "./format";

/** Transactions live only in this browser's localStorage — never in git. */
const KEY = "fire-ledger-v1";

interface Ledger {
  txns: Txn[];
  categories: Category[];
  overrides: Record<string, string>;
}

const EMPTY: Ledger = { txns: [], categories: DEFAULT_CATEGORIES, overrides: {} };

function load(): Ledger {
  try {
    const p = JSON.parse(localStorage.getItem(KEY) || "null");
    if (p && Array.isArray(p.txns)) {
      return { txns: p.txns, categories: p.categories ?? DEFAULT_CATEGORIES, overrides: p.overrides ?? {} };
    }
  } catch {
    // unreadable — start empty
  }
  return EMPTY;
}

const PALETTE = ["#8be9fd", "#f59e0b", "#a78bfa", "#4ade80", "#f472b6", "#fbbf24", "#60a5fa", "#fb7185"];
const ROLES: Role[] = ["core", "housing", "childcare", "income", "transfer"];

interface Props {
  inputs: SimInputs;
  onApply: (patch: Partial<SimInputs>) => void;
}

export function SpendingView({ inputs, onApply }: Props) {
  const [ledger, setLedger] = useState<Ledger>(load);
  const [account, setAccount] = useState("");
  const [flip, setFlip] = useState(false);
  const [notes, setNotes] = useState<string[]>([]);
  const [browseMonth, setBrowseMonth] = useState<string | null>(null);

  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(ledger));
    } catch {
      setNotes(["Couldn't save to browser storage (full or blocked) — changes will be lost on reload."]);
    }
  }, [ledger]);

  const rows = useMemo(
    () => monthly(ledger.txns, ledger.categories, ledger.overrides),
    [ledger],
  );
  const years = useMemo(() => yearly(rows), [rows]);
  const fire = useMemo(() => fireSummary(rows, ledger.categories, new Date()), [rows, ledger.categories]);

  const accounts = useMemo(() => {
    const m = new Map<string, { n: number; from: string; to: string }>();
    for (const t of ledger.txns) {
      const a = m.get(t.account);
      if (!a) m.set(t.account, { n: 1, from: t.date, to: t.date });
      else {
        a.n++;
        if (t.date < a.from) a.from = t.date;
        if (t.date > a.to) a.to = t.date;
      }
    }
    return [...m.entries()];
  }, [ledger.txns]);

  const expenseCats = ledger.categories.filter((c) => c.role !== "income" && c.role !== "transfer");
  const chartData = rows.slice(-24).map((r) => ({ month: r.month, Income: Math.round(r.income), ...roundAll(r.byCategory) }));

  const onFiles = async (files: FileList) => {
    let all = ledger.txns;
    const out: string[] = [];
    for (const f of Array.from(files)) {
      const acct = account.trim() || defaultAccountName(f.name);
      const res = importCsv(await f.text(), acct, flip);
      if (res.error) {
        out.push(`${f.name}: ${res.error}`);
        continue;
      }
      const m = mergeTxns(all, res.txns);
      all = m.txns;
      let note = `${f.name} → "${acct}": ${m.added} new`;
      if (res.txns.length - m.added) note += `, ${res.txns.length - m.added} already imported`;
      if (res.skipped) note += `, ${res.skipped} unreadable rows skipped`;
      note += ".";
      if (res.positiveShare > 0.8 && res.txns.length > 5) {
        note +=
          " ⚠ Most amounts came in positive — if this card exports charges as positive numbers, remove this account below and re-import with “flip signs” checked.";
      }
      out.push(note);
    }
    setLedger({ ...ledger, txns: all });
    setNotes(out);
  };

  const removeAccount = (name: string) =>
    setLedger({ ...ledger, txns: ledger.txns.filter((t) => t.account !== name) });

  const updateCat = (i: number, patch: Partial<Category>) =>
    setLedger({
      ...ledger,
      categories: ledger.categories.map((c, j) => (j === i ? { ...c, ...patch } : c)),
    });

  const months = rows.map((r) => r.month);
  const activeMonth = browseMonth && months.includes(browseMonth) ? browseMonth : months[months.length - 1];
  const monthTxns = ledger.txns.filter((t) => t.date.startsWith(activeMonth ?? "~"));

  return (
    <div className="view">
      <p className="view-note">
        Money in / money out from your bank and card exports. Transactions are stored only in this
        browser — nothing is uploaded or committed. Transfers (card payments, moves between your own
        accounts) are excluded so spending isn't counted twice.
      </p>

      <h3>Import</h3>
      <div className="ledger-import">
        <label className="ghost button-like">
          Choose CSV files…
          <input
            type="file"
            accept=".csv,text/csv"
            multiple
            hidden
            onChange={(e) => {
              if (e.target.files?.length) onFiles(e.target.files);
              e.target.value = "";
            }}
          />
        </label>
        <input
          type="text"
          className="ledger-acct"
          placeholder="account name (default: from file name)"
          value={account}
          list="ledger-accounts"
          onChange={(e) => setAccount(e.target.value)}
        />
        <datalist id="ledger-accounts">
          {accounts.map(([a]) => (
            <option key={a} value={a} />
          ))}
        </datalist>
        <label className="field check">
          <input type="checkbox" checked={flip} onChange={(e) => setFlip(e.target.checked)} />
          <span>flip signs (cards that export charges as positive)</span>
        </label>
      </div>
      {notes.length > 0 && <div className="ledger-notes">{notes.join("\n")}</div>}

      {accounts.length > 0 && (
        <ul className="scenario-list">
          {accounts.map(([name, a]) => (
            <li key={name}>
              <span className="scenario-name">{name}</span>
              <span className="scenario-date">
                {a.n} transactions · {a.from} → {a.to}
              </span>
              <button className="ghost mini" onClick={() => removeAccount(name)}>Remove</button>
            </li>
          ))}
        </ul>
      )}

      {rows.length === 0 ? (
        <p className="view-note">
          No transactions yet. Download CSV exports from your bank and card sites (most have
          “Download activity” → CSV) covering the last 12 months, and drop them in above.
        </p>
      ) : (
        <>
          <h3>
            Last {fire.monthsUsed} complete month{fire.monthsUsed === 1 ? "" : "s"}
            {fire.from && ` (${fire.from} → ${fire.to})`}
            {fire.monthsUsed < 12 && fire.monthsUsed > 0 && " — annualized"}
          </h3>
          <div className="stat-row">
            <div className="stat green">
              <div className="stat-value">{fmtMoney(fire.annualIncome)}</div>
              <div className="stat-label">Money in / yr</div>
            </div>
            <div className="stat amber">
              <div className="stat-value">{fmtMoney(fire.annualOut)}</div>
              <div className="stat-label">Money out / yr</div>
              <div className="stat-sub">everything except transfers</div>
            </div>
            <div className="stat blue">
              <div className="stat-value">{fmtMoney(fire.annualIncome - fire.annualOut)}</div>
              <div className="stat-label">Net / yr</div>
              <div className="stat-sub">what's left to save</div>
            </div>
          </div>

          <div className="solver-card">
            <strong>Feed the retirement model</strong>
            <p className="view-note" style={{ margin: "6px 0 10px" }}>
              The model tracks housing and childcare on their own lines, so its “core spend” is
              everything else. Healthcare premiums deducted from paychecks won't show up in bank
              data.
            </p>
            <table className="ledger-fire">
              <tbody>
                <tr>
                  <td>Core spending</td>
                  <td>{fmtMoney(fire.byRole.core)}/yr</td>
                  <td className="muted">model: {fmtMoney(inputs.coreSpend)}</td>
                  <td>
                    <button className="ghost mini" onClick={() => onApply({ coreSpend: Math.round(fire.byRole.core / 1000) * 1000 })}>
                      Use as core spend
                    </button>
                  </td>
                </tr>
                <tr>
                  <td>School / childcare</td>
                  <td>{fmtMoney(fire.byRole.childcare)}/yr</td>
                  <td className="muted">model: {fmtMoney(inputs.childcareAnnual)}</td>
                  <td>
                    <button className="ghost mini" onClick={() => onApply({ childcareAnnual: Math.round(fire.byRole.childcare / 1000) * 1000 })}>
                      Use as childcare
                    </button>
                  </td>
                </tr>
                <tr>
                  <td>Housing</td>
                  <td>{fmtMoney(fire.byRole.housing)}/yr</td>
                  <td className="muted" colSpan={2}>
                    model: {fmtMoney(inputs.mortgageMonthlyPI * 12 + inputs.escrowAnnual)} P&amp;I + escrow
                    {inputs.prepay && ` + ${fmtMoney(inputs.extraPrincipalMonthly * 12)} extra principal`} — set via the Mortgage inputs
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <h3>By month</h3>
          <div className="chart-box">
            <ResponsiveContainer width="100%" height={280}>
              <ComposedChart data={chartData} margin={{ top: 10, right: 20, bottom: 0, left: 10 }}>
                <CartesianGrid strokeOpacity={0.15} />
                <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                <YAxis tickFormatter={(v: number) => fmtMoney(v)} width={64} />
                <Tooltip
                  formatter={(v: number) => fmtMoney(v)}
                  contentStyle={{ background: "#1b2030", border: "1px solid #333" }}
                />
                <Legend />
                {expenseCats.map((c, i) => (
                  <Bar key={c.name} dataKey={c.name} stackId="out" fill={PALETTE[i % PALETTE.length]} fillOpacity={0.75} />
                ))}
                <Line dataKey="Income" stroke="#4ade80" strokeWidth={2} dot={false} isAnimationActive={false} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>

          <div className="table-box" style={{ marginTop: 12 }}>
            <table>
              <thead>
                <tr>
                  <th>Month</th>
                  <th>In</th>
                  <th>Out</th>
                  <th>Net</th>
                  {expenseCats.map((c) => (
                    <th key={c.name}>{c.name}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {[...rows].reverse().map((r) => (
                  <tr key={r.month}>
                    <td>{r.month}</td>
                    <td>{fmtMoney(r.income)}</td>
                    <td>{fmtMoney(r.out)}</td>
                    <td className={r.net < 0 ? "c-red" : ""}>{fmtMoney(r.net)}</td>
                    {expenseCats.map((c) => (
                      <td key={c.name}>{r.byCategory[c.name] ? fmtMoney(r.byCategory[c.name]) : "—"}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <h3>By year</h3>
          <div className="table-box">
            <table>
              <thead>
                <tr>
                  <th>Year</th>
                  <th>Months</th>
                  <th>In</th>
                  <th>Out</th>
                  <th>Net</th>
                  {expenseCats.map((c) => (
                    <th key={c.name}>{c.name}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {[...years].reverse().map((y) => (
                  <tr key={y.year}>
                    <td>{y.year}</td>
                    <td>{y.months}</td>
                    <td>{fmtMoney(y.income)}</td>
                    <td>{fmtMoney(y.out)}</td>
                    <td className={y.net < 0 ? "c-red" : ""}>{fmtMoney(y.net)}</td>
                    {expenseCats.map((c) => (
                      <td key={c.name}>{y.byCategory[c.name] ? fmtMoney(y.byCategory[c.name]) : "—"}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <h3>
            Transactions
            <span className="cap-control">
              <select value={activeMonth} onChange={(e) => setBrowseMonth(e.target.value)}>
                {[...months].reverse().map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
            </span>
          </h3>
          <p className="view-note">Change a bucket here to fix a one-off; edit the keywords below to fix a pattern.</p>
          <div className="table-box">
            <table>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Account</th>
                  <th style={{ textAlign: "left" }}>Description</th>
                  <th>Amount</th>
                  <th>Bucket</th>
                </tr>
              </thead>
              <tbody>
                {monthTxns.map((t) => {
                  const c = categorize(t, ledger.categories, ledger.overrides);
                  const overridden = !!ledger.overrides[t.id];
                  return (
                    <tr key={t.id}>
                      <td>{t.date}</td>
                      <td>{t.account}</td>
                      <td style={{ textAlign: "left" }}>{t.description}</td>
                      <td className={t.amount < 0 ? "" : "c-green"}>{fmtMoney(t.amount)}</td>
                      <td>
                        <select
                          className={overridden ? "overridden" : ""}
                          value={overridden ? c.name : ""}
                          onChange={(e) => {
                            const o = { ...ledger.overrides };
                            if (e.target.value) o[t.id] = e.target.value;
                            else delete o[t.id];
                            setLedger({ ...ledger, overrides: o });
                          }}
                        >
                          <option value="">auto: {c.name}</option>
                          {ledger.categories.map((k) => (
                            <option key={k.name} value={k.name}>{k.name}</option>
                          ))}
                        </select>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      <h3>Buckets &amp; keywords</h3>
      <p className="view-note">
        Checked top to bottom; first keyword found in the description wins. Unmatched money in →
        Income, unmatched money out → Spending. Add your mortgage servicer and school names here.
      </p>
      <div className="cat-editor">
        {ledger.categories.map((c, i) => (
          <div className="cat-row" key={i}>
            <input type="text" value={c.name} onChange={(e) => updateCat(i, { name: e.target.value })} />
            <select value={c.role} onChange={(e) => updateCat(i, { role: e.target.value as Role })}>
              {ROLES.map((r) => (
                <option key={r} value={r}>{ROLE_LABEL[r]}</option>
              ))}
            </select>
            <input
              type="text"
              className="cat-kw"
              value={c.keywords.join(", ")}
              placeholder="keywords, comma separated"
              onChange={(e) => updateCat(i, { keywords: e.target.value.split(",").map((k) => k.trimStart()) })}
            />
            <button
              className="ghost mini"
              onClick={() => setLedger({ ...ledger, categories: ledger.categories.filter((_, j) => j !== i) })}
            >
              ✕
            </button>
          </div>
        ))}
        <div className="io-row" style={{ marginTop: 8 }}>
          <button
            className="ghost mini"
            onClick={() =>
              setLedger({
                ...ledger,
                categories: [
                  ...ledger.categories.slice(0, -1),
                  { name: "New bucket", role: "core", keywords: [] },
                  ...ledger.categories.slice(-1),
                ],
              })
            }
          >
            + Add bucket
          </button>
          <button className="ghost mini" onClick={() => setLedger({ ...ledger, categories: DEFAULT_CATEGORIES })}>
            Reset buckets
          </button>
          {ledger.txns.length > 0 && (
            <button
              className="ghost mini"
              onClick={() => {
                if (window.confirm("Delete all imported transactions from this browser?")) setLedger(EMPTY);
              }}
            >
              Clear all data
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function roundAll(o: Record<string, number>): Record<string, number> {
  return Object.fromEntries(Object.entries(o).map(([k, v]) => [k, Math.round(v)]));
}
