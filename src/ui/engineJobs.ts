import { runMonteCarlo, runTornado, solveRetirementYear } from "../engine/montecarlo";
import type { MonteCarloSummary, SimInputs, SolveResult, TornadoRow } from "../engine/types";

export type EngineJob =
  | { seq: number; kind: "mc"; inputs: SimInputs }
  | { seq: number; kind: "solve"; inputs: SimInputs; spouse: "caleb" | "katy"; targetPct: number }
  | { seq: number; kind: "tornado"; inputs: SimInputs };

/**
 * A job minus its sequence number, which the caller assigns. Distributes over
 * the union — a bare `Omit<EngineJob, "seq">` would collapse to the keys the
 * three variants share and drop `spouse`/`targetPct`.
 */
export type EngineJobSpec = EngineJob extends infer T
  ? T extends EngineJob
    ? Omit<T, "seq">
    : never
  : never;

export type EngineReply =
  | { seq: number; kind: "mc"; summary: MonteCarloSummary }
  | { seq: number; kind: "solve"; solve: SolveResult }
  | { seq: number; kind: "tornado"; tornado: TornadoRow[] };

/**
 * The engine dispatch, as a pure function. Lives apart from the worker so the
 * same code can run either in the worker or — when a worker can't be created
 * (a strict-CSP host, say) — directly on the main thread.
 */
export function handleJob(job: EngineJob): EngineReply {
  switch (job.kind) {
    case "mc":
      return { seq: job.seq, kind: "mc", summary: runMonteCarlo(job.inputs) };
    case "solve":
      return {
        seq: job.seq,
        kind: "solve",
        solve: solveRetirementYear(job.inputs, job.spouse, job.targetPct),
      };
    case "tornado":
      return { seq: job.seq, kind: "tornado", tornado: runTornado(job.inputs) };
  }
}
