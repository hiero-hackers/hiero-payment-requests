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
import { correlate } from "./correlate.js";
import { tally } from "./tally.js";

export interface MatchOptions {
  /**
   * Consensus timestamp to judge expiry against when nothing has been paid.
   * Required to distinguish `unpaid` from `expired`; without it a stale request
   * reports `unpaid` forever.
   */
  readonly now?: string | undefined;
}

/**
 * Decide what `payments` say about `request`.
 *
 * Correlated payments are **aggregated**: three transfers carrying the same
 * reference are one running total against the request, which is factual and
 * needs no policy. It also means a duplicate payment surfaces as `overpaid`
 * with both transactions attached, rather than being quietly ignored.
 */
export function match(request: PaymentRequest, payments: readonly Payment[], opts: MatchOptions = {}): Fulfilment {
  const resolved = createRequest(request);
  const claimed = correlate(payments, resolved);
  const tallied = tally(claimed, resolved);
  return classify(tallied, resolved, opts.now);
}
