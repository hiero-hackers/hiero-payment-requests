/**
 * Property tests — the invariants the match pipeline must hold for ALL
 * inputs, not just the examples: arithmetic consistency between amount,
 * received, shortfall and excess; classification totality; and order
 * independence (a merchant's fulfilment cannot depend on which order the
 * mirror returned the payments).
 */
import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { match } from "../../src/index.js";
import type { Payment, PaymentRequest } from "../../src/index.js";

const REQUEST: PaymentRequest = {
  recipient: "hedera:mainnet:0.0.1234",
  asset: "hedera:mainnet/token:0.0.720",
  amount: 100_000000n,
  reference: "INV-PROP-1",
};

const arbPayment = (reference: string): fc.Arbitrary<Payment> =>
  fc
    .record({
      amount: fc.bigInt({ min: 1n, max: 300_000000n }),
      seconds: fc.integer({ min: 1, max: 2_000_000_000 }),
      carriesRef: fc.boolean(),
      succeeded: fc.boolean(),
    })
    .map(({ amount, seconds, carriesRef, succeeded }, i = seconds) => ({
      transactionId: `0.0.9-${seconds}-${i}`,
      consensusTimestamp: `${seconds}.000000000`,
      network: "mainnet",
      memo: carriesRef ? `paying ${reference}` : "unrelated memo",
      succeeded,
      credits: [
        {
          account: "0.0.1234",
          asset: {
            kind: "token" as const,
            network: "mainnet",
            id: { shard: 0n, realm: 0n, num: 720n },
          },
          amount,
        },
      ],
    }));

describe("match invariants (property-based)", () => {
  it("arithmetic always balances: received + shortfall = amount; received - excess = amount", () => {
    fc.assert(
      fc.property(fc.array(arbPayment(REQUEST.reference), { maxLength: 8 }), (payments) => {
        const f = match(REQUEST, payments);
        if (f.status === "underpaid") {
          expect(f.received + f.shortfall).toBe(REQUEST.amount);
          expect(f.received).toBeGreaterThan(0n);
        }
        if (f.status === "overpaid") {
          expect(f.received - f.excess).toBe(REQUEST.amount);
        }
        if (f.status === "paid") {
          expect(f.received).toBe(REQUEST.amount);
        }
      }),
    );
  });

  it("classification is total — every input array yields a known status", () => {
    const known = new Set(["unpaid", "expired", "wrong-asset", "underpaid", "paid", "overpaid"]);
    fc.assert(
      fc.property(fc.array(arbPayment(REQUEST.reference), { maxLength: 8 }), (payments) => {
        expect(known.has(match(REQUEST, payments).status)).toBe(true);
      }),
    );
  });

  it("order independence — shuffling the payments never changes the fulfilment", () => {
    fc.assert(
      fc.property(
        fc.array(arbPayment(REQUEST.reference), { maxLength: 6 }),
        fc.array(fc.nat(), { minLength: 6, maxLength: 6 }),
        (payments, seeds) => {
          const shuffled = [...payments]
            .map((p, i) => ({ p, k: seeds[i % seeds.length]! }))
            .sort((a, b) => a.k - b.k)
            .map((x) => x.p);
          expect(match(REQUEST, shuffled)).toEqual(match(REQUEST, payments));
        },
      ),
    );
  });

  it("failed transactions never contribute — all-failed is indistinguishable from unpaid", () => {
    fc.assert(
      fc.property(fc.array(arbPayment(REQUEST.reference), { maxLength: 6 }), (payments) => {
        const failed = payments.map((p) => ({ ...p, succeeded: false }));
        const f = match(REQUEST, failed);
        expect(f.status === "unpaid" || f.status === "expired").toBe(true);
      }),
    );
  });
});

describe("re-delivery idempotence (audit #1)", () => {
  it("delivering every payment twice changes nothing — at-least-once feeds are safe", () => {
    fc.assert(
      fc.property(fc.array(arbPayment(REQUEST.reference), { maxLength: 6 }), (payments) => {
        expect(match(REQUEST, [...payments, ...payments])).toEqual(match(REQUEST, payments));
      }),
    );
  });

  it("the concrete repro: one exact payment delivered twice is PAID, not overpaid", () => {
    const payment: Payment = {
      transactionId: "0.0.9-1-1",
      consensusTimestamp: "1.000000000",
      network: "mainnet",
      memo: `paying ${REQUEST.reference}`,
      succeeded: true,
      credits: [
        {
          account: "0.0.1234",
          asset: { kind: "token", network: "mainnet", id: { shard: 0n, realm: 0n, num: 720n } },
          amount: REQUEST.amount,
        },
      ],
    };
    const f = match(REQUEST, [payment, payment]);
    expect(f.status).toBe("paid");
    if (f.status === "paid") expect(f.received).toBe(REQUEST.amount);
  });
});
