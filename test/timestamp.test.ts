import { describe, it, expect } from "vitest";
import { compareTimestamps, isAfter, isConsensusTimestamp } from "../src/timestamp.js";

describe("compareTimestamps", () => {
  it("orders by seconds, then nanos", () => {
    expect(compareTimestamps("2.0", "10.0")).toBeLessThan(0);
    expect(compareTimestamps("10.000000002", "10.000000001")).toBeGreaterThan(0);
  });

  it("treats fractional digits as nanos, so `.5` is 500000000", () => {
    expect(compareTimestamps("10.5", "10.500000000")).toBe(0);
  });

  it("does not fall for the lexical trap", () => {
    // "9" < "000000000" as text; as nanos, 900000000 > 0.
    expect(compareTimestamps("10.9", "10.000000000")).toBeGreaterThan(0);
  });

  it("does not fall for the float trap — nanos beyond double precision", () => {
    // Number("1783012345.000000001") === Number("1783012345.000000002"): a float
    // cannot separate these instants. Integers can.
    expect(compareTimestamps("1783012345.000000001", "1783012345.000000002")).toBeLessThan(0);
  });

  it("handles a bare seconds value as .0", () => {
    expect(compareTimestamps("10", "10.000000000")).toBe(0);
    expect(compareTimestamps("10", "10.000000001")).toBeLessThan(0);
  });

  it("handles seconds beyond Number.MAX_SAFE_INTEGER", () => {
    expect(compareTimestamps("9223372036854775807.0", "9223372036854775806.0")).toBeGreaterThan(0);
  });
});

describe("isAfter", () => {
  it("reads the way callers ask the question", () => {
    expect(isAfter("10.000000001", "10.000000000")).toBe(true);
    expect(isAfter("10.000000000", "10.000000001")).toBe(false);
    expect(isAfter("10.0", "10.0")).toBe(false); // strictly after
  });
});

describe("isConsensusTimestamp", () => {
  it.each(["0", "1783012345", "1783012345.0", "1783012345.000000000", "1783012345.9"])("accepts %s", (ts) => {
    expect(isConsensusTimestamp(ts)).toBe(true);
  });

  it.each([
    ["2026-07-15T00:00:00Z", "wall clock, not consensus"],
    ["1783012345.0000000000", "ten fractional digits — beyond nanosecond"],
    ["-1", "negative"],
    ["1783012345.", "trailing dot"],
    ["", "empty"],
    ["abc", "not a number"],
  ])("rejects %s (%s)", (ts) => {
    expect(isConsensusTimestamp(ts)).toBe(false);
  });
});
