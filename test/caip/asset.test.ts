import { describe, it, expect } from "vitest";
import {
  parseAsset,
  tryParseAsset,
  formatAsset,
  assetKey,
  sameAsset,
  CaipError,
  HBAR_SLIP44,
} from "../../src/caip/index.js";

describe("CAIP-19 assets — HIP-30's vectors", () => {
  it.each([
    "hedera:mainnet/token:0.0.720",
    "hedera:mainnet/token:0.0.123-vfmkw",
    "hedera:mainnet/nft:0.0.721/3",
    "hedera:mainnet/nft:0.0.123-vfmkw/3",
  ])("round-trips %s exactly", (caip19) => {
    expect(formatAsset(parseAsset(caip19))).toBe(caip19);
  });

  it("reads an NFT's serial without eating the token's checksum", () => {
    const nft = parseAsset("hedera:mainnet/nft:0.0.123-vfmkw/3");
    expect(nft).toMatchObject({ kind: "nft", serial: 3n });
    if (nft.kind !== "nft") throw new Error("unreachable");
    expect(nft.id.num).toBe(123n);
    expect(nft.id.checksum).toBe("vfmkw");
  });

  it.each([
    ["hedera:mainnet/token:0.0.720/3", "token with a serial"],
    ["hedera:mainnet/nft:0.0.721", "NFT without a serial"],
    ["hedera:mainnet/erc20:0.0.720", "unknown asset namespace"],
    ["hedera:mainnet", "no asset part"],
    ["hedera:mainnet/token", "no asset reference"],
  ])("rejects %s (%s)", (bad) => {
    expect(() => parseAsset(bad)).toThrow(CaipError);
  });
});

describe("native HBAR — PROVISIONAL, not in HIP-30", () => {
  it("parses and round-trips the slip44 form we invented", () => {
    const hbar = parseAsset(`hedera:mainnet/slip44:${HBAR_SLIP44}`);
    expect(hbar).toEqual({ kind: "hbar", network: "mainnet" });
    expect(formatAsset(hbar)).toBe("hedera:mainnet/slip44:3030");
  });

  it("rejects another chain's coin type — 60 is ETH, not HBAR", () => {
    expect(() => parseAsset("hedera:mainnet/slip44:60")).toThrow(CaipError);
  });
});

describe("tryParseAsset", () => {
  it("returns undefined on bad input, a value on good", () => {
    expect(tryParseAsset("nonsense")).toBeUndefined();
    expect(tryParseAsset("hedera:mainnet/token:0.0.720")?.kind).toBe("token");
  });
});

describe("assetKey — identity, checksum stripped", () => {
  it("a checksum never changes identity", () => {
    expect(assetKey(parseAsset("hedera:mainnet/token:0.0.123-vfmkw"))).toBe(
      assetKey(parseAsset("hedera:mainnet/token:0.0.123")),
    );
  });

  it("separates the things it must", () => {
    const a = parseAsset("hedera:mainnet/nft:0.0.721/3");
    expect(sameAsset(a, parseAsset("hedera:mainnet/nft:0.0.721/4"))).toBe(false); // serial
    expect(sameAsset(a, parseAsset("hedera:testnet/nft:0.0.721/3"))).toBe(false); // network
    expect(sameAsset(a, parseAsset("hedera:mainnet/token:0.0.721"))).toBe(false); // kind
    expect(sameAsset(a, parseAsset("hedera:mainnet/nft:0.0.721-psrfq/3"))).toBe(true); // checksum
  });

  it("mainnet HBAR is not testnet HBAR", () => {
    expect(
      sameAsset(parseAsset("hedera:mainnet/slip44:3030"), parseAsset("hedera:testnet/slip44:3030")),
    ).toBe(false);
  });

  it("is usable as a Map key", () => {
    const seen = new Map<string, number>();
    seen.set(assetKey(parseAsset("hedera:mainnet/token:0.0.720")), 1);
    expect(seen.get(assetKey(parseAsset("hedera:mainnet/token:0.0.720-hitxz")))).toBe(1);
  });
});
