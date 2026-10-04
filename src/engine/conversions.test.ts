import { describe, expect, it } from "vitest";
import { convert, maturePipeline, pipelineTotal } from "./conversions";
import type { SpouseAccounts } from "./types";

function spouse(trad: number): SpouseAccounts {
  return { rothBasis: 0, rothEarnings: 0, rothPipeline: [], trad };
}

describe("Roth conversion ladder", () => {
  it("a conversion matures into basis exactly 5 years later, not before", () => {
    const sp = spouse(100_000);
    convert([{ sp, unlockT: 25 }], 40_000, 3);
    expect(sp.trad).toBe(60_000);
    expect(pipelineTotal(sp)).toBe(40_000);

    maturePipeline(sp, 7); // t+4 — still seasoning
    expect(sp.rothBasis).toBe(0);
    maturePipeline(sp, 8); // t+5 — unlocked
    expect(sp.rothBasis).toBe(40_000);
    expect(pipelineTotal(sp)).toBe(0);
  });

  it("draws from the later-unlocking spouse first", () => {
    const spouseA = spouse(50_000); // unlocks later
    const spouseB = spouse(50_000);
    convert(
      [
        { sp: spouseA, unlockT: 25 },
        { sp: spouseB, unlockT: 21 },
      ],
      60_000,
      0,
    );
    expect(spouseA.trad).toBe(0); // drained first
    expect(spouseB.trad).toBe(40_000);
  });

  it("conversion is capped by available traditional balances", () => {
    const sp = spouse(30_000);
    const converted = convert([{ sp, unlockT: 25 }], 100_000, 0);
    expect(converted).toBe(30_000);
    expect(sp.trad).toBe(0);
  });
});
