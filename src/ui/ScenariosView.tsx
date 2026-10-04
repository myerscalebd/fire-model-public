import { useEffect, useState } from "react";
import { DEFAULT_INPUTS } from "../data/assumptions";
import { migrateSaved } from "../data/profile";
import { deterministicPath } from "../engine/returns";
import { buildContext, runPath } from "../engine/simulate";
import type { MonteCarloSummary, SimInputs } from "../engine/types";
import { fmtMoney, fmtPct } from "./format";

const SCENARIOS_KEY = "fire-model-scenarios-v1";

interface SavedScenario {
  name: string;
  inputs: SimInputs;
  savedAt: string;
}

interface CompareRow {
  name: string;
  isCurrent: boolean;
  summary: MonteCarloSummary;
  /** Lowest deterministic accessible balance before the younger spouse reaches the unlock age. */
  bridgeLow: number;
}

function loadScenarios(): SavedScenario[] {
  try {
    const raw = localStorage.getItem(SCENARIOS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as SavedScenario[];
      // Fill fields added since the scenario was saved.
      return parsed.map((s) => {
        const inp = migrateSaved(s.inputs);
        return { ...s, inputs: { ...DEFAULT_INPUTS, ...inp, balances: { ...DEFAULT_INPUTS.balances, ...inp.balances } } };
      });
    }
  } catch {
    // corrupted — start fresh
  }
  return [];
}

function bridgeLowPoint(inputs: SimInputs): number {
  const res = runPath(buildContext(inputs), deterministicPath(inputs));
  const bridgeYears = res.years.filter((y) => Math.min(y.ageA, y.ageB) < inputs.unlockAge);
  return Math.min(...bridgeYears.map((y) => y.accessible));
}

interface Props {
  currentInputs: SimInputs;
  onLoad: (inputs: SimInputs) => void;
  runMc: (inputs: SimInputs) => Promise<MonteCarloSummary>;
}

export function ScenariosView({ currentInputs, onLoad, runMc }: Props) {
  const [scenarios, setScenarios] = useState<SavedScenario[]>(loadScenarios);
  const [name, setName] = useState("");
  const [rows, setRows] = useState<CompareRow[] | null>(null);
  const [comparing, setComparing] = useState(false);

  useEffect(() => {
    localStorage.setItem(SCENARIOS_KEY, JSON.stringify(scenarios));
  }, [scenarios]);

  const saveCurrent = () => {
    const trimmed = name.trim() || `scenario ${scenarios.length + 1}`;
    setScenarios((prev) => [
      ...prev.filter((s) => s.name !== trimmed),
      { name: trimmed, inputs: currentInputs, savedAt: new Date().toISOString().slice(0, 10) },
    ]);
    setName("");
    setRows(null); // stale
  };

  const remove = (n: string) => {
    setScenarios((prev) => prev.filter((s) => s.name !== n));
    setRows((prev) => (prev ? prev.filter((r) => r.name !== n) : prev));
  };

  const compare = async () => {
    setComparing(true);
    const targets: { name: string; inputs: SimInputs; isCurrent: boolean }[] = [
      { name: "current (unsaved)", inputs: currentInputs, isCurrent: true },
      ...scenarios.map((s) => ({ name: s.name, inputs: s.inputs, isCurrent: false })),
    ];
    const out: CompareRow[] = [];
    for (const t of targets) {
      // Sequential on purpose — one worker, and progressive rendering.
      const summary = await runMc(t.inputs);
      out.push({ name: t.name, isCurrent: t.isCurrent, summary, bridgeLow: bridgeLowPoint(t.inputs) });
      setRows([...out]);
    }
    setComparing(false);
  };

  return (
    <div className="view">
      <p className="view-note">
        Save the current assumptions under a name, tweak the sidebar, save again — then compare
        them side by side. Scenarios persist in this browser.
      </p>

      <div className="scenario-save-row">
        <input
          type="text"
          placeholder="scenario name (e.g. 'retire 2031 + guardrails')"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && saveCurrent()}
        />
        <button className="ghost" onClick={saveCurrent}>Save current</button>
        <button className="ghost" onClick={compare} disabled={comparing}>
          {comparing ? "Comparing…" : "Run comparison"}
        </button>
      </div>

      {scenarios.length === 0 && (
        <p className="view-note">No saved scenarios yet — the comparison will run on the current assumptions alone.</p>
      )}

      {scenarios.length > 0 && !rows && (
        <ul className="scenario-list">
          {scenarios.map((s) => (
            <li key={s.name}>
              <span className="scenario-name">{s.name}</span>
              <span className="scenario-date">{s.savedAt}</span>
              <button className="ghost mini" onClick={() => onLoad(s.inputs)}>Load</button>
              <button className="ghost mini" onClick={() => remove(s.name)}>Delete</button>
            </li>
          ))}
        </ul>
      )}

      {rows && (
        <div className="table-box scenario-table">
          <table>
            <thead>
              <tr>
                <th>Scenario</th>
                <th>Full success</th>
                <th>Back to work</th>
                <th>Squeeze</th>
                <th>Ruin</th>
                <th>Bridge low (det)</th>
                <th>p10 end NW</th>
                <th>p50 end NW</th>
                <th>Median squeeze</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.name} className={r.isCurrent ? "row-current" : ""}>
                  <td>{r.name}</td>
                  <td className="c-green">{fmtPct(r.summary.fullSuccessPct)}</td>
                  <td className="c-blue">{fmtPct(r.summary.backToWorkPct)}</td>
                  <td className="c-amber">{fmtPct(r.summary.liquiditySqueezePct)}</td>
                  <td className="c-red">{fmtPct(r.summary.trueRuinPct)}</td>
                  <td>{fmtMoney(r.bridgeLow)}</td>
                  <td>{fmtMoney(r.summary.endingNetWorthP10)}</td>
                  <td>{fmtMoney(r.summary.endingNetWorthP50)}</td>
                  <td>{r.summary.medianSqueezeYear ? Math.round(r.summary.medianSqueezeYear) : "—"}</td>
                  <td>
                    {!r.isCurrent && (
                      <>
                        <button
                          className="ghost mini"
                          onClick={() => onLoad(scenarios.find((s) => s.name === r.name)!.inputs)}
                        >
                          Load
                        </button>
                        <button className="ghost mini" onClick={() => remove(r.name)}>Delete</button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
