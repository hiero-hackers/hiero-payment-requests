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
import { match } from "../match/index.js";
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
