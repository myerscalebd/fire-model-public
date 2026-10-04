import { CPI_INFLATION, FIRST_YEAR, REAL_BOND_RETURNS, REAL_RETURNS } from "../data/historicalReturns";
import type { SimInputs, YearReturns } from "./types";

/** Deterministic 32-bit PRNG — seeded so Monte Carlo runs are reproducible. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Standard normal via Box–Muller. */
export function makeGaussian(rng: () => number): () => number {
  let spare: number | null = null;
  return () => {
    if (spare !== null) {
      const v = spare;
      spare = null;
      return v;
    }
    let u = 0;
    while (u === 0) u = rng();
    const v = rng();
    const mag = Math.sqrt(-2 * Math.log(u));
    spare = mag * Math.sin(2 * Math.PI * v);
    return mag * Math.cos(2 * Math.PI * v);
  };
}

const mean = (v: number[]) => v.reduce((a, b) => a + b, 0) / v.length;
const STOCK_MEAN = mean(REAL_RETURNS);
const BOND_MEAN = mean(REAL_BOND_RETURNS);

/**
 * One path of `horizonYears` annual real {stock, bond} returns.
 * - gaussian: independent IID draws per asset — understates sequence risk.
 * - bootstrap: contiguous multi-year blocks sampled (with wrap-around) from
 *   1928–2023; the SAME sampled years are used for both assets, preserving
 *   the historical stock/bond correlation, autocorrelation, and fat tails.
 *   Optional mean shift moves each asset to its expected-return assumption.
 */
export function generateReturnPath(inputs: SimInputs, rng: () => number): YearReturns[] {
  const n = inputs.horizonYears;
  const out: YearReturns[] = [];
  if (inputs.returnModel === "gaussian") {
    const g = makeGaussian(rng);
    for (let i = 0; i < n; i++) {
      out.push({
        stock: inputs.expectedRealReturn + inputs.returnVol * g(),
        bond: inputs.bondRealReturn + inputs.bondVol * g(),
        inflation: inputs.inflation,
      });
    }
    return out;
  }
  // Bootstrap: carry each sampled year's ACTUAL inflation alongside its returns,
  // so a resampled 1970s block erodes the nominal mortgage at 1970s inflation.
  const stockShift = inputs.bootstrapMatchMean ? inputs.expectedRealReturn - STOCK_MEAN : 0;
  const bondShift = inputs.bootstrapMatchMean ? inputs.bondRealReturn - BOND_MEAN : 0;
  const block = Math.max(1, Math.round(inputs.bootstrapBlockYears));
  const len = REAL_RETURNS.length;
  while (out.length < n) {
    const start = Math.floor(rng() * len);
    for (let j = 0; j < block && out.length < n; j++) {
      const idx = (start + j) % len;
      out.push({
        stock: REAL_RETURNS[idx] + stockShift,
        bond: REAL_BOND_RETURNS[idx] + bondShift,
        inflation: CPI_INFLATION[idx],
      });
    }
  }
  return out;
}

/** Flat expected-return path for the deterministic projection. */
export function deterministicPath(inputs: SimInputs): YearReturns[] {
  return Array.from({ length: inputs.horizonYears }, () => ({
    stock: inputs.expectedRealReturn,
    bond: inputs.bondRealReturn,
    inflation: inputs.inflation,
  }));
}

/** Test/scripting helper: a path where both assets return `r` every year. */
export function flatPath(horizonYears: number, r: number, inflation = 0.025): YearReturns[] {
  return Array.from({ length: horizonYears }, () => ({ stock: r, bond: r, inflation }));
}

/**
 * Historical-cohort backtest: every start year for which the full horizon of
 * ACTUAL contiguous real returns exists. No resampling and no mean shift — this
 * replays the real sequence (Depression, 1970s, lost decade) in its true order.
 * With 1928–2023 data and a 50-year horizon: start years 1928–1974 (47 cohorts).
 */
export function cohortStartYears(horizonYears: number): number[] {
  const count = REAL_RETURNS.length - horizonYears + 1;
  const out: number[] = [];
  for (let i = 0; i < count; i++) out.push(FIRST_YEAR + i);
  return out;
}

export function cohortPath(startYear: number, horizonYears: number): YearReturns[] {
  const offset = startYear - FIRST_YEAR;
  return Array.from({ length: horizonYears }, (_, j) => ({
    stock: REAL_RETURNS[offset + j],
    bond: REAL_BOND_RETURNS[offset + j],
    inflation: CPI_INFLATION[offset + j],
  }));
}
