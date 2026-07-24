import { acaNetPremium } from "./aca";
import { pipelineTotal } from "./conversions";
import { computeAnnualTax } from "./tax";
import type { HouseholdState, SimInputs, SpouseAccounts } from "./types";

/** What is unlocked this year (59½ rules, Rule of 55, HSA at 65). */
export interface AccessFlags {
  calebTradUnlocked: boolean;
  katyTradUnlocked: boolean;
  /** Owner ≥ 59½ — their Roth earnings + pipeline become fully accessible. */
  calebRothUnlocked: boolean;
  katyRothUnlocked: boolean;
  /** HSA usable for non-medical spending (65+). */
  hsaGeneralUnlocked: boolean;
  /**
   * A 72(t) SEPP is running on this spouse's traditional — an extra penalized
   * draw from it would retroactively bust the SEPP, so the emergency escape
   * valve treats it as the very last resort (non-SEPP spouse drained first).
   */
  calebSeppActive?: boolean;
  katySeppActive?: boolean;
}

/** A concrete withdrawal allocation — solver output, applied verbatim by the sim. */
export interface WithdrawalPlan {
  cash: number;
  taxable: number;
  realizedGains: number;
  /** Per-spouse Roth draw (basis first, then earnings+pipeline if unlocked). */
  rothCaleb: number;
  rothKaty: number;
  /** Portion of the Roth draw that came from basis (for reporting). */
  rothBasisPart: number;
  tradCaleb: number;
  tradKaty: number;
  hsaReceiptsFree: number;
  hsaTaxable: number;
  /** Emergency penalized withdrawals from locked traditional. */
  penTradCaleb: number;
  penTradKaty: number;
  /** Emergency withdrawal of not-yet-seasoned conversions (penalty only, no tax). */
  penPipeCaleb: number;
  penPipeKaty: number;
  /** Emergency withdrawal of locked Roth earnings (ordinary tax + penalty). */
  penEarnCaleb: number;
  penEarnKaty: number;
  shortfall: number;
}

/** Everything the plan pulls out of the portfolio, in cash terms. */
export function planTotal(p: WithdrawalPlan): number {
  return (
    p.cash + p.taxable + p.rothCaleb + p.rothKaty +
    p.tradCaleb + p.tradKaty + p.hsaReceiptsFree + p.hsaTaxable +
    p.penTradCaleb + p.penTradKaty +
    p.penPipeCaleb + p.penPipeKaty + p.penEarnCaleb + p.penEarnKaty
  );
}

function rothAccessible(sp: SpouseAccounts, unlocked: boolean): number {
  return sp.rothBasis + (unlocked ? sp.rothEarnings + pipelineTotal(sp) : 0);
}

/**
 * Allocate a cash need across the waterfall (spec §5):
 * cash → taxable → accessible Roth → unlocked traditional → HSA →
 * (emergency) penalized locked traditional. Katy's buckets drain before
 * Caleb's — she unlocks four years sooner, so his money is scarcer pre-59½.
 */
export function allocateWithdrawals(
  state: HouseholdState,
  access: AccessFlags,
  need: number,
): WithdrawalPlan {
  const p: WithdrawalPlan = {
    cash: 0, taxable: 0, realizedGains: 0,
    rothCaleb: 0, rothKaty: 0, rothBasisPart: 0,
    tradCaleb: 0, tradKaty: 0,
    hsaReceiptsFree: 0, hsaTaxable: 0,
    penTradCaleb: 0, penTradKaty: 0,
    penPipeCaleb: 0, penPipeKaty: 0,
    penEarnCaleb: 0, penEarnKaty: 0,
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

  const katyRothAvail = rothAccessible(state.katy, access.katyRothUnlocked);
  p.rothKaty = take(katyRothAvail);
  const calebRothAvail = rothAccessible(state.caleb, access.calebRothUnlocked);
  p.rothCaleb = take(calebRothAvail);
  p.rothBasisPart =
    Math.min(p.rothKaty, state.katy.rothBasis) + Math.min(p.rothCaleb, state.caleb.rothBasis);

  if (access.katyTradUnlocked) p.tradKaty = take(state.katy.trad);
  if (access.calebTradUnlocked) p.tradCaleb = take(state.caleb.trad);

  p.hsaReceiptsFree = take(Math.min(state.hsa, state.hsaReceipts));
  if (access.hsaGeneralUnlocked) p.hsaTaxable = take(state.hsa - p.hsaReceiptsFree);

  // Escape valves, cheapest first. Unseasoned conversions cost only the 10%
  // penalty (tax was paid at conversion); locked trad and Roth earnings cost
  // ordinary tax + penalty. Only relevant for still-locked owners — an
  // unlocked owner's pipeline/earnings were already counted above.
  if (!access.katyRothUnlocked) p.penPipeKaty = take(pipelineTotal(state.katy));
  if (!access.calebRothUnlocked) p.penPipeCaleb = take(pipelineTotal(state.caleb));
  // Locked trad: drain any non-SEPP account before touching a SEPP-active one
  // (an extra draw from a SEPP account busts it — absolute last resort).
  const tradDraws: Array<[boolean, () => void]> = [
    [!!access.katySeppActive, () => { if (!access.katyTradUnlocked) p.penTradKaty = take(state.katy.trad - p.tradKaty); }],
    [!!access.calebSeppActive, () => { if (!access.calebTradUnlocked) p.penTradCaleb = take(state.caleb.trad - p.tradCaleb); }],
  ];
  tradDraws.sort((a, b) => Number(a[0]) - Number(b[0]));
  for (const [, draw] of tradDraws) draw();
  if (!access.katyRothUnlocked) p.penEarnKaty = take(state.katy.rothEarnings);
  if (!access.calebRothUnlocked) p.penEarnCaleb = take(state.caleb.rothEarnings);

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

  const ordinaryOf = (p: WithdrawalPlan) =>
    ctx.baseOrdinary +
    p.tradCaleb + p.tradKaty +
    p.hsaTaxable +
    p.penTradCaleb + p.penTradKaty +
    p.penEarnCaleb + p.penEarnKaty;
  const penaltyOf = (p: WithdrawalPlan) =>
    inputs.penaltyRate *
    (p.penTradCaleb + p.penTradKaty +
      p.penPipeCaleb + p.penPipeKaty +
      p.penEarnCaleb + p.penEarnKaty);

  for (let i = 0; i < 40; i++) {
    const spend = ctx.fixedSpend + acaCost + ctx.medicareCost;
    const inflows = ctx.netIncome + ctx.pensionCash + ctx.ssGross;
    const need = Math.max(0, spend + taxes + penalty - inflows);
    plan = allocateWithdrawals(state, access, need);

    const tax = computeAnnualTax({
      ordinaryIncome: ordinaryOf(plan),
      ltcg: plan.realizedGains,
      ssGross: ctx.ssGross,
    });
    penalty = penaltyOf(plan);
    taxes = tax.total;
    acaCost = ctx.acaGross > 0 ? acaNetPremium(tax.magi, ctx.acaGross) : 0;

    if (Math.abs(need - prevNeed) < 0.5) break;
    prevNeed = need;
  }

  // Recompute the reported figures from the final plan so they're mutually
  // consistent even when the ACA cliff prevents an exact fixed point.
  const finalTax = computeAnnualTax({
    ordinaryIncome: ordinaryOf(plan),
    ltcg: plan.realizedGains,
    ssGross: ctx.ssGross,
  });
  taxes = finalTax.total;
  penalty = penaltyOf(plan);
  acaCost = ctx.acaGross > 0 ? acaNetPremium(finalTax.magi, ctx.acaGross) : 0;
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
