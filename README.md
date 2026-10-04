# FIRE Bridge Model

An early-retirement planning tool for a two-earner household. The central
question is not "can we retire" but **when each person can stop working, in what
order, and whether accessible money survives the pre-59½ bridge** — separate from
total wealth.

Every Monte Carlo path is classified four ways (best to worst):

- **Full success** — money lasts to the end, never a squeeze, never needed to
  go back to work
- **Back to work** — avoided a squeeze/ruin ONLY because reactive re-entry
  kicked in; the summary reports the median years of work it took. Splitting
  this out of "full success" keeps the green number honest — a plan that only
  survives by returning to the workforce isn't the same as one that doesn't.
- **Liquidity squeeze** — accessible funds run dry pre-59½ while locked money
  remains (a *timing* failure: recoverable via re-entry income, spending cuts,
  or penalized withdrawals)
- **True ruin** — actually out of money

The solver and sensitivity analysis optimize **survival** (full success +
back to work), since returning to work is a survivable outcome, not a failure.

## Run it

```
npm install
npm run dev        # → http://localhost:5173
npm test           # engine unit tests
```

## Your data stays yours

The app ships with a **neutral example household** — no real numbers are in the
committed source. There are three ways to use your own figures, in order of
convenience:

1. **Just edit in the UI.** Open *Household & balances* in the sidebar, type your
   names, balances, income, and mortgage. Everything auto-saves to your browser's
   localStorage. Use **Export**/**Import** to move a plan between machines.
2. **Auto-load a private file every visit.** Copy
   [`src/data/profile.local.example.ts`](src/data/profile.local.example.ts) to
   `src/data/profile.local.ts`, fill in your numbers, and the app loads it
   automatically. That file is **gitignored** — it never enters git or a shared
   repo. Only override the fields you care about; the rest fall back to the
   example.
3. **Nothing at all** — the example is a fine sandbox to explore the mechanics.

There is **no backend**. Nothing you enter is ever sent anywhere; it lives only
in your browser (and optionally your gitignored local file). If you host the
static build (see below), each visitor's data stays in their own browser.

## Spending tab (a tiny Mint / Rocket Money replacement)

Answers two questions: *how much money came in and went out each month*, and
*how much do we spend per year*. Download CSV activity exports from each bank
and card site and drop them in — no bank logins, no third-party sync, no cost.

- **Import:** auto-detects the common layouts (single signed *Amount* column, or
  separate *Debit* / *Credit* columns), skips bank preamble lines, and ignores
  rows it already has, so overlapping exports are safe to re-import. Cards
  that export purchases as positive numbers: tick *flip signs*.
- **Buckets:** Income, Spending, Mortgage, School, and Transfer. Transfers (card
  payments, moves between your own accounts) are excluded so a purchase isn't
  counted twice. Each bucket is a keyword list you edit in the tab; any single
  transaction can be overridden.
- **Feeds the model:** trailing-12-month spend is split the way the simulator
  wants it. One click sets *core spend* or *childcare* from your actual numbers.

Transactions are stored only in the browser's localStorage. They never touch the
repo, and `make-public` has nothing to leak.

## Sharing this repo publicly

This repo's *git history* contains personal data from earlier commits, so don't
just flip it public. Instead, publish a **fresh repo with clean history** from
the sanitized working tree:

```bash
npm run make-public          # scaffolds ../fire-model-public (no .git, no private files)
cd ../fire-model-public
git init && git add -A && git commit -m "Initial public release"
gh repo create fire-model --public --source=. --push   # or create on github.com and push
```

`make-public` excludes `.git`, `node_modules`, `dist`, `*.pptx`, and
`profile.local.ts`, so the new repo starts with zero history and zero personal
data. Keep *this* repo private for your own numbers.

To host it (so friends get a URL, not a clone): `npm run build` and deploy the
`dist/` folder to GitHub Pages / Netlify / Vercel. Still no backend — every
user's data stays in their own browser.

## Layout

- `src/engine/` — pure TypeScript simulation core, no DOM/React. Amortization,
  tax (federal brackets + LTCG stacking + flat-rate state), ACA subsidy, Roth conversion
  ladder (5-year pipeline), withdrawal waterfall with basis tracking, Monte
  Carlo with seeded RNG.
- `src/data/` — example starting balances, editable default assumptions,
  tax tables, approximate 1928–2023 real-return series for bootstrapping.
- `src/ui/` — React app. Monte Carlo runs in a Web Worker, debounced.
- `scripts/` — `diag.ts` (MC summary + ruined-path dump), `sweep.ts`
  (scenario sweeps). Run with `npx tsx scripts/diag.ts`.

## Modeling notes (read before trusting numbers)

- All dollars are **real (June-2026)**. Fixed-nominal items — mortgage P&I and
  the non-COLA pension — are deflated by the inflation input.
- The mortgage is amortized monthly from the balance, rate, and P&I you enter.
  Enter the P&I from your statement rather than a textbook figure — if it's
  higher than the standard payment for your balance and rate, the loan pays off
  sooner than its contractual maturity, and the model will reflect that.
- Only Roth **basis** (contributions + matured conversions) is accessible
  pre-59½; earnings and unseasoned conversions are locked. Current Roth
  balances are treated as fully basis (enter only contributions if you know
  your earnings are a large share).
- Taxable withdrawals realize proportional capital gains (average-basis) and
  flow through the LTCG brackets — the 0% bracket is very reachable in bridge
  years.
- The ACA premium is solved together with taxes and withdrawals (subsidy
  depends on MAGI, which depends on withdrawals). Conversions raise MAGI and
  can forfeit the whole subsidy — the tool makes that tension visible. The
  post-2025 subsidy cliff at 400% FPL is modeled; the poverty line comes from
  *Household size* (Healthcare section).
- The conversion ladder pauses when readily accessible funds fall below ~2
  years of spending — a household in a crunch would not pay conversion tax.
- **Reactive re-entry** (on by default): someone returns to work only once
  accessible funds fall below a trigger (default 2 years of NET burn — spend
  minus income already arriving), for a minimum stint (default 3 years), while
  the younger spouse is still of working age (≤ 60) — the realistic response to
  a squeeze, distinct from the always-on `reentryIncome`. Fires in staggered
  phases too (the retired spouse re-enters). Forced-work years are flagged in
  the funding table. Turn it off to see the unmitigated "do nothing" squeeze.
  Simplification: the wage is treated as after-tax cash and does not raise MAGI
  (same as `reentryIncome`), so it doesn't erode the ACA subsidy in the model.
- **Asset allocation**: the whole portfolio is rebalanced annually to an equity
  weight; the rest earns the bond return (10-yr Treasury series historically,
  a flat real assumption in the Gaussian/deterministic models). Bootstrap and
  cohort sampling use the SAME years for stocks and bonds, preserving their
  historical correlation. Optional "bond tent" glidepath de-risks the
  fully-retired pre-59½ bridge and re-risks after unlock.
- **Earliest-retirement solver** (Monte Carlo tab): scans candidate retirement
  years for one spouse (holding the other fixed) and reports the earliest year
  meeting a target full-success %. A linear scan, because success is NOT
  monotone in the retirement year here — long single-earner staggered phases
  can bleed accessible funds (conversions are gated off while anyone works).
  Every checked year is shown. Fastest with the cohorts model.
- **Scenarios tab**: save named assumption sets, reload them, and run a
  side-by-side comparison (classification split, deterministic bridge low
  point, ending-NW percentiles). Stored in the browser's localStorage.
- **Spending guardrails** (Guyton-Klinger): adjust core spend by the current
  withdrawal rate — cut above the upper rail at any age, RAISE below the lower
  rail but only once past 59½ (lifting spend while money is trapped behind the
  wall just feeds the squeeze). The single most powerful robustness lever:
  it roughly halves true ruin and, in the both-retire-2028 case, lifts full
  success ~51%→77% (cohorts). Distinct from the one-shot bad-market floor.
- **Sensitivity / tornado** (Sensitivity tab): perturbs each input to a low and
  high value, measures the full-success swing, and ranks the levers. Runs in
  Gaussian mode so the return mean/volatility are active (they're inert under
  bootstrap/cohorts). This is the spec's "which levers move the outcome" made
  literal — for the base plan, retirement timing and core spend dominate.
- **Cohort drill-down**: click any square in the cohort heatmap to see that
  retirement's full year-by-year funding table — which year the accessible pot
  ran dry, what conversions were doing, and the real inflation of the era.
- **Real historical inflation**: cohort and bootstrap paths now deflate the
  fixed-nominal mortgage P&I and non-COLA pension by the ACTUAL year's CPI
  (Depression deflation, 1970s double digits) rather than a flat 2.5% — a real
  tailwind the flat assumption withheld from the worst-return cohorts.
- **72(t)/SEPP** (Access ages & 72(t) section): per-spouse substantially-equal
  periodic payments — penalty-free traditional distributions at ANY age via the
  fixed-amortization method (IRS single-life table, rate capped per Notice
  2022-6, default 5%). Honest about the rigidity: the payment is set once from
  the start-year balance, is FIXED in nominal dollars (eroding with realized
  inflation), must run until the later of 5 years or 59½, the SEPP'd account is
  excluded from the Roth conversion ladder, and emergency penalized draws avoid
  it until the other spouse's account is empty (an extra draw = retroactive
  bust). Double-edged in the data: it converts squeezes into clean successes on
  median paths but slightly RAISES tail ruin in aggressive plans, because the
  forced distributions can't pause in a crash. Simplification: the SEPP covers
  the spouse's whole traditional bucket (real households can split an IRA to
  size the payment — see BACKLOG).
- **Adjustable access ages** (sliders): the 59½ unlock (integer proxy 60), HSA
  free-use age, Medicare age, and the Rule-of-55 qualifying age are all inputs
  now — for what-ifs like public-safety 50 or policy-drift stress tests.
- Three return models: (a) **historical bootstrap** — 3-year blocks of
  1928–2023 real returns resampled (autocorrelation and fat tails preserved);
  (b) **historical cohorts** — the plan replayed over every *actual* contiguous
  sequence, one per start year (1928–1974 for a 50-year horizon, 47 cohorts),
  no resampling or mean shift, shown as a per-year outcome heatmap; (c) **IID
  Gaussian** for comparison. Bootstrap's "Shift history to expected return" is
  off by default: history averaged ~8% real, and shifting it down to 6% makes
  the Depression/1970s sequences worse than they ever were — conservatism
  double-counted. Cohorts ignore the expected-return input entirely (they use
  the real numbers). The embedded series starts in 1928; extend it back to
  1871 with Shiller data for the pre-Depression panics.
- Squeeze paths continue via penalized withdrawals (10% + tax, cheapest source
  first: unseasoned conversions → locked traditional → locked Roth earnings),
  so ruin means ruin, not "hit a rule."
- Within each tier of the withdrawal waterfall, the **older** spouse's accounts
  are drawn first — they unlock sooner, so the younger spouse's money is the
  scarce resource before 59½. The order comes from the ages you enter, so it
  doesn't matter which person you put in the A slot.
- Household-wide milestones — end of the bridge, re-risking the glidepath,
  guardrail raises, re-entry age, HSA general use — follow the **younger**
  spouse's age.

Known simplifications: household-level SS taxation at a flat 85% inclusion, no
NIIT/IRMAA/city tax, no RMDs yet (see BACKLOG), the HSA is one household pot
unlocked by the younger spouse's age, Rule-of-55 toggles unlock that spouse's
whole traditional bucket, and state tax is a single flat rate above an
exemption (*Advanced* → defaults to Ohio; set the rate to 0 for a
no-income-tax state; progressive state brackets aren't modeled).

## Framing caveat

Past a point, model precision exceeds input precision. A 50-year projection is
inherently fuzzy — returns, tax law, ACA rules, and actual spending all drift.
The value is seeing **which levers move the outcome**: re-entry income,
floor-spending flexibility, and retirement timing/stagger dominate; everything
else is second-order. The honest next step past diminishing returns is a
one-time flat-fee advisor + CPA review (conversion sizing vs ACA subsidy is
the highest-value professional question).

*Illustrative planning tool. Not financial, tax, or legal advice.*
