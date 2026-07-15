import { describe, it, expect } from "vitest";
import { fulfils } from "../../src/adapters/notifications.js";
import { fromReceipt, type ReceiptLike } from "../../src/adapters/receipt.js";
import type { PaymentRequest } from "../../src/types.js";

const invoice: PaymentRequest = {
  recipient: "hedera:testnet:0.0.1234",
  asset: "hedera:testnet/token:0.0.720",
  amount: 100_000000n,
  reference: "INV-2026-041",
};

function receipt(amount: bigint, over: Partial<ReceiptLike> = {}): ReceiptLike {
  return {
    account: "0.0.1234",
    transactionId: "0.0.999@1783012000.000000000",
    consensusTimestamp: "1783012000.000000000",
    status: "success",
    memo: "INV-2026-041",
    movements: [{ asset: "0.0.720", amount, kind: "token" }],
    ...over,
  };
}

const condition = fulfils(invoice, (r: ReceiptLike) => fromReceipt(r, "testnet"));

describe("fulfils — the bridge to hiero-notifications", () => {
  it("is Condition-shaped: a name and a matches()", () => {
    // Structural compatibility with that library's `Condition<Receipt>` is the
    // whole point — it is why neither library depends on the other.
    expect(typeof condition.name).toBe("string");
    expect(typeof condition.matches).toBe("function");
  });

  it("names itself by the reference, so a watcher's log says which invoice", () => {
    expect(condition.name).toBe("fulfils(INV-2026-041)");
  });

  it("matches a receipt that pays the invoice exactly", () => {
    expect(condition.matches(receipt(100_000000n))).toBe(true);
  });
});

describe("fulfils — what it deliberately does NOT fire on", () => {
  it("does not fire on an underpayment", () => {
    expect(condition.matches(receipt(60_000000n))).toBe(false);
  });

  it("does not fire on an overpayment", () => {
    // Deliberate: `=== "paid"`. An overpayment is a fact the caller should see
    // and act on (refund the excess), not something a watcher quietly treats as
    // settled. Reach for `match` directly when you want the whole picture.
    expect(condition.matches(receipt(150_000000n))).toBe(false);
  });

  it("does not fire on a receipt carrying someone else's reference", () => {
    expect(condition.matches(receipt(100_000000n, { memo: "INV-2026-999" }))).toBe(false);
  });

  it("does not fire on a failed transaction", () => {
    expect(condition.matches(receipt(100_000000n, { status: "failed" }))).toBe(false);
  });

  it("does not fire on the wrong asset", () => {
    expect(condition.matches(receipt(100_000000n, { movements: [{ asset: "HBAR", amount: 100_000000n, kind: "hbar" }] }))).toBe(false);
  });

  it("does not fire when the receipt is for money SENT, not received", () => {
    expect(condition.matches(receipt(-100_000000n))).toBe(false);
  });

  it("cannot be satisfied by a mainnet payment against a testnet invoice", () => {
    const wrongNetwork = fulfils(invoice, (r: ReceiptLike) => fromReceipt(r, "mainnet"));
    expect(wrongNetwork.matches(receipt(100_000000n))).toBe(false);
  });
});

describe("fulfils — the single-receipt boundary", () => {
  it("sees one receipt at a time, so split payments never reach `paid`", () => {
    // A watcher hands over one receipt per transaction. Two 50s are each an
    // underpayment in isolation — aggregation needs `match` over both. This is
    // a real limitation of driving fulfilment from a per-transaction watcher,
    // and the reason `match` exists as the fuller API.
    expect(condition.matches(receipt(50_000000n))).toBe(false);
    expect(condition.matches(receipt(50_000000n))).toBe(false);
  });
});
