import { describe, it, expect } from "vitest";
import { parseChain, formatChain, isNetwork, CaipError } from "../../src/caip/index.js";

describe("CAIP-2 chains", () => {
  it.each(["hedera:mainnet", "hedera:testnet", "hedera:previewnet", "hedera:devnet"])("round-trips %s", (caip2) => {
    expect(formatChain(parseChain(caip2))).toBe(caip2);
  });

  it.each([
    ["eip155:1", "another chain's namespace"],
    ["hedera:nonesuch", "unknown network"],
    ["hedera", "no network"],
    ["hedera:mainnet:extra", "too many parts"],
    ["HEDERA:mainnet", "namespace is case-sensitive"],
  ])("rejects %s (%s)", (bad) => {
    expect(() => parseChain(bad)).toThrow(CaipError);
  });
});

describe("isNetwork — the type and the data share one source of truth", () => {
  it("accepts every network the type allows", () => {
    for (const n of ["mainnet", "testnet", "previewnet", "devnet"]) expect(isNetwork(n)).toBe(true);
  });

  it("rejects anything else", () => {
    expect(isNetwork("mainnet2")).toBe(false);
    expect(isNetwork("")).toBe(false);
  });
});
