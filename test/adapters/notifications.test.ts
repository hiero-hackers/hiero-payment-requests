import { describe, it, expect } from "vitest";
import { fulfils, fulfilsAccumulating } from "../../src/adapters/notifications.js";
import { fromReceipt, type ReceiptLike } from "../../src/adapters/receipt.js";
import type { Payment, PaymentRequest } from "../../src/types.js";

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
    expect(
      condition.matches(
        receipt(100_000000n, { movements: [{ asset: "HBAR", amount: 100_000000n, kind: "hbar" }] }),
      ),
    ).toBe(false);
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

describe("fulfilsAccumulating — partial payments complete the watch-loop story (audit #3)", () => {
  const request: PaymentRequest = {
    recipient: "hedera:mainnet:0.0.1234",
    asset: "hedera:mainnet/token:0.0.720",
    amount: 100n,
    reference: "INV-ACC-1",
  };
  const payment = (transactionId: string, amount: bigint, memo = "for INV-ACC-1"): Payment => ({
    transactionId,
    consensusTimestamp: "1.000000000",
    network: "mainnet",
    memo,
    succeeded: true,
    credits: [
      {
        account: "0.0.1234",
        asset: { kind: "token", network: "mainnet", id: { shard: 0n, realm: 0n, num: 720n } },
        amount,
      },
    ],
  });

  it("fires on the receipt that completes 60 + 40 — the case fulfils can never see", () => {
    const condition = fulfilsAccumulating(request, (p: Payment) => p);
    expect(condition.matches(payment("0.0.9-1-1", 60n))).toBe(false); // underpaid so far
    expect(condition.matches(payment("0.0.9-2-2", 40n))).toBe(true); // completed here
  });

  it("fires exactly once — later payments to a settled request stay silent", () => {
    const condition = fulfilsAccumulating(request, (p: Payment) => p);
    condition.matches(payment("0.0.9-1-1", 60n));
    expect(condition.matches(payment("0.0.9-2-2", 40n))).toBe(true);
    expect(condition.matches(payment("0.0.9-3-3", 25n))).toBe(false); // extra money, no re-fire
  });

  it("re-delivery cannot complete a payment twice or early (at-least-once safe)", () => {
    const condition = fulfilsAccumulating(request, (p: Payment) => p);
    const first = payment("0.0.9-1-1", 60n);
    expect(condition.matches(first)).toBe(false);
    expect(condition.matches(first)).toBe(false); // same tx again: not new money
    expect(condition.matches(payment("0.0.9-2-2", 40n))).toBe(true);
    expect(condition.matches(payment("0.0.9-2-2", 40n))).toBe(false); // replayed completion
  });

  it("completion by overpayment still completes — 60 + 50 fires", () => {
    const condition = fulfilsAccumulating(request, (p: Payment) => p);
    condition.matches(payment("0.0.9-1-1", 60n));
    expect(condition.matches(payment("0.0.9-2-2", 50n))).toBe(true);
  });

  it("unrelated receipts neither fire nor accumulate", () => {
    const condition = fulfilsAccumulating(request, (p: Payment) => p);
    expect(condition.matches(payment("0.0.9-1-1", 100n, "some other memo"))).toBe(false);
    // The full amount arriving later still fires — the unrelated one contributed nothing.
    expect(condition.matches(payment("0.0.9-2-2", 100n))).toBe(true);
  });

  it("the stateless fulfils stays strict — the two variants are different promises", () => {
    const strict = fulfils(request, (p: Payment) => p);
    expect(strict.matches(payment("0.0.9-1-1", 60n))).toBe(false);
    expect(strict.matches(payment("0.0.9-2-2", 40n))).toBe(false); // stateless: 40 alone ≠ paid
  });
});
