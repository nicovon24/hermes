import { describe, expect, it } from "vitest";
import { ENTRY_DURATION_MS, presentationBatchSize, presentationCadence, presentationIsBlocking } from "@/modules/protocol/domain/tender-presentation";

describe("readable live presentation", () => {
  it("keeps a brief entrance and a minimum normal cadence", () => {
    expect(ENTRY_DURATION_MS).toBe(650);
    expect(presentationCadence(1)).toBe(750);
    expect(presentationBatchSize(4, 2000, false)).toBe(1);
  });
  it("accelerates backlog and immediately catches up for reduced motion", () => {
    expect(presentationCadence(12)).toBeLessThan(presentationCadence(1));
    expect(presentationBatchSize(12, 2000, true)).toBe(12);
    expect(presentationBatchSize(12, 50_000, false)).toBe(12);
    expect(presentationBatchSize(0, 1000, false)).toBe(0);
  });
  it("unblocks at 55 seconds independently of business completion", () => {
    expect(presentationIsBlocking(54_999, false)).toBe(true);
    expect(presentationIsBlocking(55_000, false)).toBe(false);
    expect(presentationIsBlocking(2000, true)).toBe(false);
  });
});
