/**
 * Pluggable correlation (audit #4): the strategy decides WHICH payments
 * claim; the pipeline's canonicalization (dedup + consensus order) applies
 * to every strategy, so no custom strategy can lose the match invariants.
 */
import { describe, expect, it } from "vitest";
import { match } from "../../src/index.js";
import type { CorrelationStrategy, Payment, PaymentRequest } from "../../src/index.js";

const REQUEST: PaymentRequest = {
  recipient: "hedera:mainnet:0.0.1234",
  asset: "hedera:mainnet/token:0.0.720",
  amount: 100n,
  reference: "INV-STRAT-1",
};

const payment = (
  transactionId: string,
  amount: bigint,
  memo: string,
  ts = "1.000000000",
): Payment => ({
  transactionId,
  consensusTimestamp: ts,
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

// The README's "unique amount" alternative, as a real strategy: a payment
// claims the request iff it credits exactly the requested amount — no memo.
const byExactAmount: CorrelationStrategy = (payments, resolved) =>
  payments.filter(
    (p) =>
      p.succeeded &&
      p.network === resolved.recipient.network &&
      p.credits.some((c) => c.amount === resolved.request.amount),
  );

describe("MatchOptions.correlate", () => {
  it("a custom strategy correlates without any memo at all", () => {
    const memoless = payment("0.0.9-1-1", 100n, "no reference anywhere");
    // Default memo strategy: nothing claims.
    expect(match(REQUEST, [memoless]).status).toBe("unpaid");
    // Amount strategy: the exact-amount payment claims and pays.
    expect(match(REQUEST, [memoless], { correlate: byExactAmount }).status).toBe("paid");
  });

  it("canonicalization applies to custom strategies too — duplicates still count once", () => {
    const p = payment("0.0.9-1-1", 100n, "whatever");
    const f = match(REQUEST, [p, p], { correlate: byExactAmount });
    expect(f.status).toBe("paid"); // not overpaid: the pipeline deduped
  });

  it("…and so does consensus ordering, even from a strategy that reverses", () => {
    const early = payment("0.0.9-1-1", 60n, "x", "1.000000000");
    const late = payment("0.0.9-2-2", 40n, "x", "2.000000000");
    const reversing: CorrelationStrategy = (payments) => [...payments].reverse();
    const f = match(REQUEST, [early, late], { correlate: reversing });
    expect(f.status).toBe("paid");
    if (f.status === "paid") {
      expect(f.payments.map((p) => p.consensusTimestamp)).toEqual(["1.000000000", "2.000000000"]);
    }
  });

  it("the default is unchanged: omitting the option is the memo strategy", () => {
    const carried = payment("0.0.9-1-1", 100n, "for INV-STRAT-1");
    expect(match(REQUEST, [carried]).status).toBe("paid");
  });
});
