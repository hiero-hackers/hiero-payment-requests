/**
 * The memo-free strategy: the amount IS the reference. Assignment gives each
 * open invoice a unique amount; correlation recognises exactly that amount
 * and — deliberately — nothing else. The "harsh" cases pinned here (fee-
 * skimmed and overpaid report `unpaid`) are the strategy's documented trade,
 * not bugs: with no other correlator, near-misses cannot honestly be claimed
 * for THIS request.
 */
import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  assignDistinctAmount,
  byUniqueAmount,
  match,
  RequestError,
  type Payment,
  type PaymentRequest,
} from "../../src/index.js";

import { USDC } from "../fixtures.js";

const request = (amount: bigint, reference: string): PaymentRequest => ({
  recipient: "hedera:mainnet:0.0.1234",
  asset: "hedera:mainnet/token:0.0.720",
  amount,
  reference,
});

const memoless = (amount: bigint, transactionId: string): Payment => ({
  transactionId,
  consensusTimestamp: "1783012000.000000000",
  network: "mainnet",
  memo: "", // the whole point: no wallet cooperation required
  succeeded: true,
  credits: [{ account: "0.0.1234", asset: USDC, amount }],
});

describe("assignDistinctAmount", () => {
  it("returns the base price when no invoice holds it", () => {
    expect(assignDistinctAmount(100_000000n, [])).toBe(100_000000n);
  });

  it("steps upward past taken amounts — never below the price", () => {
    const taken = [100_000000n, 100_000001n];
    expect(assignDistinctAmount(100_000000n, taken)).toBe(100_000002n);
  });

  it("throws when the window is exhausted, naming the ceiling", () => {
    const taken = [10n, 11n, 12n];
    expect(() => assignDistinctAmount(10n, taken, { maxDelta: 2n })).toThrow(RequestError);
    expect(() => assignDistinctAmount(10n, taken, { maxDelta: 2n })).toThrow(/ceiling/);
  });

  it("rejects nonsense inputs", () => {
    expect(() => assignDistinctAmount(0n, [])).toThrow(/positive/);
    expect(() => assignDistinctAmount(10n, [], { maxDelta: -1n })).toThrow(/negative/);
  });

  it("property: the result is fresh, and within [base, base+maxDelta]", () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: 1n, max: 1_000_000n }),
        fc.array(fc.bigInt({ min: 1n, max: 1_000_100n }), { maxLength: 50 }),
        (base, taken) => {
          const assigned = assignDistinctAmount(base, taken, { maxDelta: 200n });
          expect(taken).not.toContain(assigned);
          expect(assigned >= base).toBe(true);
          expect(assigned <= base + 200n).toBe(true);
        },
      ),
    );
  });
});

describe("byUniqueAmount correlation", () => {
  const opts = { correlate: byUniqueAmount };

  it("an exact memoless payment is paid — no wallet memo support needed", () => {
    const req = request(100_000002n, "INV-A");
    const result = match(req, [memoless(100_000002n, "0.0.9@1.1")], opts);
    expect(result).toMatchObject({ status: "paid", received: 100_000002n });
  });

  it("two open invoices with assigned amounts each match only their payment", () => {
    const a = request(100_000000n, "INV-A");
    const b = request(assignDistinctAmount(100_000000n, [a.amount]), "INV-B");
    const payA = memoless(100_000000n, "0.0.9@1.1");
    const payB = memoless(100_000001n, "0.0.9@2.2");
    expect(match(a, [payA, payB], opts).status).toBe("paid");
    expect(match(b, [payA, payB], opts).status).toBe("paid");
    expect(match(a, [payB], opts).status).toBe("unpaid");
  });

  it("a near-miss amount reports unpaid — the documented trade, not a bug", () => {
    const req = request(100n, "INV-A");
    // Underpaid, overpaid, and fee-skimmed (asked 100, credited 98) all look
    // the same to this strategy: not correlated, therefore unpaid.
    for (const credited of [98n, 99n, 101n]) {
      expect(match(req, [memoless(credited, "0.0.9@1.1")], opts).status).toBe("unpaid");
    }
  });

  it("re-delivery is still idempotent — canonicalization is the pipeline's, not the strategy's", () => {
    const req = request(100n, "INV-A");
    const p = memoless(100n, "0.0.9@1.1");
    expect(match(req, [p, p], opts).status).toBe("paid");
  });

  it("a failed transaction with the right amount never correlates", () => {
    const req = request(100n, "INV-A");
    expect(match(req, [{ ...memoless(100n, "0.0.9@1.1"), succeeded: false }], opts).status).toBe(
      "unpaid",
    );
  });
});
