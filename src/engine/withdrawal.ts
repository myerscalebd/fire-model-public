import { acaNetPremium } from "./aca";
import { pipelineTotal } from "./conversions";
import { fplForHousehold } from "../data/taxTables";
import { computeAnnualTax } from "./tax";
import type { HouseholdState, SimInputs, SpouseAccounts } from "./types";

/** What is unlocked this year (59½ rules, Rule of 55, HSA at 65). */
export interface AccessFlags {
  tradUnlockedA: boolean;
  tradUnlockedB: boolean;
  /** Owner ≥ 59½ — their Roth earnings + pipeline become fully accessible. */
  rothUnlockedA: boolean;
  rothUnlockedB: boolean;
  /** HSA usable for non-medical spending (65+). */
  hsaGeneralUnlocked: boolean;
  /**
   * A 72(t) SEPP is running on this spouse's traditional — an extra penalized
   * draw from it would retroactively bust the SEPP, so the emergency escape
   * valve treats it as the very last resort (non-SEPP spouse drained first).
   */
  seppActiveA?: boolean;
  seppActiveB?: boolean;
  /**
   * Whose buckets drain first at each tier: the OLDER spouse's (they unlock
   * sooner, so the younger spouse's money is the scarcer resource before
   * 59½). Defaults to A when omitted.
   */
  drainFirst?: "A" | "B";
}

/** A concrete withdrawal allocation — solver output, applied verbatim by the sim. */
export interface WithdrawalPlan {
  cash: number;
  taxable: number;
  realizedGains: number;
  /** Per-spouse Roth draw (basis first, then earnings+pipeline if unlocked). */
  rothA: number;
  rothB: number;
  /** Portion of the Roth draw that came from basis (for reporting). */
  rothBasisPart: number;
  tradA: number;
  tradB: number;
  hsaReceiptsFree: number;
  hsaTaxable: number;
  /** Emergency penalized withdrawals from locked traditional. */
  penTradA: number;
  penTradB: number;
  /** Emergency withdrawal of not-yet-seasoned conversions (penalty only, no tax). */
  penPipeA: number;
  penPipeB: number;
  /** Emergency withdrawal of locked Roth earnings (ordinary tax + penalty). */
  penEarnA: number;
  penEarnB: number;
  shortfall: number;
}

/** Everything the plan pulls out of the portfolio, in cash terms. */
export function planTotal(p: WithdrawalPlan): number {
  return (
    p.cash + p.taxable + p.rothA + p.rothB +
    p.tradA + p.tradB + p.hsaReceiptsFree + p.hsaTaxable +
    p.penTradA + p.penTradB +
    p.penPipeA + p.penPipeB + p.penEarnA + p.penEarnB
  );
}

function rothAccessible(sp: SpouseAccounts, unlocked: boolean): number {
  return sp.rothBasis + (unlocked ? sp.rothEarnings + pipelineTotal(sp) : 0);
}

/**
 * Allocate a cash need across the waterfall (spec §5):
 * cash → taxable → accessible Roth → unlocked traditional → HSA →
 * (emergency) penalized locked traditional. Within each tier the spouse named
 * by access.drainFirst (the older one) is drawn before the other.
 */
export function allocateWithdrawals(
  state: HouseholdState,
  access: AccessFlags,
  need: number,
): WithdrawalPlan {
  const p: WithdrawalPlan = {
    cash: 0, taxable: 0, realizedGains: 0,
    rothA: 0, rothB: 0, rothBasisPart: 0,
    tradA: 0, tradB: 0,
    hsaReceiptsFree: 0, hsaTaxable: 0,
    penTradA: 0, penTradB: 0,
    penPipeA: 0, penPipeB: 0,
    penEarnA: 0, penEarnB: 0,
    shortfall: 0,
  };
  let left = need;
  const take = (avail: number) => {
    const amt = Math.min(avail, left);
    left -= amt;
    return amt;
  };

  p.cash = take(state.cash);
  p.taxable = take(state.taxable.value);
  if (p.taxable > 0 && state.taxable.value > 0) {
    const gainFrac = Math.max(0, 1 - state.taxable.basis / state.taxable.value);
    p.realizedGains = p.taxable * gainFrac;
  }

  const order: Array<"A" | "B"> = access.drainFirst === "B" ? ["B", "A"] : ["A", "B"];
  const sp = (s: "A" | "B") => (s === "A" ? state.spouseA : state.spouseB);
  const unlocked = (s: "A" | "B") => (s === "A" ? access.rothUnlockedA : access.rothUnlockedB);
  const tradUnlocked = (s: "A" | "B") => (s === "A" ? access.tradUnlockedA : access.tradUnlockedB);

  for (const s of order) p[`roth${s}` as const] = take(rothAccessible(sp(s), unlocked(s)));
  p.rothBasisPart =
    Math.min(p.rothB, state.spouseB.rothBasis) + Math.min(p.rothA, state.spouseA.rothBasis);

  for (const s of order) if (tradUnlocked(s)) p[`trad${s}` as const] = take(sp(s).trad);

  p.hsaReceiptsFree = take(Math.min(state.hsa, state.hsaReceipts));
  if (access.hsaGeneralUnlocked) p.hsaTaxable = take(state.hsa - p.hsaReceiptsFree);

  // Escape valves, cheapest first. Unseasoned conversions cost only the 10%
  // penalty (tax was paid at conversion); locked trad and Roth earnings cost
  // ordinary tax + penalty. Only relevant for still-locked owners — an
  // unlocked owner's pipeline/earnings were already counted above.
  for (const s of order) if (!unlocked(s)) p[`penPipe${s}` as const] = take(pipelineTotal(sp(s)));
  // Locked trad: drain any non-SEPP account before touching a SEPP-active one
  // (an extra draw from a SEPP account busts it — absolute last resort).
  const seppActive = (s: "A" | "B") => !!(s === "A" ? access.seppActiveA : access.seppActiveB);
  const tradOrder = [...order].sort((a, b) => Number(seppActive(a)) - Number(seppActive(b)));
  for (const s of tradOrder) {
    if (!tradUnlocked(s)) p[`penTrad${s}` as const] = take(sp(s).trad - p[`trad${s}` as const]);
  }
  for (const s of order) if (!unlocked(s)) p[`penEarn${s}` as const] = take(sp(s).rothEarnings);

  p.shortfall = left;
  return p;
}

export interface FundingContext {
  /** Spend before healthcare and taxes (core + childcare + housing + escrow). */
  fixedSpend: number;
  /** After-tax cash income (employment take-home + re-entry). */
  netIncome: number;
  /** Ordinary income arriving regardless of withdrawals (pension + conversions). */
  baseOrdinary: number;
  /** Pension + other pre-tax cash that arrives as income (real $). */
  pensionCash: number;
  ssGross: number;
  /** Gross ACA premium if the household needs marketplace coverage, else 0. */
  acaGross: number;
  /** Medicare share of healthcare cost (fixed, not MAGI-dependent). */
  medicareCost: number;
}

export interface FundingResult {
  plan: WithdrawalPlan;
  taxes: number;
  penalty: number;
  acaCost: number;
  healthcare: number;
  /** Cash left over (invested into taxable). */
  surplus: number;
  magi: number;
}

/**
 * Fixed-point solve: taxes depend on withdrawals, the ACA premium depends on
 * MAGI, and both change how much must be withdrawn. Iterate to convergence.
 */
export function solveFunding(
  state: HouseholdState,
  access: AccessFlags,
  ctx: FundingContext,
  inputs: SimInputs,
): FundingResult {
  let plan = allocateWithdrawals(state, access, 0);
  let taxes = 0;
  let penalty = 0;
  let acaCost = 0;
  let prevNeed = -1;
  const fpl = fplForHousehold(inputs.householdSize);
  const stateTax = { stateRate: inputs.stateTaxRate, stateExemption: inputs.stateTaxExemption };

  const ordinaryOf = (p: WithdrawalPlan) =>
    ctx.baseOrdinary +
    p.tradA + p.tradB +
    p.hsaTaxable +
    p.penTradA + p.penTradB +
    p.penEarnA + p.penEarnB;
  const penaltyOf = (p: WithdrawalPlan) =>
    inputs.penaltyRate *
    (p.penTradA + p.penTradB +
      p.penPipeA + p.penPipeB +
      p.penEarnA + p.penEarnB);

  for (let i = 0; i < 40; i++) {
    const spend = ctx.fixedSpend + acaCost + ctx.medicareCost;
    const inflows = ctx.netIncome + ctx.pensionCash + ctx.ssGross;
    const need = Math.max(0, spend + taxes + penalty - inflows);
    plan = allocateWithdrawals(state, access, need);

    const tax = computeAnnualTax({
      ordinaryIncome: ordinaryOf(plan),
      ltcg: plan.realizedGains,
      ssGross: ctx.ssGross,
      ...stateTax,
    });
    penalty = penaltyOf(plan);
    taxes = tax.total;
    acaCost = ctx.acaGross > 0 ? acaNetPremium(tax.magi, ctx.acaGross, fpl) : 0;

    if (Math.abs(need - prevNeed) < 0.5) break;
    prevNeed = need;
  }

  // Recompute the reported figures from the final plan so they're mutually
  // consistent even when the ACA cliff prevents an exact fixed point.
  const finalTax = computeAnnualTax({
    ordinaryIncome: ordinaryOf(plan),
    ltcg: plan.realizedGains,
    ssGross: ctx.ssGross,
    ...stateTax,
  });
  taxes = finalTax.total;
  penalty = penaltyOf(plan);
  acaCost = ctx.acaGross > 0 ? acaNetPremium(finalTax.magi, ctx.acaGross, fpl) : 0;
  const spend = ctx.fixedSpend + acaCost + ctx.medicareCost;
  const inflows = ctx.netIncome + ctx.pensionCash + ctx.ssGross;
  const surplus = Math.max(0, inflows + planTotal(plan) - spend - taxes - penalty);

  return {
    plan,
    taxes,
    penalty,
    acaCost,
    healthcare: acaCost + ctx.medicareCost,
    surplus,
    magi: finalTax.magi,
  };
}
