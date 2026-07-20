/**
 * bigint ↔ decimal text, with no float anywhere in the path. The round-trip
 * property is the theorem; the named cases are the classic float-bug wrecks
 * (sub-cent digits, 64-bit extremes) pinned individually.
 */
import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { formatBaseUnits, parseDecimalAmount, RequestError } from "../src/index.js";

describe("formatBaseUnits", () => {
  it("renders exactly, full precision by default", () => {
    expect(formatBaseUnits(100_000000n, 6)).toBe("100.000000");
    expect(formatBaseUnits(1n, 6)).toBe("0.000001");
    expect(formatBaseUnits(0n, 6)).toBe("0.000000");
    expect(formatBaseUnits(123n, 0)).toBe("123");
  });

  it("survives the 64-bit extreme a Number-based formatter corrupts", () => {
    // 9223372036854775807 is not representable as a float — a Number detour
    // renders …75808. The exact digits are the whole point.
    expect(formatBaseUnits(9223372036854775807n, 8)).toBe("92233720368.54775807");
  });

  it("trims trailing zeros on request, never significant ones", () => {
    expect(formatBaseUnits(100_000000n, 6, { trim: true })).toBe("100");
    expect(formatBaseUnits(1_500000n, 6, { trim: true })).toBe("1.5");
    expect(formatBaseUnits(1_050000n, 6, { trim: true })).toBe("1.05");
    expect(formatBaseUnits(0n, 6, { trim: true })).toBe("0");
  });

  it("formats signed amounts — receipts show negative movements", () => {
    expect(formatBaseUnits(-1_500000n, 6)).toBe("-1.500000");
    expect(formatBaseUnits(-1n, 2)).toBe("-0.01");
  });

  it("rejects nonsense decimals", () => {
    expect(() => formatBaseUnits(1n, -1)).toThrow(RequestError);
    expect(() => formatBaseUnits(1n, 2.5)).toThrow(RequestError);
    expect(() => formatBaseUnits(1n, 51)).toThrow(RequestError);
  });
});

describe("parseDecimalAmount", () => {
  it("parses exactly", () => {
    expect(parseDecimalAmount("100.5", 6)).toBe(100_500000n);
    expect(parseDecimalAmount("100", 6)).toBe(100_000000n);
    expect(parseDecimalAmount("0.000001", 6)).toBe(1n);
    expect(parseDecimalAmount("92233720368.54775807", 8)).toBe(9223372036854775807n);
    expect(parseDecimalAmount("7", 0)).toBe(7n);
  });

  it("rejects more precision than the asset has — no silent rounding, ever", () => {
    expect(() => parseDecimalAmount("0.1234567", 6)).toThrow(/will not round/);
    expect(() => parseDecimalAmount("1.5", 0)).toThrow(RequestError);
  });

  it("rejects every shape that is not plain digits-dot-digits", () => {
    for (const bad of ["", ".", "1.", ".5", "-1", "+1", "1e6", "0x10", "1 000", "1_000"]) {
      expect(() => parseDecimalAmount(bad, 6)).toThrow(RequestError);
    }
  });

  it("a comma gets a pointed error — half the world writes 1,5", () => {
    expect(() => parseDecimalAmount("1,5", 6)).toThrow(/use a dot/);
  });
});

describe("the round trip is exact", () => {
  it("parse(format(x)) ≡ x for arbitrary 64-bit amounts and decimals", () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: 0n, max: 9223372036854775807n }),
        fc.integer({ min: 0, max: 18 }),
        fc.boolean(),
        (amount, decimals, trim) => {
          const text = formatBaseUnits(amount, decimals, { trim });
          expect(parseDecimalAmount(text, decimals)).toBe(amount);
        },
      ),
    );
  });
});
