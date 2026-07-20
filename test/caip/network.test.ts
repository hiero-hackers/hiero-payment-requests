import { describe, it, expect } from "vitest";
import {
  parseChain,
  formatChain,
  isNetwork,
  CaipError,
  HIERO_NETWORKS,
  NETWORKS,
  networkSpec,
} from "../../src/caip/index.js";

describe("CAIP-2 chains", () => {
  it.each(["hedera:mainnet", "hedera:testnet", "hedera:previewnet", "hedera:devnet"])(
    "round-trips %s",
    (caip2) => {
      expect(formatChain(parseChain(caip2))).toBe(caip2);
    },
  );

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

describe("the network table is the single source of truth", () => {
  it("references are unique — a parsed identifier names exactly one chain", () => {
    const refs = HIERO_NETWORKS.map((n) => n.reference);
    expect(new Set(refs).size).toBe(refs.length);
  });

  it("every row round-trips through parse and format", () => {
    for (const spec of HIERO_NETWORKS) {
      expect(parseChain(`${spec.namespace}:${spec.reference}`)).toBe(spec.reference);
      expect(formatChain(spec.reference)).toBe(`${spec.namespace}:${spec.reference}`);
    }
  });

  it("networkSpec is total over the Network type", () => {
    for (const n of NETWORKS) expect(networkSpec(n).reference).toBe(n);
  });

  it("an unknown chain error NAMES the known chains — closed set, said out loud", () => {
    expect(() => parseChain("acme:main")).toThrow(/known: hedera:mainnet/);
  });

  it("checksum verification is driven by the table's ledger ids", () => {
    // mainnet/testnet/previewnet have ledger ids; devnet's absence is the
    // documented reason its checksums are rejected rather than guessed.
    expect(HIERO_NETWORKS.filter((n) => n.ledgerId !== undefined)).toHaveLength(3);
    expect(networkSpec("devnet").ledgerId).toBeUndefined();
  });
});
