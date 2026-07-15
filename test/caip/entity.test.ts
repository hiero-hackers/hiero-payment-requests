import { describe, it, expect } from "vitest";
import { parseEntityId, tryParseEntityId, formatEntityId, entityKey, sameEntity, CaipError } from "../../src/caip/index.js";

describe("entity ids — shard.realm.num", () => {
  it("round-trips, with and without a checksum", () => {
    expect(formatEntityId(parseEntityId("0.0.1234"))).toBe("0.0.1234");
    expect(formatEntityId(parseEntityId("0.0.123-vfmkw"))).toBe("0.0.123-vfmkw");
  });

  it("keeps 64-bit ids exact — the value a number-based parser corrupts", () => {
    const id = parseEntityId("9223372036854775807.9223372036854775807.9223372036854775807");
    expect(id.num).toBe(9223372036854775807n);
    // The proof this matters: through a double, that id is a different number.
    expect(Number(id.num).toString()).not.toBe("9223372036854775807");
  });

  it("reads non-zero shard and realm — 11.12.2 is a real preview-network id", () => {
    expect(parseEntityId("11.12.2")).toMatchObject({ shard: 11n, realm: 12n, num: 2n });
  });

  it.each([
    ["0.0", "too few parts"],
    ["0.0.0.0", "too many parts"],
    ["-1.0.720", "negative shard"],
    ["0.0.1.5", "decimal"],
    ["0.0.1-VFMKW", "checksum must be lowercase"],
    ["0.0.1-abc", "checksum must be five letters"],
    ["0.0.", "empty component"],
    ["a.b.c", "not digits"],
  ])("rejects %s (%s)", (bad) => {
    expect(() => parseEntityId(bad)).toThrow(CaipError);
  });
});

describe("tryParseEntityId — filtering shouldn't need try/catch", () => {
  it("returns undefined on bad input, a value on good", () => {
    expect(tryParseEntityId("nonsense")).toBeUndefined();
    expect(tryParseEntityId("0.0.1234")?.num).toBe(1234n);
  });
});

describe("entityKey — identity, checksum stripped", () => {
  it("drops the checksum, because it guards the text and not the identity", () => {
    expect(entityKey({ shard: 0n, realm: 0n, num: 123n, checksum: "vfmkw" })).toBe("0.0.123");
  });

  it("sameEntity ignores the checksum", () => {
    expect(sameEntity({ shard: 0n, realm: 0n, num: 1n }, { shard: 0n, realm: 0n, num: 1n, checksum: "vfmkw" })).toBe(true);
  });

  it("sameEntity separates different ids", () => {
    expect(sameEntity({ shard: 0n, realm: 0n, num: 1n }, { shard: 0n, realm: 0n, num: 2n })).toBe(false);
    expect(sameEntity({ shard: 0n, realm: 0n, num: 1n }, { shard: 1n, realm: 0n, num: 1n })).toBe(false);
  });
});
