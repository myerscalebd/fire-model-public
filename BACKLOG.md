# Backlog

Deferred from the build spec (§7 medium/low value), roughly in priority order.

1. **Lumpy one-time expenses** — schedule of car replacements (Tesla + Sienna
   every ~10 yrs), roof/HVAC, weddings, possible kid down-payment help.
2. **College model** — 529 growth vs projected in-state cost for the twins
   (~14 yrs out); any gap lands in bridge years. 529s ($20,719 each) are
   currently excluded from the model entirely.
3. **RMDs at 73** — forced traditional withdrawals late in the horizon
   (Katy hits 73 in 2060, inside the default horizon); interacts with tax.
4. **Real SS estimates** — replace the $25k/$25k placeholders with ssa.gov
   numbers; model claiming-age tradeoff (62 vs 67 vs 70).
5. ~~**72(t)/SEPP**~~ — DONE (fixed-amortization method, per-spouse start-year
   sliders). Remaining refinement: model splitting an IRA so the SEPP covers a
   SLICE of a spouse's traditional instead of the whole bucket (real-world
   payment-sizing trick; the model currently SEPPs the full spouse balance).
6. **Survivor / single-death scenario** — pension survivor benefit, SS
   survivor rules, spending reduction, term-life proceeds during the bridge.
7. **Long-term-care shock** late in life.
8. **Nominal-dollar display toggle.**
9. **Tax-loss harvesting** in taxable during down years.
10. **Roth 401k contribution routing optimizer** (Caleb lean Roth, Katy stay
    traditional) for the remaining working years.

Model-quality improvements:

- Exact 2026 tax tables once published (currently 2025 MFJ figures).
- Replace the approximate historical return series with exact Shiller data.
- Smarter conversion sizing: optimize against the ACA subsidy schedule
  instead of blind bracket-filling (the single highest-value refinement).
- Per-spouse HSA 65+ unlock; NIIT and IRMAA.
- Reconcile the statement P&I ($4,429.43) against the contractual April-2053
  maturity — the payment implies a ~14-year payoff (see README).
