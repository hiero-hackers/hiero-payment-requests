import { describe, it, expect } from "vitest";
import { parseAccount, tryParseAccount, formatAccount, accountKey, sameAccount, CaipError } from "../../src/caip/index.js";

/** Lifted verbatim from CAIP-76. The spec is the reference, not our imagination. */
const SPEC_VECTORS = [
  "hedera:devnet:0.0.98",
  "hedera:mainnet:0.0.2",
  "hedera:previewnet:0.0.121",
  "hedera:mainnet:0.0.123-vfmkw",
  "hedera:testnet:9223372036854775807.9223372036854775807.9223372036854775807",
];

describe("CAIP-10 accounts — the spec's own vectors", () => {
  it.each(SPEC_VECTORS)("round-trips %s exactly", (caip10) => {
    expect(formatAccount(parseAccount(caip10))).toBe(caip10);
  });

  it("parses the network out of the identifier, so a request can't span networks", () => {
    expect(parseAccount("hedera:testnet:0.0.5").network).toBe("testnet");
  });

  it.each([
    ["eip155:1:0.0.1", "wrong namespace"],
    ["hedera:nonesuch:0.0.1", "unknown network"],
    ["hedera:mainnet:0.0", "not shard.realm.num"],
    ["hedera:mainnet:0.0.-1", "negative"],
    ["hedera:mainnet", "missing address"],
    ["0.0.1234", "bare id, no chain"],
  ])("rejects %s (%s)", (bad) => {
    expect(() => parseAccount(bad)).toThrow(CaipError);
  });
});

describe("tryParseAccount", () => {
  it("returns undefined on bad input, a value on good", () => {
    expect(tryParseAccount("nonsense")).toBeUndefined();
    expect(tryParseAccount("hedera:mainnet:0.0.2")?.network).toBe("mainnet");
  });
});

describe("accountKey — identity is the canonical string", () => {
  it("a checksum changes the text but never the identity", () => {
    const withSum = parseAccount("hedera:mainnet:0.0.123-vfmkw");
    const without = parseAccount("hedera:mainnet:0.0.123");
    expect(formatAccount(withSum)).not.toBe(formatAccount(without));
    expect(accountKey(withSum)).toBe(accountKey(without));
    expect(sameAccount(withSum, without)).toBe(true);
  });

  it("the same account on two networks is two accounts", () => {
    expect(sameAccount(parseAccount("hedera:mainnet:0.0.2"), parseAccount("hedera:testnet:0.0.2"))).toBe(false);
  });

  it("is usable as a Map key — the reason it exists", () => {
    const seen = new Map<string, number>();
    seen.set(accountKey(parseAccount("hedera:mainnet:0.0.123")), 1);
    expect(seen.get(accountKey(parseAccount("hedera:mainnet:0.0.123-vfmkw")))).toBe(1);
  });
});
