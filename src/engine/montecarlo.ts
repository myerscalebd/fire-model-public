import { cohortPath, cohortStartYears, generateReturnPath, mulberry32 } from "./returns";
import { buildContext, runPath } from "./simulate";
import type { PathResult } from "./types";
import type {
  CohortResult,
  HistogramBin,
  MonteCarloSummary,
  SimInputs,
  SolveResult,
  TornadoRow,
} from "./types";

/** Linear-interpolated percentile of an UNSORTED sample (p in [0,1]). */
export function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = p * (sorted.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

/**
 * Histogram with a catch-all top bucket: values ≥ `cap` land in the last bar
 * so a few lottery paths don't flatten the interesting part of the chart.
 */
export function buildHistogram(values: number[], bins: number, cap: number): HistogramBin[] {
  if (values.length === 0 || bins < 1) return [];
  const lo = Math.min(0, ...values);
  const width = Math.max(1, (cap - lo) / bins);
  const out: HistogramBin[] = [];
  for (let i = 0; i < bins; i++) {
    out.push({ from: lo + i * width, to: lo + (i + 1) * width, count: 0 });
  }
  out.push({ from: cap, to: Infinity, count: 0 });
  for (const v of values) {
    const idx = v >= cap ? bins : Math.max(0, Math.min(bins - 1, Math.floor((v - lo) / width)));
    out[idx].count++;
  }
  return out;
}

interface Counts {
  success: number;
  backToWork: number;
  squeeze: number;
  ruin: number;
}

/**
 * "Survival": the plan avoided a squeeze and true ruin — clean success PLUS
 * paths that got there only by going back to work. This is the right metric for
 * the solver and tornado ("did the plan work out?"), since back-to-work is a
 * survivable outcome, not a failure.
 */
export function survivalPct(s: MonteCarloSummary): number {
  return s.fullSuccessPct + s.backToWorkPct;
}

/** How many paths' blended return series the summary carries for the spaghetti chart. */
const RETURN_SAMPLE_PATHS = 30;

/** Assemble a summary from a set of finished paths (shared by MC and cohorts). */
function summarize(
  numPaths: number,
  endings: number[],
  squeezeYears: number[],
  ruinYears: number[],
  reentryYearsList: number[],
  squeezePenalties: number[],
  returnPaths: number[][],
  counts: Counts,
  accessibleByYear: number[][],
  cohorts?: CohortResult[],
): MonteCarloSummary {
  const n = Math.max(1, numPaths);
  const p90 = percentile(endings, 0.9);
  const median = (v: number[]) => (v.length ? percentile(v, 0.5) : null);
  return {
    numPaths,
    fullSuccessPct: (100 * counts.success) / n,
    backToWorkPct: (100 * counts.backToWork) / n,
    liquiditySqueezePct: (100 * counts.squeeze) / n,
    trueRuinPct: (100 * counts.ruin) / n,
    medianReentryYears: median(reentryYearsList),
    medianSqueezePenalty: median(squeezePenalties),
    returnPaths,
    endingNetWorthP10: percentile(endings, 0.1),
    endingNetWorthP50: percentile(endings, 0.5),
    endingNetWorthP90: percentile(endings, 0.9),
    medianSqueezeYear: median(squeezeYears),
    medianRuinYear: median(ruinYears),
    histogram: buildHistogram(endings, 30, Math.max(1_000_000, p90 * 1.5)),
    endingNetWorths: endings,
    accessibleP10: accessibleByYear.map((v) => percentile(v, 0.1)),
    accessibleP50: accessibleByYear.map((v) => percentile(v, 0.5)),
    accessibleP90: accessibleByYear.map((v) => percentile(v, 0.9)),
    cohorts,
  };
}

/** Tally a finished path into counts + per-outcome year lists. */
function tally(
  res: PathResult,
  counts: Counts,
  squeezeYears: number[],
  ruinYears: number[],
  reentryYearsList: number[],
  squeezePenalties: number[],
): void {
  if (res.classification === "fullSuccess") counts.success++;
  else if (res.classification === "backToWork") counts.backToWork++;
  else if (res.classification === "liquiditySqueeze") counts.squeeze++;
  else counts.ruin++;
  if (res.firstSqueezeYear !== null) squeezeYears.push(res.firstSqueezeYear);
  if (res.ruinYear !== null) ruinYears.push(res.ruinYear);
  if (res.classification === "backToWork") reentryYearsList.push(res.reentryYears);
  if (res.classification === "liquiditySqueeze") squeezePenalties.push(res.totalPenalties);
}

/**
 * Historical-cohort backtest: run the plan once over each real return sequence.
 * Deterministic (no RNG), so numPaths/seed are ignored; the sample size is the
 * number of available start years.
 */
export function runHistoricalCohorts(inputs: SimInputs): MonteCarloSummary {
  const ctx = buildContext(inputs);
  const starts = cohortStartYears(inputs.horizonYears);
  const endings: number[] = [];
  const squeezeYears: number[] = [];
  const ruinYears: number[] = [];
  const reentryYearsList: number[] = [];
  const squeezePenalties: number[] = [];
  const returnPaths: number[][] = [];
  const counts: Counts = { success: 0, backToWork: 0, squeeze: 0, ruin: 0 };
  const accessibleByYear: number[][] = Array.from({ length: inputs.horizonYears }, () => []);
  const cohorts: CohortResult[] = [];

  for (const startYear of starts) {
    const res = runPath(ctx, cohortPath(startYear, inputs.horizonYears), false);
    endings.push(res.endingNetWorth);
    tally(res, counts, squeezeYears, ruinYears, reentryYearsList, squeezePenalties);
    if (returnPaths.length < RETURN_SAMPLE_PATHS) returnPaths.push(res.blendedSeries);
    for (let t = 0; t < res.accessibleSeries.length; t++) {
      accessibleByYear[t].push(res.accessibleSeries[t]);
    }
    cohorts.push({
      startYear,
      classification: res.classification,
      endingNetWorth: res.endingNetWorth,
      firstSqueezeYear: res.firstSqueezeYear,
      ruinYear: res.ruinYear,
      reentryYears: res.reentryYears,
    });
  }

  return summarize(starts.length, endings, squeezeYears, ruinYears, reentryYearsList, squeezePenalties, returnPaths, counts, accessibleByYear, cohorts);
}

/** Re-run one historical cohort WITH full year records, for the drill-down. */
export function runCohortDetail(inputs: SimInputs, startYear: number): PathResult {
  const ctx = buildContext(inputs);
  const res = runPath(ctx, cohortPath(startYear, inputs.horizonYears), true);
  const { accessibleSeries: _a, blendedSeries: _b, ...pathResult } = res;
  return pathResult;
}

export function runMonteCarlo(inputs: SimInputs): MonteCarloSummary {
  if (inputs.returnModel === "cohorts") return runHistoricalCohorts(inputs);

  const ctx = buildContext(inputs);
  const rng = mulberry32(inputs.seed);
  const n = Math.max(1, inputs.numPaths);

  const endings: number[] = [];
  const squeezeYears: number[] = [];
  const ruinYears: number[] = [];
  const reentryYearsList: number[] = [];
  const squeezePenalties: number[] = [];
  const returnPaths: number[][] = [];
  const counts: Counts = { success: 0, backToWork: 0, squeeze: 0, ruin: 0 };
  // accessibleByYear[t] = accessible wealth across paths, for fan-chart percentiles.
  const accessibleByYear: number[][] = Array.from({ length: inputs.horizonYears }, () => []);

  for (let i = 0; i < n; i++) {
    const returns = generateReturnPath(inputs, rng);
    const res = runPath(ctx, returns, false);
    endings.push(res.endingNetWorth);
    tally(res, counts, squeezeYears, ruinYears, reentryYearsList, squeezePenalties);
    if (returnPaths.length < RETURN_SAMPLE_PATHS) returnPaths.push(res.blendedSeries);
    for (let t = 0; t < res.accessibleSeries.length; t++) {
      accessibleByYear[t].push(res.accessibleSeries[t]);
    }
  }

  return summarize(n, endings, squeezeYears, ruinYears, reentryYearsList, squeezePenalties, returnPaths, counts, accessibleByYear);
}

/**
 * Earliest retirement year for one spouse that reaches the target full-success
 * percentage, holding everything else (including the other spouse's date and
 * the Monte Carlo seed) fixed.
 *
 * Linear scan, NOT binary search: success is not monotone in the retirement
 * year (e.g. long staggered single-earner phases can bleed accessible funds
 * and squeeze paths that an earlier full retirement would have avoided).
 * The scan runs at a reduced path count for speed; a qualifying year is then
 * confirmed at the full path count before being returned.
 */
export function solveRetirementYear(
  baseInputs: SimInputs,
  spouse: "spouseA" | "spouseB",
  targetPct: number,
): SolveResult {
  const key = spouse === "spouseA" ? "retireYearA" : "retireYearB";
  const minYear = baseInputs.startYear;
  // Latest sensible candidate: the spouse's 70th birthday year (or horizon end).
  const age0 = spouse === "spouseA" ? baseInputs.startAgeA : baseInputs.startAgeB;
  const maxYear = Math.min(
    baseInputs.startYear + (70 - age0),
    baseInputs.startYear + baseInputs.horizonYears - 1,
  );

  const scanPaths = Math.min(baseInputs.numPaths, 400);
  const needsConfirm = baseInputs.returnModel !== "cohorts" && scanPaths < baseInputs.numPaths;
  const checked: { year: number; pct: number }[] = [];

  for (let y = minYear; y <= maxYear; y++) {
    const scanPct = survivalPct(runMonteCarlo({ ...baseInputs, numPaths: scanPaths, [key]: y }));
    checked.push({ year: y, pct: scanPct });
    if (scanPct < targetPct) continue;

    let finalPct = scanPct;
    if (needsConfirm) {
      finalPct = survivalPct(runMonteCarlo({ ...baseInputs, [key]: y }));
      if (finalPct < targetPct) continue; // boundary noise — keep scanning
      checked[checked.length - 1] = { year: y, pct: finalPct };
    }
    return { spouse, targetPct, year: y, pct: finalPct, checked };
  }
  return { spouse, targetPct, year: null, pct: null, checked };
}

interface Perturb {
  key: keyof SimInputs;
  label: string;
  make: (v: number, startYear: number) => { low: number; high: number };
  fmt: (v: number) => string;
}

const money = (v: number) => `$${Math.round(v / 1000)}k`;
const pct = (v: number) => `${(v * 100).toFixed(1)}%`;
const yr = (v: number) => String(Math.round(v));

const TORNADO_INPUTS: Perturb[] = [
  { key: "coreSpend", label: "Core spend", make: (v) => ({ low: v * 0.9, high: v * 1.1 }), fmt: money },
  { key: "expectedRealReturn", label: "Expected real return", make: (v) => ({ low: v - 0.01, high: v + 0.01 }), fmt: pct },
  { key: "returnVol", label: "Return volatility", make: (v) => ({ low: Math.max(0.02, v - 0.03), high: v + 0.03 }), fmt: pct },
  // Labels for the two retire years are replaced with the profile's names in runTornado.
  { key: "retireYearA", label: "Spouse A retires", make: (v, s) => ({ low: Math.max(s, v - 2), high: v + 2 }), fmt: yr },
  { key: "retireYearB", label: "Spouse B retires", make: (v, s) => ({ low: Math.max(s, v - 2), high: v + 2 }), fmt: yr },
  { key: "equityPct", label: "Equity allocation", make: (v) => ({ low: Math.max(0, v - 0.15), high: Math.min(1, v + 0.15) }), fmt: pct },
  { key: "reactiveReentryIncome", label: "Re-entry income", make: (v) => ({ low: v * 0.5, high: v * 1.5 }), fmt: money },
  { key: "acaGrossPremium", label: "ACA premium", make: (v) => ({ low: v * 0.7, high: v * 1.3 }), fmt: money },
];

/**
 * One-at-a-time sensitivity ("tornado"): perturb each input to a low and high
 * value, measure the change in full-success %, and rank by swing.
 *
 * Runs in GAUSSIAN mode so every lever — including the return mean and
 * volatility — is actually active; in bootstrap/cohort mode those are ignored
 * and the ranking would understate return sensitivity.
 */
export function runTornado(base: SimInputs): TornadoRow[] {
  const g: SimInputs = { ...base, returnModel: "gaussian", numPaths: Math.min(base.numPaths, 500) };
  const basePct = survivalPct(runMonteCarlo(g));

  const rows: TornadoRow[] = TORNADO_INPUTS.map((spec) => {
    const cur = g[spec.key] as number;
    const { low, high } = spec.make(cur, base.startYear);
    const lowPct = survivalPct(runMonteCarlo({ ...g, [spec.key]: low }));
    const highPct = survivalPct(runMonteCarlo({ ...g, [spec.key]: high }));
    const label =
      spec.key === "retireYearA" ? `${base.nameA} retires`
      : spec.key === "retireYearB" ? `${base.nameB} retires`
      : spec.label;
    return {
      key: spec.key,
      label,
      base: basePct,
      lowPct,
      highPct,
      lowLabel: spec.fmt(low),
      highLabel: spec.fmt(high),
      swing: Math.max(Math.abs(lowPct - basePct), Math.abs(highPct - basePct)),
    };
  });

  return rows.sort((a, b) => b.swing - a.swing);
}
