import { describe, it, expect } from "vitest";
import { match } from "../../src/match/index.js";
import type { Payment, PaymentRequest } from "../../src/types.js";

const REQUEST: PaymentRequest = {
  recipient: "hedera:mainnet:0.0.1234",
  asset: "hedera:mainnet/token:0.0.720",
  amount: 100_000000n, // 100 USDC at 6 decimals
  reference: "INV-2026-041",
  expiresAt: "1783012345.000000000",
};

const USDC = {
  kind: "token",
  network: "mainnet",
  id: { shard: 0n, realm: 0n, num: 720n },
} as const;

function payment(over: Partial<Payment> = {}): Payment {
  return {
    transactionId: "0.0.999@1783012000.000000000",
    consensusTimestamp: "1783012000.000000000",
    network: "mainnet",
    memo: "INV-2026-041",
    succeeded: true,
    credits: [{ account: "0.0.1234", asset: USDC, amount: 100_000000n }],
    ...over,
  };
}

describe("the happy path", () => {
  it("marks an exact payment paid", () => {
    const result = match(REQUEST, [payment()]);
    expect(result).toMatchObject({ status: "paid", received: 100_000000n, late: false });
  });

  it("accepts a decorated memo — humans and wallets add words around a reference", () => {
    expect(match(REQUEST, [payment({ memo: "Inv INV-2026-041 — thanks!" })]).status).toBe("paid");
  });
});

describe("nothing to match", () => {
  it("is unpaid with no correlated payments", () => {
    expect(match(REQUEST, []).status).toBe("unpaid");
  });

  it("is unpaid when the memo carries someone else's reference", () => {
    expect(match(REQUEST, [payment({ memo: "INV-2026-042" })]).status).toBe("unpaid");
  });

  it("is expired only once `now` is past expiry", () => {
    expect(match(REQUEST, [], { now: "1783012344.000000000" }).status).toBe("unpaid");
    expect(match(REQUEST, [], { now: "1783012346.000000000" }).status).toBe("expired");
  });
});

describe("the facts a merchant needs to tell apart", () => {
  it("reports a shortfall rather than silently failing", () => {
    const result = match(REQUEST, [
      payment({ credits: [{ account: "0.0.1234", asset: USDC, amount: 60_000000n }] }),
    ]);
    expect(result).toMatchObject({
      status: "underpaid",
      received: 60_000000n,
      shortfall: 40_000000n,
    });
  });

  it("aggregates several payments carrying the same reference", () => {
    const half = (id: string) =>
      payment({
        transactionId: id,
        credits: [{ account: "0.0.1234", asset: USDC, amount: 50_000000n }],
      });
    const result = match(REQUEST, [half("a"), half("b")]);
    expect(result).toMatchObject({ status: "paid", received: 100_000000n });
  });

  it("surfaces a DOUBLE PAYMENT as overpaid with both transactions — never swallowed", () => {
    const result = match(REQUEST, [
      payment({ transactionId: "a" }),
      payment({ transactionId: "b" }),
    ]);
    expect(result).toMatchObject({
      status: "overpaid",
      received: 200_000000n,
      excess: 100_000000n,
    });
    if (result.status !== "overpaid") throw new Error("unreachable");
    expect(result.payments).toHaveLength(2); // the merchant can refund the duplicate
  });

  it("flags a late payment as a fact, without deciding whether you accept it", () => {
    const result = match(REQUEST, [payment({ consensusTimestamp: "1783012999.000000000" })]);
    expect(result).toMatchObject({ status: "paid", late: true });
  });

  it("distinguishes the wrong asset from unpaid", () => {
    const hbar = { kind: "hbar", network: "mainnet" } as const;
    const result = match(REQUEST, [
      payment({ credits: [{ account: "0.0.1234", asset: hbar, amount: 100_000000n }] }),
    ]);
    expect(result.status).toBe("wrong-asset");
  });
});

describe("the traps", () => {
  it("reads the recipient's CREDIT, so an HTS custom fee shows as a shortfall", () => {
    // Customer sends 100; a fractional custom fee skims 2; we are credited 98.
    // Matching the sender's intent would call this paid — and be 2 short.
    const result = match(REQUEST, [
      payment({ credits: [{ account: "0.0.1234", asset: USDC, amount: 98_000000n }] }),
    ]);
    expect(result).toMatchObject({
      status: "underpaid",
      received: 98_000000n,
      shortfall: 2_000000n,
    });
  });

  it("ignores a payment that credited somebody else", () => {
    expect(
      match(REQUEST, [
        payment({ credits: [{ account: "0.0.9999", asset: USDC, amount: 100_000000n }] }),
      ]).status,
    ).toBe("wrong-asset");
  });

  it("ignores a failed transaction that reached consensus", () => {
    expect(match(REQUEST, [payment({ succeeded: false })]).status).toBe("unpaid");
  });

  it("never lets a TESTNET payment settle a MAINNET request", () => {
    expect(match(REQUEST, [payment({ network: "testnet" })]).status).toBe("unpaid");
  });

  it("compares timestamps numerically, not lexically", () => {
    // "1783012345.9" > "1783012345.000000000" as an instant, but a naive string
    // compare of the nanos ("9" vs "000000000") gets this backwards.
    const result = match(REQUEST, [payment({ consensusTimestamp: "1783012345.9" })]);
    expect(result).toMatchObject({ status: "paid", late: true });
  });
});
