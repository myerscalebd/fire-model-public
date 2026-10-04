import {
  Area,
  AreaChart,
  CartesianGrid,
  Legend,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { PathResult, SimInputs } from "../engine/types";
import { fmtMoney } from "./format";

interface Props {
  inputs: SimInputs;
  result: PathResult;
}

export function DeterministicView({ inputs, result }: Props) {
  const data = result.years.map((y) => ({
    year: y.year,
    Accessible: Math.round(y.accessible),
    Locked: Math.round(y.locked),
  }));
  const unlockB = inputs.startYear + (inputs.unlockAge - inputs.startAgeB);
  const unlockA = inputs.startYear + (inputs.unlockAge - inputs.startAgeA);
  // Earlier unlock labels to the left of its line, the later one to the right.
  const posA = unlockA < unlockB ? "insideTopLeft" : "insideTopRight";
  const posB = unlockA < unlockB ? "insideTopRight" : "insideTopLeft";
  const payoff = result.years.find((y) => y.mortgageBalance === 0)?.year;

  return (
    <div className="view">
      <p className="view-note">
        Single path at a flat {(inputs.expectedRealReturn * 100).toFixed(1)}% real return. The
        stack shows the 59½ wall: <b>accessible</b> money funds the bridge;{" "}
        <b>locked</b> money is real but unreachable without penalty.
      </p>
      <div className="chart-box">
        <ResponsiveContainer width="100%" height={340}>
          <AreaChart data={data} margin={{ top: 10, right: 20, bottom: 0, left: 10 }}>
            <CartesianGrid strokeOpacity={0.15} />
            <XAxis dataKey="year" />
            <YAxis tickFormatter={(v: number) => fmtMoney(v)} width={70} />
            <Tooltip
              formatter={(v: number) => fmtMoney(v)}
              contentStyle={{ background: "#1b2030", border: "1px solid #333" }}
            />
            <Legend />
            <Area type="monotone" dataKey="Accessible" stackId="1" stroke="#4ade80" fill="#4ade80" fillOpacity={0.5} />
            <Area type="monotone" dataKey="Locked" stackId="1" stroke="#f59e0b" fill="#f59e0b" fillOpacity={0.35} />
            <ReferenceLine x={unlockB} stroke="#8be9fd" strokeDasharray="4 4" label={{ value: `${inputs.nameB} 59½`, fill: "#8be9fd", fontSize: 11, position: posB }} />
            <ReferenceLine x={unlockA} stroke="#bd93f9" strokeDasharray="4 4" label={{ value: `${inputs.nameA} 59½`, fill: "#bd93f9", fontSize: 11, position: posA }} />
            {payoff && (
              <ReferenceLine x={payoff} stroke="#888" strokeDasharray="2 4" label={{ value: "mortgage paid", fill: "#aaa", fontSize: 11, position: "insideBottomLeft" }} />
            )}
          </AreaChart>
        </ResponsiveContainer>
      </div>

      <h3>Funding table</h3>
      <div className="table-box">
        <table>
          <thead>
            <tr>
              <th>Year</th><th>Ages</th><th>Phase</th><th>Income</th><th>Spend</th>
              <th>Health</th><th>Taxes</th><th>Convert</th><th>Withdrawn</th>
              <th>Penalty $</th><th>Accessible</th><th>Locked</th><th>Net worth</th>
            </tr>
          </thead>
          <tbody>
            {result.years.map((y) => {
              const withdrawn = y.wTaxable + y.wRothBasis + y.wTrad + y.wHsa + y.wPenalized + y.sepp72t;
              const income = y.employmentIncome + y.pensionIncome + y.ssIncome;
              return (
                <tr key={y.year} className={y.squeezed ? "row-squeeze" : y.ruined ? "row-ruin" : ""}>
                  <td>{y.year}</td>
                  <td>{y.ageA}/{y.ageB}</td>
                  <td>
                    {y.phase === "both" ? "both work" : y.phase === "onlyA" ? `${inputs.nameA} works` : y.phase === "onlyB" ? `${inputs.nameB} works` : "retired"}
                    {y.reentryReactive > 0 && (
                      <span className="reentry-badge" title={`Forced re-entry: ${fmtMoney(y.reentryReactive)} earned`}>
                        ↩ back to work
                      </span>
                    )}
                  </td>
                  <td>{fmtMoney(income)}</td>
                  <td>{fmtMoney(y.totalSpend)}</td>
                  <td>{fmtMoney(y.healthcare)}</td>
                  <td>{fmtMoney(y.taxesPaid)}</td>
                  <td>{y.conversion > 0 ? fmtMoney(y.conversion) : "—"}</td>
                  <td>{withdrawn > 0 ? fmtMoney(withdrawn) : "—"}</td>
                  <td>{y.wPenalized > 0 ? fmtMoney(y.wPenalized) : "—"}</td>
                  <td>{fmtMoney(y.accessible)}</td>
                  <td>{fmtMoney(y.locked)}</td>
                  <td>{fmtMoney(y.netWorth)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
