// SPDX-License-Identifier: Apache-2.0
/**
 * Adapter: a request → a predicate that
 * [`hiero-notifications`](https://github.com/hiero-hackers/hiero-notifications)
 * can watch with.
 *
 * Lives here rather than in `match.ts` because it is a bridge, not part of the
 * matching rule — the same job `adapters/receipt.ts` does in the other
 * direction. Together: receipts come *in* as `Payment`s, requests go *out* as
 * conditions.
 *
 *   watch({
 *     watcher: accountWatcher({ accounts: ["0.0.1234"] }),
 *     condition: fulfils(request, (r) => fromReceipt(r, "mainnet")),
 *     deliveries: [markInvoicePaid],
 *   })
 *
 * The return value is *structurally* that library's `Condition<Receipt>`, which
 * is why neither library depends on the other.
 */
import { correlate } from "../match/correlate.js";
import { match } from "../match/index.js";
import { createRequest } from "../request.js";
import type { Payment, PaymentRequest } from "../types.js";

/** A `Condition`-shaped predicate: true once `request` is exactly paid. */
export function fulfils<P>(
  request: PaymentRequest,
  toPayment: (payload: P) => Payment,
): { readonly name: string; matches(payload: P): boolean } {
  return {
    name: `fulfils(${request.reference})`,
    // Deliberately `=== "paid"`: a single receipt that underpays is not
    // fulfilment, and one that overpays is a fact the caller should see rather
    // than have a watcher quietly treat as settled. Reach for `match` directly
    // when you want the whole picture across several payments.
    matches: (payload) => match(request, [toPayment(payload)]).status === "paid",
  };
}

/**
 * The stateful sibling of {@link fulfils}, for the most common real-world
 * pattern: **partial payments**. A customer who pays 60 + 40 never shows a
 * single receipt that is "paid" — `fulfils` can never fire for them. This
 * variant folds every correlating receipt into a running tally and fires
 * **exactly once, on the receipt that completes payment** (reaches or
 * exceeds the requested amount — completion by overpayment still completes;
 * the fulfilment carries the excess for the caller to see).
 *
 * The exactly-once contract survives an at-least-once feed for free:
 * matching dedupes on transaction id, so a re-delivered receipt cannot
 * re-cross the threshold. Non-correlating payloads (wrong reference,
 * wrong network, failed) are not retained, so a long-lived watcher does
 * not accumulate unrelated traffic.
 *
 * One instance = one request's tally, held in memory. A restart starts the
 * tally fresh — pair the watcher with `statePath` catch-up (hiero-
 * notifications) and the replayed history rebuilds it.
 */
export function fulfilsAccumulating<P>(
  request: PaymentRequest,
  toPayment: (payload: P) => Payment,
): { readonly name: string; matches(payload: P): boolean } {
  const resolved = createRequest(request);
  const retained: Payment[] = [];
  const seen = new Set<string>();
  let settled = false;

  return {
    name: `fulfilsAccumulating(${request.reference})`,
    matches(payload: P): boolean {
      const payment = toPayment(payload);
      // Only correlating payments are worth remembering.
      if (correlate([payment], resolved).length === 0) return false;
      // Already counted — an at-least-once re-delivery, not new money.
      if (seen.has(payment.transactionId)) return false;
      seen.add(payment.transactionId);
      retained.push(payment);

      if (settled) return false; // completion already announced
      const f = match(request, retained);
      if (f.status === "paid" || f.status === "overpaid") {
        settled = true;
        return true; // the receipt that completed payment
      }
      return false;
    },
  };
}
