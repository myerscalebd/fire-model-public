/// <reference lib="webworker" />
import { runMonteCarlo, runTornado, solveRetirementYear } from "../engine/montecarlo";
import type { SimInputs } from "../engine/types";

export type WorkerJob =
  | { seq: number; kind: "mc"; inputs: SimInputs }
  | { seq: number; kind: "solve"; inputs: SimInputs; spouse: "spouseA" | "spouseB"; targetPct: number }
  | { seq: number; kind: "tornado"; inputs: SimInputs };

self.onmessage = (e: MessageEvent<WorkerJob>) => {
  const job = e.data;
  if (job.kind === "mc") {
    self.postMessage({ seq: job.seq, kind: "mc", summary: runMonteCarlo(job.inputs) });
  } else if (job.kind === "solve") {
    self.postMessage({
      seq: job.seq,
      kind: "solve",
      solve: solveRetirementYear(job.inputs, job.spouse, job.targetPct),
    });
  } else {
    self.postMessage({ seq: job.seq, kind: "tornado", tornado: runTornado(job.inputs) });
  }
};
