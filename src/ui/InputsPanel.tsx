import type { ConversionMode, ReturnModel, SimInputs } from "../engine/types";

interface Props {
  inputs: SimInputs;
  onChange: (next: SimInputs) => void;
  onReset: () => void;
  /** Present only when a private local profile exists — resets to the example. */
  onLoadExample?: () => void;
}

function Text({
  label, value, onChange, title,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  title?: string;
}) {
  return (
    <label className="field" title={title}>
      <span>{label}</span>
      <input type="text" value={value} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}

function Num({
  label, value, onChange, step = 1000, min, max, title,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  step?: number;
  min?: number;
  max?: number;
  title?: string;
}) {
  return (
    <label className="field" title={title}>
      <span>{label}</span>
      <input
        type="number"
        value={value}
        step={step}
        min={min}
        max={max}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </label>
  );
}

function Slider({
  label, value, onChange, min, max, step = 1, title, suffix = "",
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  step?: number;
  title?: string;
  suffix?: string;
}) {
  return (
    <label className="field slider-field" title={title}>
      <span>{label}</span>
      <span className="slider-wrap">
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
        />
        <b className="slider-val">{value}{suffix}</b>
      </span>
    </label>
  );
}

function Check({
  label, value, onChange, title, disabled, hint,
}: {
  label: string;
  value: boolean;
  onChange: (v: boolean) => void;
  title?: string;
  disabled?: boolean;
  hint?: string;
}) {
  return (
    <div className={`check-row${disabled ? " disabled" : ""}`}>
      <label className="field check" title={title}>
        <input
          type="checkbox"
          checked={value}
          disabled={disabled}
          onChange={(e) => onChange(e.target.checked)}
        />
        <span>{label}</span>
      </label>
      {disabled && hint && <div className="check-hint">{hint}</div>}
    </div>
  );
}

export function InputsPanel({ inputs, onChange, onReset, onLoadExample }: Props) {
  const set = <K extends keyof SimInputs>(k: K, v: SimInputs[K]) =>
    onChange({ ...inputs, [k]: v });
  const setBal = <K extends keyof SimInputs["balances"]>(k: K, v: number) =>
    onChange({ ...inputs, balances: { ...inputs.balances, [k]: v } });
  const A = inputs.nameA;
  const B = inputs.nameB;

  // Rule of 55 qualifies only if the spouse works THROUGH the calendar year
  // they turn ruleOf55Age — i.e. their last working year (retireYear - 1) is
  // that year or later. Earliest qualifying retireYear = startYear + age+1 - age0.
  const r55YearA = inputs.startYear + inputs.ruleOf55Age + 1 - inputs.startAgeA;
  const r55YearB = inputs.startYear + inputs.ruleOf55Age + 1 - inputs.startAgeB;
  const r55OkA = inputs.retireYearA >= r55YearA;
  const r55OkB = inputs.retireYearB >= r55YearB;

  return (
    <div className="inputs-panel">
      <div className="panel-header">
        <h2>Assumptions</h2>
        <div className="header-btns">
          {onLoadExample && (
            <button className="ghost mini" onClick={onLoadExample} title="Load the neutral example household">
              Example
            </button>
          )}
          <button className="ghost mini" onClick={onReset} title="Reset to your starting profile">
            Reset
          </button>
        </div>
      </div>

      <details>
        <summary>Household &amp; balances</summary>
        <Text label="Name — spouse A" value={inputs.nameA} onChange={(v) => set("nameA", v)} title="Shown throughout the app in place of a hardcoded name" />
        <Text label="Name — spouse B" value={inputs.nameB} onChange={(v) => set("nameB", v)} />
        <Num label={`${A} age (${inputs.startYear})`} value={inputs.startAgeA} step={1} min={25} max={70} onChange={(v) => set("startAgeA", v)} />
        <Num label={`${B} age (${inputs.startYear})`} value={inputs.startAgeB} step={1} min={25} max={70} onChange={(v) => set("startAgeB", v)} />
        <Num label="Taxable brokerage" value={inputs.balances.taxable} onChange={(v) => setBal("taxable", v)} title="Realizes capital gains when sold — fully accessible" />
        <Num label="Cash / bank" value={inputs.balances.cash} onChange={(v) => setBal("cash", v)} />
        <Num label={`${A} Roth basis`} value={inputs.balances.rothBasisA} onChange={(v) => setBal("rothBasisA", v)} title="Contributions + matured conversions — accessible pre-59½" />
        <Num label={`${A} traditional`} value={inputs.balances.tradA} onChange={(v) => setBal("tradA", v)} title="401k/IRA — locked until 59½ (or Rule of 55 / 72(t))" />
        <Num label={`${B} Roth basis`} value={inputs.balances.rothBasisB} onChange={(v) => setBal("rothBasisB", v)} />
        <Num label={`${B} traditional`} value={inputs.balances.tradB} onChange={(v) => setBal("tradB", v)} />
        <Num label="HSA" value={inputs.balances.hsa} onChange={(v) => setBal("hsa", v)} />
      </details>

      <details open>
        <summary>Retirement timing</summary>
        <Num label={`${A} retires (${inputs.retireYearA})`} value={inputs.retireYearA} step={1} min={2026} max={2060} onChange={(v) => set("retireYearA", v)} title="First calendar year fully retired" />
        <Num label={`${B} retires (${inputs.retireYearB})`} value={inputs.retireYearB} step={1} min={2026} max={2060} onChange={(v) => set("retireYearB", v)} title="First calendar year fully retired" />
        <Check
          label={`Rule of 55 — ${A}`}
          value={inputs.ruleOf55A}
          onChange={(v) => set("ruleOf55A", v)}
          title="Unlocks the 401k at separation if they work through the year they turn 55"
          disabled={!r55OkA}
          hint={`moot — needs to work through ${r55YearA} (retires ${inputs.retireYearA})`}
        />
        <Check
          label={`Rule of 55 — ${B}`}
          value={inputs.ruleOf55B}
          onChange={(v) => set("ruleOf55B", v)}
          title="Unlocks the 401k at separation if they work through the year they turn 55"
          disabled={!r55OkB}
          hint={`moot — needs to work through ${r55YearB} (retires ${inputs.retireYearB})`}
        />
      </details>

      <details>
        <summary>Access ages &amp; 72(t)</summary>
        <Slider label="Trad/Roth unlock (59½ proxy)" value={inputs.unlockAge} min={55} max={65} onChange={(v) => set("unlockAge", v)} title="Age traditional accounts and Roth earnings unlock. 60 approximates the real 59½ in this annual model" />
        <Slider label="HSA free-use age" value={inputs.hsaUnlockAge} min={60} max={70} onChange={(v) => set("hsaUnlockAge", v)} title="Age the HSA becomes spendable on anything without receipts (real rule: 65)" />
        <Slider label="Medicare age" value={inputs.medicareAge} min={60} max={70} onChange={(v) => set("medicareAge", v)} title="Age each spouse leaves the ACA for Medicare (real rule: 65)" />
        <Slider label="Rule-of-55 age" value={inputs.ruleOf55Age} min={50} max={59} onChange={(v) => set("ruleOf55Age", v)} title="Qualifying age for the separation-year 401k unlock (real rule: 55; 50 for public-safety workers)" />
        <Check
          label={`72(t) SEPP — ${A}`}
          value={inputs.sepp72tA}
          onChange={(v) => set("sepp72tA", v)}
          title="Penalty-free fixed distributions from this spouse's traditional at any age — rigid once started"
        />
        {inputs.sepp72tA && (
          <Slider label="↳ start year" value={inputs.sepp72tStartYearA} min={2026} max={2050} onChange={(v) => set("sepp72tStartYearA", v)} />
        )}
        <Check
          label={`72(t) SEPP — ${B}`}
          value={inputs.sepp72tB}
          onChange={(v) => set("sepp72tB", v)}
          title="Penalty-free fixed distributions from this spouse's traditional at any age — rigid once started"
        />
        {inputs.sepp72tB && (
          <Slider label="↳ start year" value={inputs.sepp72tStartYearB} min={2026} max={2050} onChange={(v) => set("sepp72tStartYearB", v)} />
        )}
        {(inputs.sepp72tA || inputs.sepp72tB) && (
          <>
            <Num label="↳ amortization rate" value={inputs.sepp72tRate} step={0.005} min={0.01} max={0.08} onChange={(v) => set("sepp72tRate", v)} title="IRS cap: the greater of 5% or 120% of the federal mid-term rate (Notice 2022-6)" />
            <p className="field-note">
              The payment is set once from the balance at the start year (fixed
              amortization over IRS single-life expectancy), is FIXED in nominal
              dollars — eroding with inflation — and must run until the later of
              5 years or 59½. While it runs, that spouse's traditional is off-limits
              to the Roth ladder.
            </p>
          </>
        )}
      </details>

      <details open>
        <summary>Spending</summary>
        <Num label="Core spend / yr" value={inputs.coreSpend} onChange={(v) => set("coreSpend", v)} title="Excludes housing, childcare and healthcare — modeled separately" />
        <Num label="Childcare / yr" value={inputs.childcareAnnual} onChange={(v) => set("childcareAnnual", v)} />
        <Num label="Childcare last year" value={inputs.childcareLastYear} step={1} onChange={(v) => set("childcareLastYear", v)} />
        <Check label="Bad-market spending cut" value={inputs.floorEnabled} onChange={(v) => set("floorEnabled", v)} title="Cut core spend the year after a big drawdown — the amber→green lever" />
        {inputs.floorEnabled && (
          <>
            <Num label="Cut amount" value={inputs.floorCutAmount} onChange={(v) => set("floorCutAmount", v)} />
            <Num label="Trigger return" value={inputs.floorTriggerReturn} step={0.05} onChange={(v) => set("floorTriggerReturn", v)} title="Cut applies after a year at or below this (-0.2 = -20%)" />
          </>
        )}
        <Check label="Guardrails (raise & cut spend)" value={inputs.guardrailsEnabled} onChange={(v) => set("guardrailsEnabled", v)} title="Guyton-Klinger: cut spend when the withdrawal rate runs high, RAISE it when the portfolio runs ahead. Symmetric and continuous, unlike the one-shot floor above." />
        {inputs.guardrailsEnabled && (
          <>
            <Num label="↳ cut above rate" value={inputs.guardrailUpperRate} step={0.005} onChange={(v) => set("guardrailUpperRate", v)} title="Withdrawal rate (draw ÷ wealth) above this triggers a spend cut" />
            <Num label="↳ raise below rate" value={inputs.guardrailLowerRate} step={0.005} onChange={(v) => set("guardrailLowerRate", v)} title="Withdrawal rate below this lets spend rise" />
            <Num label="↳ step size" value={inputs.guardrailAdjustPct} step={0.05} onChange={(v) => set("guardrailAdjustPct", v)} title="Fractional spend change per trigger (0.1 = ±10%)" />
            <Num label="↳ min multiplier" value={inputs.guardrailMinMult} step={0.05} onChange={(v) => set("guardrailMinMult", v)} title="Spend can't fall below this × the baseline" />
            <Num label="↳ max multiplier" value={inputs.guardrailMaxMult} step={0.05} onChange={(v) => set("guardrailMaxMult", v)} title="Spend can't rise above this × the baseline" />
          </>
        )}
      </details>

      <details>
        <summary>Income while working</summary>
        <Num label={`${A} take-home / yr`} value={inputs.netIncomeA} onChange={(v) => set("netIncomeA", v)} title="Annual take-home: gross wages minus taxes and payroll retirement deferrals" />
        <Num label={`${B} take-home / yr`} value={inputs.netIncomeB} onChange={(v) => set("netIncomeB", v)} title="Annual take-home: gross wages minus taxes and payroll retirement deferrals" />
        <Num label={`${A} 401k / yr`} value={inputs.contribTradA} onChange={(v) => set("contribTradA", v)} title="Pre-tax traditional 401k. Drop toward the employer match level as retirement nears" />
        <Num label={`${B} 401k / yr`} value={inputs.contribTradB} onChange={(v) => set("contribTradB", v)} title="Pre-tax traditional 401k. Drop toward the employer match level as retirement nears" />
        <Num label="Always-on re-entry / yr" value={inputs.reentryIncome} onChange={(v) => set("reentryIncome", v)} title="Unconditional backstop — added to every fully-retired year, whether needed or not" />
        <Check
          label="Auto re-enter if squeezed"
          value={inputs.reactiveReentryEnabled}
          onChange={(v) => set("reactiveReentryEnabled", v)}
          title="Reactive backstop: someone returns to work only when accessible funds run low, and stops once they recover. Turn off to see the unmitigated 'do nothing' squeeze."
        />
        {inputs.reactiveReentryEnabled && (
          <>
            <Num label="↳ income / yr" value={inputs.reactiveReentryIncome} onChange={(v) => set("reactiveReentryIncome", v)} title="After-tax income earned while re-engaged" />
            <Num label="↳ trigger: accessible < N yrs spend" value={inputs.reactiveReentryTriggerYears} step={0.5} min={0.5} onChange={(v) => set("reactiveReentryTriggerYears", v)} title="Go back to work when accessible funds fall below this many years of spending" />
            <Num label="↳ min years worked" value={inputs.reactiveReentryMinYears} step={1} min={1} onChange={(v) => set("reactiveReentryMinYears", v)} title="Minimum stint once back — a real job commitment" />
            <Num label="↳ stop after age" value={inputs.reactiveReentryMaxAge} step={1} min={40} max={65} onChange={(v) => set("reactiveReentryMaxAge", v)} title="No re-entry once the younger spouse is past this age" />
          </>
        )}
      </details>

      <details>
        <summary>Mortgage</summary>
        <Check label="Prepay $/mo → principal" value={inputs.prepay} onChange={(v) => set("prepay", v)} title="Off = redirect the extra payment into taxable brokerage instead" />
        <Num label="Extra principal / mo" value={inputs.extraPrincipalMonthly} step={100} onChange={(v) => set("extraPrincipalMonthly", v)} />
        <Num label="Escrow / yr (forever)" value={inputs.escrowAnnual} onChange={(v) => set("escrowAnnual", v)} />
      </details>

      <details>
        <summary>Healthcare</summary>
        <Num label="ACA gross premium / yr" value={inputs.acaGrossPremium} onChange={(v) => set("acaGrossPremium", v)} title="Family marketplace premium before subsidy — price on healthcare.gov" />
        <Num label="Medicare couple / yr" value={inputs.medicareAnnualCouple} onChange={(v) => set("medicareAnnualCouple", v)} />
        <Num label="Household size" value={inputs.householdSize} step={1} min={1} max={10} onChange={(v) => set("householdSize", v)} title="People on the tax return — sets the poverty line used for ACA subsidies" />
      </details>

      <details>
        <summary>Roth conversions</summary>
        <label className="field">
          <span>Ladder mode</span>
          <select
            value={inputs.conversionMode}
            onChange={(e) => set("conversionMode", e.target.value as ConversionMode)}
          >
            <option value="fillBracket">Fill 12% bracket</option>
            <option value="fixed">Fixed amount</option>
            <option value="off">Off</option>
          </select>
        </label>
        {inputs.conversionMode === "fixed" && (
          <Num label="Convert / yr" value={inputs.conversionFixed} onChange={(v) => set("conversionFixed", v)} />
        )}
        {inputs.conversionMode === "fillBracket" && (
          <Num label="Bracket top (taxable)" value={inputs.conversionBracketTop} onChange={(v) => set("conversionBracketTop", v)} title="Convert until federal taxable ordinary income reaches this" />
        )}
      </details>

      <details>
        <summary>Other income</summary>
        <Num label="Pension / yr (nominal)" value={inputs.pensionAnnual} onChange={(v) => set("pensionAnnual", v)} title="Non-COLA — erodes with inflation in the model" />
        <Num label="Pension starts at age" value={inputs.pensionStartAge} step={1} min={50} max={75} onChange={(v) => set("pensionStartAge", v)} />
        <label className="field">
          <span>Pension belongs to</span>
          <select value={inputs.pensionOwner} onChange={(e) => set("pensionOwner", e.target.value as "A" | "B")}>
            <option value="A">{A}</option>
            <option value="B">{B}</option>
          </select>
        </label>
        <Num label={`SS ${A} / yr`} value={inputs.ssA} onChange={(v) => set("ssA", v)} title="Replace with the real ssa.gov estimate" />
        <Num label={`SS ${B} / yr`} value={inputs.ssB} onChange={(v) => set("ssB", v)} title="Replace with the real ssa.gov estimate" />
        <Num label="SS start age" value={inputs.ssStartAge} step={1} min={62} max={70} onChange={(v) => set("ssStartAge", v)} />
      </details>

      <details>
        <summary>Portfolio</summary>
        <Num label="Equity %" value={inputs.equityPct} step={0.05} min={0} max={1} onChange={(v) => set("equityPct", v)} title="Stock fraction of the whole portfolio, rebalanced annually; the rest earns the bond return. Used everywhere when glidepath is off, and during working years when on" />
        <Check
          label="Bond-tent glidepath"
          value={inputs.glidepathEnabled}
          onChange={(v) => set("glidepathEnabled", v)}
          title="De-risk the bridge years (a bad sequence hurts most there), re-risk after 59½"
        />
        {inputs.glidepathEnabled && (
          <>
            <Num label="↳ bridge equity %" value={inputs.equityPctBridge} step={0.05} min={0} max={1} onChange={(v) => set("equityPctBridge", v)} title="While fully retired and the younger spouse is < 59½" />
            <Num label="↳ post-59½ equity %" value={inputs.equityPctLate} step={0.05} min={0} max={1} onChange={(v) => set("equityPctLate", v)} />
          </>
        )}
        <Num label="Bond real return" value={inputs.bondRealReturn} step={0.005} onChange={(v) => set("bondRealReturn", v)} title="Expected real bond return (Gaussian model + deterministic view). Bootstrap/cohorts use the historical 10-yr Treasury series" />
        {inputs.returnModel === "gaussian" && (
          <Num label="Bond volatility (sd)" value={inputs.bondVol} step={0.01} onChange={(v) => set("bondVol", v)} />
        )}
      </details>

      <details>
        <summary>Returns &amp; Monte Carlo</summary>
        <label className="field">
          <span>Return model</span>
          <select
            value={inputs.returnModel}
            onChange={(e) => set("returnModel", e.target.value as ReturnModel)}
          >
            <option value="bootstrap">Historical bootstrap</option>
            <option value="cohorts">Historical cohorts (real sequences)</option>
            <option value="gaussian">IID Gaussian</option>
          </select>
        </label>
        {inputs.returnModel !== "cohorts" && (
          <Num label="Expected real return" value={inputs.expectedRealReturn} step={0.005} onChange={(v) => set("expectedRealReturn", v)} title="Drives the deterministic view, the Gaussian model, and the bootstrap mean shift" />
        )}
        {inputs.returnModel === "gaussian" && (
          <Num label="Volatility (sd)" value={inputs.returnVol} step={0.01} onChange={(v) => set("returnVol", v)} />
        )}
        {inputs.returnModel === "bootstrap" && (
          <>
            <Num label="Block years" value={inputs.bootstrapBlockYears} step={1} min={1} max={10} onChange={(v) => set("bootstrapBlockYears", v)} />
            <Check label="Shift history to expected return" value={inputs.bootstrapMatchMean} onChange={(v) => set("bootstrapMatchMean", v)} title="History averaged ~8% real; shifting it down to 6% stacks conservatism on top of real crash sequences" />
          </>
        )}
        {inputs.returnModel === "cohorts" ? (
          <p className="field-note">
            Replays the plan over every actual 1928–2023 return sequence, in real
            order. Sample size is the number of start years; expected return, paths
            and seed don’t apply.
          </p>
        ) : (
          <>
            <Num label="Paths" value={inputs.numPaths} step={100} min={100} max={5000} onChange={(v) => set("numPaths", v)} />
            <Num label="Seed" value={inputs.seed} step={1} onChange={(v) => set("seed", v)} />
          </>
        )}
      </details>

      <details>
        <summary>Advanced</summary>
        <Num label="Inflation (deflates nominal)" value={inputs.inflation} step={0.005} onChange={(v) => set("inflation", v)} />
        <Num label="State income tax rate" value={inputs.stateTaxRate} step={0.0025} min={0} max={0.15} onChange={(v) => set("stateTaxRate", v)} title="Flat rate above the exemption; gains taxed as ordinary, Social Security exempt. Default is Ohio; 0 for a no-income-tax state" />
        <Num label="State tax exemption" value={inputs.stateTaxExemption} onChange={(v) => set("stateTaxExemption", v)} title="Income below this is untaxed by the state" />
        <Num label="Taxable basis fraction" value={inputs.taxableBasisFraction} step={0.05} min={0} max={1} onChange={(v) => set("taxableBasisFraction", v)} title="Cost basis of the brokerage today as a fraction of value" />
        <Num label="HSA receipts today" value={inputs.hsaReceipts0} onChange={(v) => set("hsaReceipts0", v)} title="Accumulated unreimbursed medical receipts — makes HSA quasi-accessible" />
        <Num label="HSA receipts accrual / yr" value={inputs.hsaAnnualReceipts} onChange={(v) => set("hsaAnnualReceipts", v)} />
        <Num label="Squeeze locked threshold" value={inputs.squeezeLockedThreshold} onChange={(v) => set("squeezeLockedThreshold", v)} />
        <Num label="Horizon (years)" value={inputs.horizonYears} step={5} min={20} max={60} onChange={(v) => set("horizonYears", v)} />
      </details>
    </div>
  );
}
