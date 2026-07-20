/**
 * After the verdict. The remainder test that matters is the accumulation
 * proof: pay 60, ask for the remainder, pay it — the ORIGINAL request goes
 * `paid`, because the remainder carries the same reference. The refund tests
 * pin the allocation rule (latest payments refunded first) and the honesty
 * of the target (fee payer as labeled heuristic, undefined when unknowable).
 */
import { describe, expect, it } from "vitest";
import {
  match,
  remainderRequest,
  refundInstructions,
  toURI,
  RequestError,
  type Fulfilment,
  type Payment,
  type PaymentRequest,
} from "../src/index.js";

import { BASE, USDC } from "./fixtures.js";

// Small numbers make the allocation arithmetic legible.
const REQUEST: PaymentRequest = { ...BASE, amount: 100n };

const payment = (amount: bigint, payer: string, at: string): Payment => ({
  transactionId: `${payer}@${at}`,
  consensusTimestamp: at,
  network: "mainnet",
  memo: "INV-2026-041",
  succeeded: true,
  credits: [{ account: "0.0.1234", asset: USDC, amount }],
});

describe("remainderRequest", () => {
  it("asks for exactly the shortfall, SAME reference — and the second payment completes the ORIGINAL match", () => {
    const first = payment(60n, "0.0.9", "1.1");
    const underpaid = match(REQUEST, [first]);
    expect(underpaid.status).toBe("underpaid");

    const remainder = remainderRequest(REQUEST, underpaid);
    expect(remainder.amount).toBe(40n);
    expect(remainder.reference).toBe(REQUEST.reference); // the whole point

    // The payer pays the remainder QR. Matching the ORIGINAL request with
    // both payments: paid. A fresh reference would have orphaned `first`.
    const second = payment(remainder.amount, "0.0.9", "2.2");
    expect(match(REQUEST, [first, second])).toMatchObject({ status: "paid", received: 100n });
  });

  it("the remainder is a full citizen: it validates and goes on the wire", () => {
    const remainder = remainderRequest(REQUEST, match(REQUEST, [payment(60n, "0.0.9", "1.1")]));
    expect(toURI(remainder)).toContain("amount=40");
  });

  it("carries expiresAt and label through — it is the same request, for less", () => {
    const request = { ...REQUEST, expiresAt: "1783012345.000000000", label: "Coffee" };
    const remainder = remainderRequest(request, match(request, [payment(60n, "0.0.9", "1.1")]));
    expect(remainder.expiresAt).toBe(request.expiresAt);
    expect(remainder.label).toBe("Coffee");
  });

  it("throws for every status that has no remainder", () => {
    const statuses: Fulfilment[] = [
      { status: "unpaid" },
      { status: "expired" },
      match(REQUEST, [payment(100n, "0.0.9", "1.1")]), // paid
      match(REQUEST, [payment(150n, "0.0.9", "1.1")]), // overpaid
    ];
    for (const fulfilment of statuses) {
      expect(() => remainderRequest(REQUEST, fulfilment)).toThrow(RequestError);
      expect(() => remainderRequest(REQUEST, fulfilment)).toThrow(/no remainder/);
    }
  });
});

describe("refundInstructions: overpaid", () => {
  it("a single overpayment refunds the excess to its fee payer, memo correlatable", () => {
    const refunds = refundInstructions(REQUEST, match(REQUEST, [payment(150n, "0.0.9", "1.1")]));
    expect(refunds).toEqual([
      {
        to: "0.0.9",
        network: "mainnet",
        asset: { kind: "token", id: "0.0.720" },
        amount: 50n,
        memo: "REFUND INV-2026-041",
        forTransaction: "0.0.9@1.1",
      },
    ]);
  });

  it("a double payment refunds exactly the second transaction — first-come-first-served", () => {
    const first = payment(100n, "0.0.9", "1.1");
    const second = payment(100n, "0.0.77", "2.2");
    const refunds = refundInstructions(REQUEST, match(REQUEST, [first, second]));
    expect(refunds).toHaveLength(1);
    expect(refunds[0]).toMatchObject({ to: "0.0.77", amount: 100n, forTransaction: "0.0.77@2.2" });
  });

  it("a partial overshoot refunds only the overshooting payment's share", () => {
    // 60 + 60 against 100: the second payer overshot by 20.
    const refunds = refundInstructions(
      REQUEST,
      match(REQUEST, [payment(60n, "0.0.9", "1.1"), payment(60n, "0.0.77", "2.2")]),
    );
    expect(refunds).toHaveLength(1);
    expect(refunds[0]).toMatchObject({ to: "0.0.77", amount: 20n });
  });

  it("an unparseable transaction id yields to: undefined — never a guessed target", () => {
    const odd: Payment = { ...payment(150n, "0.0.9", "1.1"), transactionId: "weird-id-format" };
    const refunds = refundInstructions(REQUEST, match(REQUEST, [odd]));
    expect(refunds[0]?.to).toBeUndefined();
    expect(refunds[0]?.amount).toBe(50n);
  });
});

describe("refundInstructions: wrong-asset and the quiet statuses", () => {
  it("a wrong-asset payment is refunded in FULL, in the asset that actually arrived", () => {
    const wrongToken: Payment = {
      ...payment(0n, "0.0.9", "1.1"),
      credits: [
        {
          account: "0.0.1234",
          asset: { kind: "token", network: "mainnet", id: { shard: 0n, realm: 0n, num: 999n } },
          amount: 77n,
        },
      ],
    };
    const fulfilment = match(REQUEST, [wrongToken]);
    expect(fulfilment.status).toBe("wrong-asset");
    const refunds = refundInstructions(REQUEST, fulfilment);
    expect(refunds).toEqual([
      {
        to: "0.0.9",
        network: "mainnet",
        asset: { kind: "token", id: "0.0.999" },
        amount: 77n,
        memo: "REFUND INV-2026-041",
        forTransaction: "0.0.9@1.1",
      },
    ]);
  });

  it("a mirror-style transaction id (0.0.9-1783…) still names its fee payer", () => {
    const mirrorStyle: Payment = {
      ...payment(150n, "0.0.9", "1.1"),
      transactionId: "0.0.9-1783012000-000000000",
    };
    const refunds = refundInstructions(REQUEST, match(REQUEST, [mirrorStyle]));
    expect(refunds[0]?.to).toBe("0.0.9");
  });

  it("a payer id beyond 64 bits is undefined, not a corrupted target", () => {
    const overflow: Payment = {
      ...payment(150n, "0.0.9", "1.1"),
      transactionId: "99999999999999999999.0.0@1.1",
    };
    expect(refundInstructions(REQUEST, match(REQUEST, [overflow]))[0]?.to).toBeUndefined();
  });

  it("two credits of the same wrong asset sum into ONE refund; other accounts' credits are ignored", () => {
    const wrong = {
      kind: "token",
      network: "mainnet",
      id: { shard: 0n, realm: 0n, num: 999n },
    } as const;
    const messy: Payment = {
      ...payment(0n, "0.0.9", "1.1"),
      credits: [
        { account: "0.0.1234", asset: wrong, amount: 40n },
        { account: "0.0.1234", asset: wrong, amount: 37n },
        { account: "0.0.5555", asset: wrong, amount: 500n }, // someone else's credit
        { account: "not-an-id", asset: wrong, amount: 1n },
      ],
    };
    const refunds = refundInstructions(REQUEST, match(REQUEST, [messy]));
    expect(refunds).toHaveLength(1);
    expect(refunds[0]).toMatchObject({ amount: 77n, asset: { kind: "token", id: "0.0.999" } });
  });

  it("paid, unpaid, underpaid, expired owe nothing back — an empty list, not an error", () => {
    expect(refundInstructions(REQUEST, match(REQUEST, [payment(100n, "0.0.9", "1.1")]))).toEqual(
      [],
    );
    expect(refundInstructions(REQUEST, { status: "unpaid" })).toEqual([]);
    expect(refundInstructions(REQUEST, { status: "expired" })).toEqual([]);
    expect(refundInstructions(REQUEST, match(REQUEST, [payment(60n, "0.0.9", "1.1")]))).toEqual([]);
  });
});
