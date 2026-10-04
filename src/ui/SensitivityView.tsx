import { useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { SimInputs, TornadoRow } from "../engine/types";

interface Props {
  runTornado: (inputs: SimInputs) => Promise<TornadoRow[]>;
  inputs: SimInputs;
}

const GREEN = "#4ade80";
const RED = "#f87171";

export function SensitivityView({ runTornado, inputs }: Props) {
  const [rows, setRows] = useState<TornadoRow[] | null>(null);
  const [running, setRunning] = useState(false);

  const run = async () => {
    setRunning(true);
    setRows(await runTornado(inputs));
    setRunning(false);
  };

  const base = rows?.[0]?.base ?? 0;
  // Floating bars: [min, max] of the two perturbed outcomes, per lever.
  const data = (rows ?? []).map((r) => ({
    label: r.label,
    range: [Math.min(r.lowPct, r.highPct), Math.max(r.lowPct, r.highPct)] as [number, number],
    row: r,
    // Bar is greener when its upside beats base by more than its downside hurts.
    favorable: r.highPct >= r.lowPct,
  }));

  return (
    <div className="view">
      <p className="view-note">
        One-at-a-time sensitivity. Each input is nudged to a low and high value; the bar spans the
        resulting full-success %, and the dashed line is today's baseline. Longer bar = bigger lever.
        Runs in Gaussian mode so every input (including the return mean and volatility) is active.
      </p>
      <button className="ghost" onClick={run} disabled={running}>
        {running ? "Running…" : rows ? "Re-run sensitivity" : "Run sensitivity"}
      </button>

      {rows && (
        <>
          <div className="chart-box" style={{ marginTop: 14 }}>
            <ResponsiveContainer width="100%" height={40 + data.length * 40}>
              <BarChart data={data} layout="vertical" margin={{ top: 8, right: 40, bottom: 8, left: 20 }}>
                <CartesianGrid strokeOpacity={0.15} horizontal={false} />
                <XAxis
                  type="number"
                  domain={[0, 100]}
                  tickFormatter={(v: number) => `${v}%`}
                  stroke="#9aa3b8"
                  fontSize={11}
                />
                <YAxis type="category" dataKey="label" width={130} stroke="#9aa3b8" fontSize={12} />
                <Tooltip
                  cursor={{ fill: "rgba(255,255,255,0.04)" }}
                  contentStyle={{ background: "#1b2030", border: "1px solid #333" }}
                  formatter={(_v, _n, item: { payload?: { row: TornadoRow } }) => {
                    const r = item?.payload?.row;
                    if (!r) return "";
                    return [
                      `${r.lowLabel} → ${r.lowPct.toFixed(0)}%   |   ${r.highLabel} → ${r.highPct.toFixed(0)}%`,
                      `swing ±${r.swing.toFixed(0)} pts`,
                    ];
                  }}
                />
                <ReferenceLine
                  x={base}
                  stroke="#8be9fd"
                  strokeDasharray="4 4"
                  label={{ value: `base ${base.toFixed(0)}%`, fill: "#8be9fd", fontSize: 11, position: "top" }}
                />
                <Bar dataKey="range" radius={3}>
                  {data.map((d, i) => (
                    <Cell key={i} fill={d.favorable ? GREEN : RED} fillOpacity={0.65} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
          <p className="view-note">
            Top bar = the input your plan is most sensitive to. If a lever barely moves the bar, it's
            second-order — don't lose sleep over it.
          </p>
        </>
      )}
    </div>
  );
}
