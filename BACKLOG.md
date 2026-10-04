# Backlog

Not yet modeled, roughly in priority order.

1. **Lumpy one-time expenses** — a schedule of car replacements (every ~10
   years), roof/HVAC, weddings, help with a kid's down payment.
2. **College model** — 529 growth vs projected tuition; any gap lands in bridge
   years. 529 balances are currently excluded from the model entirely.
3. **RMDs at 73** — forced traditional withdrawals late in the horizon; these
   interact with tax.
4. **Real SS estimates** — the defaults are placeholders; use ssa.gov numbers and
   model the claiming-age tradeoff (62 vs 67 vs 70).
5. ~~**72(t)/SEPP**~~ — DONE (fixed-amortization method, per-spouse start-year
   sliders). Remaining refinement: model splitting an IRA so the SEPP covers a
   SLICE of a spouse's traditional instead of the whole bucket (real-world
   payment-sizing trick; the model currently SEPPs the full spouse balance).
6. **Survivor / single-death scenario** — pension survivor benefit, SS
   survivor rules, spending reduction, term-life proceeds during the bridge.
7. **Long-term-care shock** late in life.
8. **Nominal-dollar display toggle.**
9. **Tax-loss harvesting** in taxable during down years.
10. **Roth vs traditional 401k routing optimizer** — which spouse should
    contribute to which, for the remaining working years.

Model-quality improvements:

- Exact current-year tax tables (currently 2025 MFJ figures).
- Progressive state tax brackets (today: one flat rate above an exemption).
- Replace the approximate historical return series with exact Shiller data.
- Smarter conversion sizing: optimize against the ACA subsidy schedule
  instead of blind bracket-filling (the single highest-value refinement).
- Per-spouse HSA 65+ unlock; NIIT and IRMAA.
