/**
 * The wallet-facing extraction: plain fields out, CAIP knowledge kept in.
 * The one contract that matters most is pinned twice: `memo` IS the
 * reference — the thing that makes the eventual payment correlatable.
 */
import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { paymentInstructions, CaipError } from "../src/index.js";
import { BASE, arbRequest } from "./fixtures.js";

describe("paymentInstructions", () => {
  it("hands a wallet exactly the transfer fields", () => {
    expect(paymentInstructions(BASE)).toEqual({
      network: "mainnet",
      recipient: "0.0.1234",
      asset: { kind: "token", id: "0.0.720" },
      amount: 100_000000n,
      memo: "INV-2026-041",
    });
  });

  it("verifies a checksummed recipient, then hands the wallet the bare id", () => {
    // 0.0.123-vfmkw is genuine (SDK vector). Wallets take shard.realm.num.
    const r = paymentInstructions({ ...BASE, recipient: "hedera:mainnet:0.0.123-vfmkw" });
    expect(r.recipient).toBe("0.0.123");
    // And a WRONG checksum fails HERE, not inside somebody's wallet.
    expect(() =>
      paymentInstructions({ ...BASE, recipient: "hedera:mainnet:0.0.123-wrong" }),
    ).toThrow(CaipError);
  });

  it("an HBAR request instructs an hbar transfer", () => {
    const r = paymentInstructions({ ...BASE, asset: "hedera:mainnet/slip44:3030" });
    expect(r.asset).toEqual({ kind: "hbar" });
  });

  it("an NFT request carries the serial — the wallet transfers that exact one", () => {
    const r = paymentInstructions({
      ...BASE,
      asset: "hedera:mainnet/nft:0.0.721/3",
      amount: 1n,
    });
    expect(r.asset).toEqual({ kind: "nft", id: "0.0.721", serial: 3n });
    expect(r.amount).toBe(1n);
  });

  it("carries expiresAt when present, omits the key when not", () => {
    expect(paymentInstructions(BASE)).not.toHaveProperty("expiresAt");
    const r = paymentInstructions({ ...BASE, expiresAt: "1783012345.000000000" });
    expect(r.expiresAt).toBe("1783012345.000000000");
  });

  it("property: memo ≡ reference and amount ≡ amount — the correlation contract", () => {
    const arb = arbRequest({ networks: ["mainnet"], assets: ["hbar"] });
    fc.assert(
      fc.property(arb, (request) => {
        const instructions = paymentInstructions(request);
        expect(instructions.memo).toBe(request.reference);
        expect(instructions.amount).toBe(request.amount);
        expect(instructions.recipient).not.toContain("-"); // bare id, never a checksum
      }),
    );
  });
});
