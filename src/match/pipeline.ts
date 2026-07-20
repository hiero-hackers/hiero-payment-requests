// SPDX-License-Identifier: Apache-2.0
/**
 * The sequence: resolve → correlate → tally → classify.
 *
 * Deliberately the whole file. Each stage is a module with its own subtlety to
 * defend; this is only the order they run in, and it should stay small enough
 * that the order *is* the entire content. If this file ever grows past "call
 * four things in order", a stage has leaked into the sequencer.
 *
 * Every stage has the same shape — `(what the last stage produced, the resolved
 * request)` — and each consumes only its predecessor's output. That is what
 * lets `correlate` be swapped for a different correlation strategy without
 * `tally` or `classify` ever learning about it.
 */
import { createRequest } from "../request.js";
import type { Fulfilment, Payment, PaymentRequest } from "../types.js";
import { classify } from "./classify.js";
import { canonicalize, correlate, type CorrelationStrategy } from "./correlate.js";
import { tally } from "./tally.js";

export interface MatchOptions {
  /**
   * Consensus timestamp to judge expiry against when nothing has been paid.
   * Required to distinguish `unpaid` from `expired`; without it a stale request
   * reports `unpaid` forever.
   */
  readonly now?: string | undefined;
  /**
   * How to decide which payments claim to be for the request. Default: the
   * memo strategy (`correlate` — reference carried in the memo). Swap it for
   * unique-amount, account-per-invoice, or scheduled-transaction correlation
   * without touching tally or classify. Whatever a strategy returns is
   * canonicalized by the pipeline (deduplicated by transaction id, consensus
   * ordering), so the match invariants hold for every strategy.
   */
  readonly correlate?: CorrelationStrategy;
}

/**
 * Decide what `payments` say about `request`.
 *
 * Correlated payments are **aggregated**: three transfers carrying the same
 * reference are one running total against the request, which is factual and
 * needs no policy. The same transaction delivered twice counts once —
 * re-delivery is a property of data feeds, not a payment.
 */
export function match(
  request: PaymentRequest,
  payments: readonly Payment[],
  opts: MatchOptions = {},
): Fulfilment {
  const resolved = createRequest(request);
  const strategy = opts.correlate ?? correlate;
  const claimed = canonicalize(strategy(payments, resolved));
  const tallied = tally(claimed, resolved);
  return classify(tallied, resolved, opts.now);
}
