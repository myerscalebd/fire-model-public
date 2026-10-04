import { initialState } from "../data/accounts";
import { FED_STD_DEDUCTION_MFJ, singleLifeExpectancy } from "../data/taxTables";
import { convert, maturePipeline, pipelineTotal } from "./conversions";
import { amortize, type AmortSchedule } from "./mortgage";
import type {
  Classification,
  HouseholdState,
  PathResult,
  SimInputs,
  SpouseAccounts,
  YearRecord,
  YearReturns,
} from "./types";
import {
  allocateWithdrawals,
  planTotal,
  solveFunding,
  type AccessFlags,
  type WithdrawalPlan,
} from "./withdrawal";

/** Months of mortgage payments in the (June-start) first model year. */
const FIRST_YEAR_MONTHS = 7;

export interface SimContext {
  inputs: SimInputs;
  amort: AmortSchedule;
}

export function buildContext(inputs: SimInputs): SimContext {
  return {
    inputs,
    amort: amortize({
      balance: inputs.mortgageBalance0,
      annualRate: inputs.mortgageRate,
      monthlyPI: inputs.mortgageMonthlyPI,
      extraMonthly: inputs.prepay ? inputs.extraPrincipalMonthly : 0,
      monthsInFirstYear: FIRST_YEAR_MONTHS,
      horizonYears: inputs.horizonYears,
    }),
  };
}

function drainRoth(sp: SpouseAccounts, amount: number): void {
  let left = amount;
  const fromBasis = Math.min(sp.rothBasis, left);
  sp.rothBasis -= fromBasis;
  left -= fromBasis;
  const fromEarnings = Math.min(sp.rothEarnings, left);
  sp.rothEarnings -= fromEarnings;
  left -= fromEarnings;
  for (const e of sp.rothPipeline) {
    if (left <= 0) break;
    const take = Math.min(e.amount, left);
    e.amount -= take;
    left -= take;
  }
  sp.rothPipeline = sp.rothPipeline.filter((e) => e.amount > 0.005);
}

function drainPipeline(sp: SpouseAccounts, amount: number): void {
  let left = amount;
  for (const e of sp.rothPipeline) {
    if (left <= 0) break;
    const take = Math.min(e.amount, left);
    e.amount -= take;
    left -= take;
  }
  sp.rothPipeline = sp.rothPipeline.filter((e) => e.amount > 0.005);
}

function applyPlan(state: HouseholdState, plan: WithdrawalPlan, surplus: number): void {
  state.cash -= plan.cash;
  const gainPart = plan.realizedGains;
  state.taxable.value -= plan.taxable;
  state.taxable.basis = Math.max(0, state.taxable.basis - (plan.taxable - gainPart));
  drainRoth(state.spouseB, plan.rothB);
  drainRoth(state.spouseA, plan.rothA);
  state.spouseB.trad -= plan.tradB + plan.penTradB;
  state.spouseA.trad -= plan.tradA + plan.penTradA;
  drainPipeline(state.spouseB, plan.penPipeB);
  drainPipeline(state.spouseA, plan.penPipeA);
  state.spouseB.rothEarnings -= plan.penEarnB;
  state.spouseA.rothEarnings -= plan.penEarnA;
  state.hsa -= plan.hsaReceiptsFree + plan.hsaTaxable;
  state.hsaReceipts -= plan.hsaReceiptsFree;
  // Leftover cash is invested in the taxable brokerage at full basis.
  state.taxable.value += surplus;
  state.taxable.basis += surplus;
}

function grow(state: HouseholdState, r: number): void {
  state.taxable.value = Math.max(0, state.taxable.value * (1 + r));
  for (const sp of [state.spouseA, state.spouseB]) {
    const total = sp.rothBasis + sp.rothEarnings + pipelineTotal(sp);
    sp.rothEarnings += total * r;
    if (sp.rothEarnings < 0) {
      // Losses beyond accumulated earnings eat into withdrawable basis.
      sp.rothBasis = Math.max(0, sp.rothBasis + sp.rothEarnings);
      sp.rothEarnings = 0;
    }
    sp.trad = Math.max(0, sp.trad * (1 + r));
  }
  state.hsa = Math.max(0, state.hsa * (1 + r));
  // Cash holds real value (assumed to earn ~inflation nominally).
}

function accessibleTotal(state: HouseholdState, access: AccessFlags): number {
  let acc = state.cash + state.taxable.value;
  acc += state.spouseB.rothBasis +
    (access.rothUnlockedB ? state.spouseB.rothEarnings + pipelineTotal(state.spouseB) : 0);
  acc += state.spouseA.rothBasis +
    (access.rothUnlockedA ? state.spouseA.rothEarnings + pipelineTotal(state.spouseA) : 0);
  if (access.tradUnlockedB) acc += state.spouseB.trad;
  if (access.tradUnlockedA) acc += state.spouseA.trad;
  acc += Math.min(state.hsa, state.hsaReceipts);
  if (access.hsaGeneralUnlocked) acc += Math.max(0, state.hsa - state.hsaReceipts);
  return acc;
}

function totalWealth(state: HouseholdState): number {
  return (
    state.cash + state.taxable.value +
    state.spouseA.rothBasis + state.spouseA.rothEarnings + pipelineTotal(state.spouseA) +
    state.spouseB.rothBasis + state.spouseB.rothEarnings + pipelineTotal(state.spouseB) +
    state.spouseA.trad + state.spouseB.trad + state.hsa
  );
}

/**
 * Equity weight for year t. Without a glidepath it's flat; with one it forms a
 * "bond tent": normal while working, de-risked during the fully-retired
 * pre-59½ bridge, re-risked once the younger spouse unlocks.
 */
function equityWeight(inputs: SimInputs, anyWorking: boolean, youngerAge: number): number {
  if (!inputs.glidepathEnabled) return inputs.equityPct;
  if (youngerAge >= inputs.unlockAge) return inputs.equityPctLate;
  if (!anyWorking) return inputs.equityPctBridge;
  return inputs.equityPct;
}

/** Annual 72(t) fixed-amortization payment: balance amortized over the IRS
 *  single-life expectancy at the owner's attained age, at `rate`. */
export function sepp72tPayment(balance: number, age: number, rate: number): number {
  const le = singleLifeExpectancy(age);
  if (rate <= 0) return balance / le;
  return (balance * rate) / (1 - Math.pow(1 + rate, -le));
}

/**
 * Run one full path of the projection over `returns` (one {stock, bond} pair
 * per year; the whole portfolio is rebalanced annually to the year's equity
 * weight). Set keepRecords=false in Monte Carlo to save memory.
 */
export function runPath(
  ctx: SimContext,
  returns: YearReturns[],
  keepRecords = true,
): PathResult & { accessibleSeries: number[]; blendedSeries: number[] } {
  const inputs = ctx.inputs;
  const state = initialState(inputs);
  const years: YearRecord[] = [];
  const accessibleSeries: number[] = [];
  let firstSqueezeYear: number | null = null;
  let ruinYear: number | null = null;
  let firstReentryYear: number | null = null;
  let reentryYears = 0;
  let totalPenalties = 0;
  // Remaining committed years of a reactive re-entry stint (carries across years).
  let reentryYearsRemaining = 0;
  // Realized blended portfolio return per year (feeds the floor-spending rule).
  const blendedReturns: number[] = [];
  // Guyton-Klinger guardrail state (persists across years).
  let spendMultiplier = 1;
  let lastWithdrawalRate: number | null = null;

  // Age at which each spouse's trad/Roth-earnings unlock (integer-year proxy for 59½).
  const UNLOCK_AGE = inputs.unlockAge;
  const tUnlockA = UNLOCK_AGE - inputs.startAgeA;
  const tUnlockB = UNLOCK_AGE - inputs.startAgeB;
  // 72(t) SEPP state: payment is fixed in NOMINAL dollars at the start year.
  const sepp = {
    spouseA: { nominal: null as number | null },
    spouseB: { nominal: null as number | null },
  };
  // Cumulative price level: nominal→real deflator, built from each year's actual
  // inflation (real historical CPI under cohort/bootstrap, flat otherwise).
  let deflator = 1;

  for (let t = 0; t < inputs.horizonYears; t++) {
    const year = inputs.startYear + t;
    const ageA = inputs.startAgeA + t;
    const ageB = inputs.startAgeB + t;
    // The younger spouse's age gates the household-wide milestones (bridge end,
    // re-risking, guardrail raises, re-entry, HSA).
    const youngerAge = Math.min(ageA, ageB);
    const workingA = year < inputs.retireYearA;
    const workingB = year < inputs.retireYearB;
    const anyWorking = workingA || workingB;
    // Annual rebalance: whole portfolio earns the weighted stock/bond return.
    const w = equityWeight(inputs, anyWorking, youngerAge);
    const r = w * returns[t].stock + (1 - w) * returns[t].bond;
    blendedReturns.push(r);

    // --- Unlocks ---
    const ruleOf55Ok = (age0: number, retireYear: number) =>
      age0 + (retireYear - 1 - inputs.startYear) >= inputs.ruleOf55Age;
    const seppActiveNow = (enabled: boolean, startYear: number, age: number) =>
      enabled && year >= startYear && !(year - startYear >= 5 && age >= UNLOCK_AGE);
    const seppA = seppActiveNow(inputs.sepp72tA, inputs.sepp72tStartYearA, ageA);
    const seppB = seppActiveNow(inputs.sepp72tB, inputs.sepp72tStartYearB, ageB);
    const access: AccessFlags = {
      tradUnlockedA:
        ageA >= UNLOCK_AGE ||
        (inputs.ruleOf55A && !workingA && ruleOf55Ok(inputs.startAgeA, inputs.retireYearA)),
      tradUnlockedB:
        ageB >= UNLOCK_AGE ||
        (inputs.ruleOf55B && !workingB && ruleOf55Ok(inputs.startAgeB, inputs.retireYearB)),
      rothUnlockedA: ageA >= UNLOCK_AGE,
      rothUnlockedB: ageB >= UNLOCK_AGE,
      hsaGeneralUnlocked: youngerAge >= inputs.hsaUnlockAge,
      seppActiveA: seppA,
      seppActiveB: seppB,
      // Older spouse unlocks first, so their buckets are spent first.
      drainFirst: inputs.startAgeB > inputs.startAgeA ? "B" : "A",
    };

    // --- 72(t) SEPP distributions (forced while active, penalty-free) ---
    // Active from the start year until the LATER of 5 payment-years or the
    // owner reaching 59½. The payment is computed once from the balance at the
    // start year and stays fixed in nominal dollars, so its real value erodes
    // with realized inflation.
    let sepp72t = 0;
    const runSepp = (
      who: "spouseA" | "spouseB",
      enabled: boolean,
      startYear: number,
      sp: SpouseAccounts,
      age: number,
    ) => {
      if (!enabled || year < startYear) return 0;
      const done = year - startYear >= 5 && age >= UNLOCK_AGE;
      if (done) return 0;
      if (sepp[who].nominal === null) {
        if (year !== startYear || sp.trad <= 0) return 0; // can't start late or empty
        sepp[who].nominal = sepp72tPayment(sp.trad, age, inputs.sepp72tRate) * deflator;
      }
      const real = Math.min(sepp[who].nominal / deflator, sp.trad);
      sp.trad -= real;
      return real;
    };
    sepp72t += runSepp("spouseA", inputs.sepp72tA, inputs.sepp72tStartYearA, state.spouseA, ageA);
    sepp72t += runSepp("spouseB", inputs.sepp72tB, inputs.sepp72tStartYearB, state.spouseB, ageB);

    // --- Start-of-year housekeeping ---
    maturePipeline(state.spouseA, t);
    maturePipeline(state.spouseB, t);
    state.hsaReceipts += inputs.hsaAnnualReceipts;

    // --- Income & contributions ---
    let employmentIncome = 0;
    if (workingA) {
      employmentIncome += inputs.netIncomeA;
      state.spouseA.trad += inputs.contribTradA;
      state.spouseA.rothBasis += inputs.contribRothA;
    }
    if (workingB) {
      employmentIncome += inputs.netIncomeB;
      state.spouseB.trad += inputs.contribTradB;
      state.spouseB.rothBasis += inputs.contribRothB;
    }
    if (!anyWorking) employmentIncome += inputs.reentryIncome;

    const pensionIncome =
      (inputs.pensionOwner === "B" ? ageB : ageA) >= inputs.pensionStartAge
        ? inputs.pensionAnnual / deflator
        : 0;
    const ssIncome =
      (ageA >= inputs.ssStartAge ? inputs.ssA : 0) +
      (ageB >= inputs.ssStartAge ? inputs.ssB : 0);

    // --- Spending ---
    // Guardrails: ratchet the persistent multiplier off last year's withdrawal
    // rate. Cuts fire at any age (pure downside protection); RAISES are held
    // back until the 59½ bridge is over — lifestyle-inflating while money is
    // still trapped behind the wall just feeds the liquidity squeeze.
    if (inputs.guardrailsEnabled && !anyWorking && lastWithdrawalRate !== null) {
      if (lastWithdrawalRate > inputs.guardrailUpperRate) {
        spendMultiplier = Math.max(inputs.guardrailMinMult, spendMultiplier * (1 - inputs.guardrailAdjustPct));
      } else if (lastWithdrawalRate < inputs.guardrailLowerRate && youngerAge >= UNLOCK_AGE) {
        spendMultiplier = Math.min(inputs.guardrailMaxMult, spendMultiplier * (1 + inputs.guardrailAdjustPct));
      }
    }
    const effMultiplier = inputs.guardrailsEnabled ? spendMultiplier : 1;
    let coreSpend = inputs.coreSpend * effMultiplier;
    if (inputs.floorEnabled && t > 0 && blendedReturns[t - 1] <= inputs.floorTriggerReturn) {
      coreSpend = Math.max(0, coreSpend - inputs.floorCutAmount);
    }
    const childcare = year <= inputs.childcareLastYear ? inputs.childcareAnnual : 0;

    const amortRow = ctx.amort.rows[t];
    const mortgageActive = amortRow.piPaid > 0;
    const housingPI = (amortRow.piPaid + amortRow.extraPaid) / deflator;
    // If not prepaying, the $1k/mo is redirected to taxable — but only while
    // salary funds it; once retired, redirecting portfolio money into the
    // portfolio would be a no-op, so the budget line simply disappears.
    const redirected =
      !inputs.prepay && mortgageActive && anyWorking
        ? (inputs.extraPrincipalMonthly * amortRow.piPaid) / inputs.mortgageMonthlyPI / deflator
        : 0;

    const fixedSpend = coreSpend + childcare + housingPI + inputs.escrowAnnual + redirected;

    // Healthcare: employer coverage while anyone works; else ACA / Medicare.
    const num65 = (ageA >= inputs.medicareAge ? 1 : 0) + (ageB >= inputs.medicareAge ? 1 : 0);
    let acaGross = 0;
    let medicareCost = 0;
    if (!anyWorking) {
      medicareCost = (num65 / 2) * inputs.medicareAnnualCouple;
      if (num65 === 0) acaGross = inputs.acaGrossPremium;
      else if (num65 === 1) acaGross = inputs.acaGrossPremium * 0.45;
    }

    // --- Reactive re-entry (someone goes back to work when squeezed) ---
    // Checked against accessible funds BEFORE this year's withdrawals. Starts a
    // multi-year stint once accessible drops below N years of NET burn (spend
    // minus income already coming in); keeps working until it recovers.
    // Available whenever at least one spouse is retired — in a staggered phase
    // the retired spouse is the one who returns — while the younger spouse is
    // still of working age.
    let reentryReactive = 0;
    const someoneRetired = !workingA || !workingB;
    if (someoneRetired && inputs.reactiveReentryEnabled && youngerAge <= inputs.reactiveReentryMaxAge) {
      const spendEstimate = fixedSpend + acaGross + medicareCost;
      const netBurn = Math.max(0, spendEstimate - (employmentIncome + pensionIncome + ssIncome + sepp72t));
      const threshold = inputs.reactiveReentryTriggerYears * Math.max(netBurn, spendEstimate / 4);
      const accessibleNow = accessibleTotal(state, access);
      if (reentryYearsRemaining > 0) {
        reentryReactive = inputs.reactiveReentryIncome;
        reentryYearsRemaining--;
      } else if (netBurn > 0 && accessibleNow < threshold) {
        reentryReactive = inputs.reactiveReentryIncome;
        reentryYearsRemaining = Math.max(0, inputs.reactiveReentryMinYears - 1);
      }
      employmentIncome += reentryReactive;
      if (reentryReactive > 0) {
        reentryYears++;
        if (firstReentryYear === null) firstReentryYear = year;
      }
    }

    // --- Roth conversion ladder (retired years, while traditional is locked) ---
    // Guard: converting costs tax + ACA subsidy NOW to buy liquidity in 5
    // years. A household whose accessible funds are already thin would stop —
    // require ~2 years of spending on hand before laddering.
    let conversion = 0;
    // A SEPP-active spouse's traditional can't be touched by the ladder —
    // converting from it is a "modification" that busts the SEPP retroactively.
    const convertibleTrad =
      (access.tradUnlockedA || seppA ? 0 : state.spouseA.trad) +
      (access.tradUnlockedB || seppB ? 0 : state.spouseB.trad);
    const readyFunds =
      state.cash + state.taxable.value + state.spouseA.rothBasis + state.spouseB.rothBasis;
    const spendEstimate = fixedSpend + acaGross + medicareCost;
    if (
      !anyWorking &&
      inputs.conversionMode !== "off" &&
      convertibleTrad > 0.5 &&
      readyFunds > 2 * spendEstimate
    ) {
      let target = 0;
      if (inputs.conversionMode === "fixed") {
        target = inputs.conversionFixed;
      } else {
        // Fill ordinary income up to the bracket top (+ standard deduction).
        const otherOrdinary = pensionIncome + 0.85 * ssIncome + sepp72t;
        target = inputs.conversionBracketTop + FED_STD_DEDUCTION_MFJ - otherOrdinary;
      }
      const lockedSpouses = [];
      if (!access.tradUnlockedA && !seppA)
        lockedSpouses.push({ sp: state.spouseA, unlockT: tUnlockA });
      if (!access.tradUnlockedB && !seppB)
        lockedSpouses.push({ sp: state.spouseB, unlockT: tUnlockB });
      conversion = convert(lockedSpouses, Math.max(0, Math.min(target, convertibleTrad)), t);
    }

    // --- Solve funding (withdrawals + taxes + ACA fixed point) ---
    const lockedBefore =
      (access.tradUnlockedA ? 0 : state.spouseA.trad) +
      (access.tradUnlockedB ? 0 : state.spouseB.trad) +
      (access.rothUnlockedA ? 0 : state.spouseA.rothEarnings + pipelineTotal(state.spouseA)) +
      (access.rothUnlockedB ? 0 : state.spouseB.rothEarnings + pipelineTotal(state.spouseB));
    const funding = solveFunding(
      state,
      access,
      {
        fixedSpend,
        netIncome: employmentIncome,
        // SEPP distributions are penalty-free cash, taxed as ordinary income.
        baseOrdinary: pensionIncome + conversion + sepp72t,
        pensionCash: pensionIncome + sepp72t,
        ssGross: ssIncome,
        acaGross,
        medicareCost,
      },
      inputs,
    );
    const wealthBeforeDraw = totalWealth(state);
    applyPlan(state, funding.plan, funding.surplus);

    // Feed this year's withdrawal rate to next year's guardrail decision.
    if (!anyWorking) {
      lastWithdrawalRate = wealthBeforeDraw > 0 ? planTotal(funding.plan) / wealthBeforeDraw : 1;
    }

    const penalized =
      funding.plan.penTradA + funding.plan.penTradB +
      funding.plan.penPipeA + funding.plan.penPipeB +
      funding.plan.penEarnA + funding.plan.penEarnB;
    totalPenalties += funding.penalty;
    const squeezed =
      (penalized > 0 || funding.plan.shortfall > 0) &&
      lockedBefore > inputs.squeezeLockedThreshold;
    if (squeezed) {
      state.everSqueezed = true;
      if (firstSqueezeYear === null) firstSqueezeYear = year;
    }
    if (funding.plan.shortfall > 0.5 && !state.ruined) {
      state.ruined = true;
      ruinYear = year;
    }

    // --- Growth ---
    grow(state, r);

    // --- Record ---
    const accessible = accessibleTotal(state, access);
    const netWorth = totalWealth(state);
    accessibleSeries.push(accessible);
    if (keepRecords) {
      years.push({
        t,
        year,
        ageA,
        ageB,
        phase: workingA && workingB ? "both"
          : workingA ? "onlyA"
          : workingB ? "onlyB"
          : "retired",
        grossReturn: r,
        inflation: returns[t].inflation,
        employmentIncome,
        reentryReactive,
        pensionIncome,
        ssIncome,
        coreSpend,
        sepp72t,
        spendMultiplier: effMultiplier,
        childcare,
        housingPI,
        escrow: inputs.escrowAnnual,
        healthcare: funding.healthcare,
        totalSpend: fixedSpend + funding.healthcare - redirected,
        conversion,
        taxesPaid: funding.taxes,
        penaltyPaid: funding.penalty,
        wTaxable: funding.plan.taxable + funding.plan.cash,
        wRothBasis: funding.plan.rothA + funding.plan.rothB,
        wTrad: funding.plan.tradA + funding.plan.tradB,
        wHsa: funding.plan.hsaReceiptsFree + funding.plan.hsaTaxable,
        wPenalized: penalized,
        savedToTaxable: funding.surplus + (inputs.prepay ? 0 : redirected),
        taxable: state.taxable.value,
        cash: state.cash,
        rothBasisTotal: state.spouseA.rothBasis + state.spouseB.rothBasis,
        rothEarningsTotal: state.spouseA.rothEarnings + state.spouseB.rothEarnings,
        rothPipelineTotal: pipelineTotal(state.spouseA) + pipelineTotal(state.spouseB),
        tradA: state.spouseA.trad,
        tradB: state.spouseB.trad,
        hsa: state.hsa,
        mortgageBalance: amortRow.endBalance,
        accessible,
        locked: Math.max(0, netWorth - accessible),
        netWorth,
        squeezed,
        ruined: state.ruined,
        shortfall: funding.plan.shortfall,
      });
    }

    // The redirected prepay money actually lands in taxable (it was counted
    // as spend above so the funding solver reserves cash for it).
    if (redirected > 0) {
      state.taxable.value += redirected;
      state.taxable.basis += redirected;
    }

    // Advance the price level by this year's inflation for the next iteration.
    deflator *= 1 + returns[t].inflation;
  }

  const classification: Classification = ruinYear !== null
    ? "trueRuin"
    : state.everSqueezed
      ? "liquiditySqueeze"
      : reentryYears > 0
        ? "backToWork"
        : "fullSuccess";

  return {
    years,
    classification,
    firstSqueezeYear,
    ruinYear,
    firstReentryYear,
    reentryYears,
    totalPenalties,
    endingNetWorth: totalWealth(state),
    endingAccessible: accessibleSeries[accessibleSeries.length - 1] ?? 0,
    accessibleSeries,
    blendedSeries: blendedReturns,
  };
}

/** Re-export for the UI/tests. */
export { allocateWithdrawals };
