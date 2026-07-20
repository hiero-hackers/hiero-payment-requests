/**
 * HIP-15 checksum verification, cross-checked against the OFFICIAL Hiero SDK:
 * every vector below is `AccountId.toStringWithChecksum(client)` output from
 * @hiero-ledger/sdk 2.85.0, across all three ledger ids, including CAIP-76's
 * 64-bit extreme. If our algorithm and the SDK's ever disagree, these fail.
 */
import { describe, expect, it } from "vitest";
import { expectedChecksum, verifyEntityChecksum } from "../../src/caip/checksum.js";
import { parseAccount } from "../../src/caip/account.js";
import { parseEntityId } from "../../src/caip/entity.js";
import { CaipError } from "../../src/caip/error.js";
import { createRequest } from "../../src/index.js";

const SDK_VECTORS: Array<["mainnet" | "testnet" | "previewnet", string, string]> = [
  ["mainnet", "0.0.123", "vfmkw"],
  ["mainnet", "0.0.1234", "pikcw"],
  ["mainnet", "0.0.9025", "ggoek"],
  ["mainnet", "1.2.3", "islfi"],
  ["mainnet", "0.0.9223372036854775807", "eaglu"],
  ["testnet", "0.0.123", "esxsf"],
  ["testnet", "0.0.1234", "yvvkf"],
  ["testnet", "0.0.9025", "ptzlt"],
  ["testnet", "1.2.3", "sfwmr"],
  ["testnet", "0.0.9223372036854775807", "nnrtd"],
  ["previewnet", "0.0.123", "ogizo"],
  ["previewnet", "0.0.1234", "ijgro"],
  ["previewnet", "0.0.9025", "zhktc"],
  ["previewnet", "1.2.3", "bthua"],
  ["previewnet", "0.0.9223372036854775807", "xbdam"],
];

describe("expectedChecksum agrees with the official SDK", () => {
  it.each(SDK_VECTORS)("%s %s → %s", (network, address, checksum) => {
    expect(expectedChecksum(address, network)).toBe(checksum);
  });
});

describe("verification at the parse boundary", () => {
  it("a correct checksum parses", () => {
    expect(() => parseAccount("hedera:mainnet:0.0.123-vfmkw")).not.toThrow();
  });

  it("a WRONG checksum is rejected, naming the expected one", () => {
    expect(() => parseAccount("hedera:mainnet:0.0.123-esxsf")).toThrow(/expected "vfmkw"/);
  });

  it("the same checksum is network-specific — testnet's is wrong on mainnet", () => {
    // esxsf IS valid for 0.0.123 — on testnet.
    expect(() => parseAccount("hedera:testnet:0.0.123-esxsf")).not.toThrow();
    expect(() => parseAccount("hedera:mainnet:0.0.123-esxsf")).toThrow(CaipError);
  });

  it("devnet checksums are unverifiable and say so", () => {
    expect(() => parseAccount("hedera:devnet:0.0.123-vfmkw")).toThrow(/no.*ledger id.*omit/s);
  });

  it("no checksum, no verification — bare ids always pass", () => {
    expect(() => parseAccount("hedera:devnet:0.0.123")).not.toThrow();
    verifyEntityChecksum(parseEntityId("0.0.123"), "mainnet", "test"); // no throw
  });

  it("a mistyped recipient is caught at createRequest, before it is ever shared", () => {
    expect(() =>
      createRequest({
        recipient: "hedera:mainnet:0.0.124-vfmkw", // checksum of 0.0.123 — a typo'd digit
        asset: "hedera:mainnet/token:0.0.720",
        amount: 1n,
        reference: "INV-1",
      }),
    ).toThrow(/mistyped or meant for another network/);
  });

  it("token asset checksums are verified too", () => {
    expect(() =>
      createRequest({
        recipient: "hedera:mainnet:0.0.123-vfmkw",
        asset: "hedera:mainnet/token:0.0.1234-pikcw",
        amount: 1n,
        reference: "INV-1",
      }),
    ).not.toThrow();
    expect(() =>
      createRequest({
        recipient: "hedera:mainnet:0.0.123-vfmkw",
        asset: "hedera:mainnet/token:0.0.1234-wrong",
        amount: 1n,
        reference: "INV-1",
      }),
    ).toThrow(CaipError);
  });
});
