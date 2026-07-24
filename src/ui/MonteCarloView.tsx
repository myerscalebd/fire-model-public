import { useMemo, useState } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { buildHistogram, runCohortDetail } from "../engine/montecarlo";
import type { MonteCarloSummary, PathResult, SimInputs, SolveResult } from "../engine/types";
import { CohortDetail } from "./CohortDetail";
import { fmtMoney, fmtPct } from "./format";

interface Props {
  inputs: SimInputs;
  summary: MonteCarloSummary | null;
  running: boolean;
  onSolve: (spouse: "caleb" | "katy", targetPct: number) => Promise<SolveResult>;
}

function SolverCard({ inputs, onSolve }: { inputs: SimInputs; onSolve: Props["onSolve"] }) {
  const [spouse, setSpouse] = useState<"caleb" | "katy">("caleb");
  const [target, setTarget] = useState(90);
  const [result, setResult] = useState<SolveResult | null>(null);
  const [solving, setSolving] = useState(false);

  const run = async () => {
    setSolving(true);
    setResult(null);
    setResult(await onSolve(spouse, target));
    setSolving(false);
  };

  const otherLabel =
    spouse === "caleb"
      ? `${inputs.nameB} retiring ${inputs.katyRetireYear}`
      : `${inputs.nameA} retiring ${inputs.calebRetireYear}`;

  return (
    <div className="solver-card">
      <div className="solver-controls">
        <strong>Earliest retirement solver</strong>
        <select value={spouse} onChange={(e) => setSpouse(e.target.value as "caleb" | "katy")}>
          <option value="caleb">{inputs.nameA}</option>
          <option value="katy">{inputs.nameB}</option>
        </select>
        <span>target ≥</span>
        <input
          type="number"
          value={target}
          min={50}
          max={100}
          step={1}
          onChange={(e) => setTarget(Number(e.target.value))}
        />
        <span>% full success</span>
        <button className="ghost" onClick={run} disabled={solving}>
          {solving ? "Solving…" : "Solve"}
        </button>
      </div>
      {result && (
        <div className="solver-result">
          {result.year !== null ? (
            <>
              <b>{spouse === "caleb" ? inputs.nameA : inputs.nameB} can retire in {result.year}</b>{" "}
              ({fmtPct(result.pct!)} full success, with {otherLabel}, all other assumptions as set).
            </>
          ) : (
            <>
              No retirement year up to age 70 reaches {target}% — lower the target or adjust the plan.
            </>
          )}
          <div className="solver-checked">
            checked:{" "}
            {result.checked.map((c) => `${c.year} → ${c.pct.toFixed(0)}%`).join(" · ")}
          </div>
        </div>
      )}
    </div>
  );
}

export function MonteCarloView({ inputs, summary, running, onSolve }: Props) {
  const [capM, setCapM] = useState(20); // histogram top-bucket cap, $M
  // Accessible-wealth chart y-axis cap ($M). null → auto-fit the bridge years.
  const [yMaxM, setYMaxM] = useState<number | null>(null);
  // Cohort drill-down: the start year clicked and its full path.
  const [detail, setDetail] = useState<{ year: number; path: PathResult } | null>(null);

  // Year Caleb turns 60 — the end of the pre-59½ bridge that actually matters.
  const bridgeEndYear = inputs.startYear + (60 - inputs.calebAge0);

  const overallMaxM = useMemo(() => {
    if (!summary) return 1;
    return Math.max(1, Math.ceil(Math.max(...summary.accessibleP90) / 1_000_000));
  }, [summary]);

  const bridgeMaxM = useMemo(() => {
    if (!summary) return 1;
    const bridge = summary.accessibleP90.filter((_, t) => inputs.startYear + t < bridgeEndYear);
    const arr = bridge.length ? bridge : summary.accessibleP90;
    return Math.max(1, Math.ceil(Math.max(...arr) / 1_000_000));
  }, [summary, inputs.startYear, bridgeEndYear]);

  const histogram = useMemo(() => {
    if (!summary) return [];
    const n = Math.max(1, summary.numPaths);
    return buildHistogram(summary.endingNetWorths, 30, capM * 1_000_000).map((b) => ({
      label: b.to === Infinity ? `≥${fmtMoney(b.from)}` : fmtMoney(b.from),
      pct: (100 * b.count) / n,
      count: b.count,
    }));
  }, [summary, capM]);

  // Year-range slider for the time-series charts (fan + returns spaghetti).
  const lastYear = inputs.startYear + inputs.horizonYears - 1;
  const [showThrough, setShowThrough] = useState<number | null>(null);
  const effThrough = Math.min(showThrough ?? lastYear, lastYear);

  const fan = useMemo(() => {
    if (!summary) return [];
    return summary.accessibleP50
      .map((p50, t) => ({
        year: inputs.startYear + t,
        p10: Math.round(summary.accessibleP10[t]),
        p50: Math.round(p50),
        p90: Math.round(summary.accessibleP90[t]),
      }))
      .filter((row) => row.year <= effThrough);
  }, [summary, inputs.startYear, effThrough]);

  // Growth-of-$1 spaghetti from the sampled blended return paths.
  const spaghetti = useMemo(() => {
    if (!summary || !summary.returnPaths?.length) return { rows: [], keys: [] as string[] };
    const paths = summary.returnPaths;
    const keys = paths.map((_, i) => `p${i}`);
    const growth = paths.map(() => 1);
    const rows: Record<string, number>[] = [
      { year: inputs.startYear, ...Object.fromEntries(keys.map((k) => [k, 1])) },
    ];
    const horizon = Math.min(paths[0].length, inputs.horizonYears);
    for (let t = 0; t < horizon; t++) {
      const year = inputs.startYear + t + 1;
      const row: Record<string, number> = { year };
      paths.forEach((p, i) => {
        growth[i] *= 1 + p[t];
        row[keys[i]] = Number(growth[i].toFixed(4));
      });
      rows.push(row);
    }
    return { rows: rows.filter((r) => (r.year as number) <= effThrough), keys };
  }, [summary, inputs.startYear, inputs.horizonYears, effThrough]);

  if (!summary) {
    return <div className="view"><p className="view-note">Running simulations…</p></div>;
  }

  const effYMaxM = yMaxM ?? bridgeMaxM;

  return (
    <div className="view">
      <p className="view-note">
        {inputs.returnModel === "cohorts" ? (
          <>
            {summary.numPaths} historical cohorts — the plan replayed over every
            actual return sequence in real order
            {summary.cohorts?.length
              ? ` (start years ${summary.cohorts[0].startYear}–${summary.cohorts[summary.cohorts.length - 1].startYear})`
              : ""}
            .
          </>
        ) : (
          <>
            {summary.numPaths} randomized return paths (
            {inputs.returnModel === "bootstrap" ? "historical block bootstrap" : "IID Gaussian"}).
          </>
        )}
        {running && <em>&nbsp;updating…</em>}
      </p>

      <div className="stat-row">
        <div className="stat green">
          <div className="stat-value">{fmtPct(summary.fullSuccessPct)}</div>
          <div className="stat-label">Full success</div>
          <div className="stat-sub">lasts to the end, never squeezed, no going back to work</div>
        </div>
        <div className="stat blue">
          <div className="stat-value">{fmtPct(summary.backToWorkPct)}</div>
          <div className="stat-label">Back to work</div>
          <div className="stat-sub">
            survived only by re-entering the workforce
            {summary.medianReentryYears ? ` · ~${Math.round(summary.medianReentryYears)} yrs of work` : ""}
          </div>
        </div>
        <div className="stat amber">
          <div className="stat-value">{fmtPct(summary.liquiditySqueezePct)}</div>
          <div className="stat-label">Liquidity squeeze</div>
          <div className="stat-sub">
            accessible dry pre-59½, wealth remains
            {summary.medianSqueezeYear ? ` · median ${Math.round(summary.medianSqueezeYear)}` : ""}
            {summary.medianSqueezePenalty != null
              ? ` · median ${fmtMoney(summary.medianSqueezePenalty)} penalties paid`
              : ""}
          </div>
        </div>
        <div className="stat red">
          <div className="stat-value">{fmtPct(summary.trueRuinPct)}</div>
          <div className="stat-label">True ruin</div>
          <div className="stat-sub">
            actually out of money
            {summary.medianRuinYear ? ` · median ${Math.round(summary.medianRuinYear)}` : ""}
          </div>
        </div>
      </div>

      <SolverCard inputs={inputs} onSolve={onSolve} />

      <div className="stat-row minor">
        <div className="stat"><div className="stat-value">{fmtMoney(summary.endingNetWorthP10)}</div><div className="stat-label">p10 ending NW</div><div className="stat-sub">only 1 in 10 paths worse</div></div>
        <div className="stat"><div className="stat-value">{fmtMoney(summary.endingNetWorthP50)}</div><div className="stat-label">median ending NW</div><div className="stat-sub">the middle outcome</div></div>
        <div className="stat"><div className="stat-value">{fmtMoney(summary.endingNetWorthP90)}</div><div className="stat-label">p90 ending NW</div><div className="stat-sub">only 1 in 10 paths better</div></div>
      </div>

      {summary.cohorts && summary.cohorts.length > 0 && (
        <>
          <h3>Outcome by starting year</h3>
          <p className="view-note">
            Each square is a retirement that began in that year and ran {inputs.horizonYears} years.
            Hover for the ending net worth; <b>click to see that cohort's year-by-year story</b>.
          </p>
          <div className="cohort-grid">
            {summary.cohorts.map((c) => (
              <button
                key={c.startYear}
                className={`cohort-cell ${c.classification}`}
                onClick={() => setDetail({ year: c.startYear, path: runCohortDetail(inputs, c.startYear) })}
                title={`${c.startYear}: ${
                  c.classification === "fullSuccess"
                    ? "full success"
                    : c.classification === "backToWork"
                      ? `back to work (${c.reentryYears} yrs)`
                      : c.classification === "liquiditySqueeze"
                        ? `liquidity squeeze (${c.firstSqueezeYear})`
                        : `true ruin (${c.ruinYear})`
                } · ending NW ${fmtMoney(c.endingNetWorth)} · click for detail`}
              >
                {String(c.startYear).slice(2)}
              </button>
            ))}
          </div>
        </>
      )}

      <div className="year-range-row">
        <span>Time charts show 2026 –</span>
        <input
          type="range"
          min={inputs.startYear + 4}
          max={lastYear}
          step={1}
          value={effThrough}
          onChange={(e) => setShowThrough(Number(e.target.value))}
        />
        <b>{effThrough}</b>
        {effThrough < lastYear && (
          <button className="ghost mini" onClick={() => setShowThrough(null)}>full horizon</button>
        )}
      </div>

      <h3>
        Accessible wealth through time (p10 / p50 / p90)
        <span className="cap-control">
          y-axis ≤ ${effYMaxM}M
          <button className="ghost mini" onClick={() => setYMaxM(null)} title="Auto-fit the bridge years">
            fit bridge
          </button>
        </span>
      </h3>
      <div className="chart-box">
        <div className="chart-with-vslider">
          <div className="vslider-wrap" title="Zoom the y-axis so the bridge years aren't flattened by the endgame">
            <input
              className="vslider"
              type="range"
              min={1}
              max={overallMaxM}
              step={Math.max(1, Math.round(overallMaxM / 100))}
              value={effYMaxM}
              onChange={(e) => setYMaxM(Number(e.target.value))}
            />
          </div>
          <ResponsiveContainer width="100%" height={280}>
            <AreaChart data={fan} margin={{ top: 10, right: 20, bottom: 0, left: 10 }}>
              <CartesianGrid strokeOpacity={0.15} />
              <XAxis dataKey="year" />
              <YAxis
                tickFormatter={(v: number) => fmtMoney(v)}
                width={70}
                domain={[0, effYMaxM * 1_000_000]}
                allowDataOverflow
              />
              <Tooltip formatter={(v: number) => fmtMoney(v)} contentStyle={{ background: "#1b2030", border: "1px solid #333" }} />
              <Area type="monotone" dataKey="p90" stroke="#4ade80" fill="#4ade80" fillOpacity={0.15} />
              <Area type="monotone" dataKey="p50" stroke="#8be9fd" fill="#8be9fd" fillOpacity={0.2} />
              <Area type="monotone" dataKey="p10" stroke="#f87171" fill="#f87171" fillOpacity={0.25} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      <h3>
        Ending net worth distribution
        <span className="cap-control">
          top bucket ≥
          <input
            type="range"
            min={5}
            max={100}
            step={5}
            value={capM}
            onChange={(e) => setCapM(Number(e.target.value))}
          />
          ${capM}M
        </span>
      </h3>
      <div className="chart-box">
        <ResponsiveContainer width="100%" height={240}>
          <BarChart data={histogram} margin={{ top: 10, right: 20, bottom: 0, left: 10 }}>
            <CartesianGrid strokeOpacity={0.15} />
            <XAxis dataKey="label" tick={{ fontSize: 10 }} interval={4} />
            <YAxis width={44} tickFormatter={(v: number) => `${v}%`} />
            <Tooltip
              contentStyle={{ background: "#1b2030", border: "1px solid #333" }}
              formatter={(v: number, _n, item: { payload?: { count: number } }) =>
                [`${v.toFixed(1)}% (${item?.payload?.count ?? 0} paths)`, "share of paths"]}
            />
            <Bar dataKey="pct" fill="#8be9fd" fillOpacity={0.7} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      <h3>Simulated portfolio returns (growth of $1, {spaghetti.keys.length} sample paths)</h3>
      <p className="view-note">
        The raw material of the simulation: each faint line is one sampled path's cumulative real
        return (log scale) after the stock/bond blend. Fat left tails here are what create the
        squeeze and ruin bands above.
      </p>
      <div className="chart-box">
        <ResponsiveContainer width="100%" height={280}>
          <LineChart data={spaghetti.rows} margin={{ top: 10, right: 20, bottom: 0, left: 10 }}>
            <CartesianGrid strokeOpacity={0.15} />
            <XAxis dataKey="year" />
            <YAxis
              scale="log"
              domain={["auto", "auto"]}
              width={52}
              tickFormatter={(v: number) => `${v < 10 ? v.toFixed(1) : Math.round(v)}×`}
            />
            <Tooltip
              contentStyle={{ background: "#1b2030", border: "1px solid #333" }}
              formatter={(v: number) => `${v.toFixed(2)}×`}
              labelFormatter={(l) => `by ${l}`}
            />
            {spaghetti.keys.map((k) => (
              <Line
                key={k}
                dataKey={k}
                type="monotone"
                dot={false}
                stroke="#8be9fd"
                strokeOpacity={0.28}
                strokeWidth={1}
                isAnimationActive={false}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>

      {detail && (
        <CohortDetail
          startYear={detail.year}
          result={detail.path}
          onClose={() => setDetail(null)}
        />
      )}
    </div>
  );
}
