import type { PathResult } from "../engine/types";
import { fmtMoney } from "./format";

interface Props {
  startYear: number;
  result: PathResult;
  onClose: () => void;
}

const classLabel: Record<string, string> = {
  fullSuccess: "full success",
  backToWork: "back to work",
  liquiditySqueeze: "liquidity squeeze",
  trueRuin: "true ruin",
};

export function CohortDetail({ startYear, result, onClose }: Props) {
  const cls = result.classification;
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <div>
            <h3 style={{ margin: 0 }}>
              Retiring into {startYear}
              <span className={`pill ${cls}`}>{classLabel[cls]}</span>
            </h3>
            <p className="view-note" style={{ margin: "4px 0 0" }}>
              The plan replayed over the actual {startYear}–{startYear + result.years.length - 1} market
              sequence. {result.reentryYears > 0 && (
                <>Back to work {result.reentryYears} yr{result.reentryYears > 1 ? "s" : ""}
                {result.firstReentryYear ? ` from ${result.firstReentryYear}` : ""}. </>
              )}
              {result.firstSqueezeYear && <>First squeeze {result.firstSqueezeYear}. </>}
              {result.ruinYear && <>Ran out {result.ruinYear}. </>}
              Ending net worth {fmtMoney(result.endingNetWorth)}.
            </p>
          </div>
          <button className="ghost" onClick={onClose}>Close</button>
        </div>

        <div className="table-box" style={{ maxHeight: "60vh" }}>
          <table>
            <thead>
              <tr>
                <th>Year</th><th>Ages</th><th>Return</th><th>Infl.</th><th>Spend</th>
                <th>Convert</th><th>Withdrawn</th><th>Penalty</th>
                <th>Accessible</th><th>Locked</th><th>Net worth</th>
              </tr>
            </thead>
            <tbody>
              {result.years.map((y) => {
                const withdrawn = y.wTaxable + y.wRothBasis + y.wTrad + y.wHsa + y.wPenalized + y.sepp72t;
                return (
                  <tr
                    key={y.year}
                    className={y.ruined ? "row-ruin" : y.squeezed ? "row-squeeze" : y.reentryReactive > 0 ? "row-reentry" : ""}
                  >
                    <td>
                      {y.year}
                      {y.reentryReactive > 0 && <span className="reentry-badge">↩ work</span>}
                    </td>
                    <td>{y.calebAge}/{y.katyAge}</td>
                    <td className={y.grossReturn < 0 ? "c-red" : ""}>{(y.grossReturn * 100).toFixed(0)}%</td>
                    <td>{(y.inflation * 100).toFixed(0)}%</td>
                    <td>{fmtMoney(y.totalSpend)}</td>
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
    </div>
  );
}
