// SPDX-License-Identifier: Apache-2.0
/**
 * Stage 3 — **so what does that mean?**
 *
 * The only place a `Fulfilment` is constructed. Every status the library can
 * report is decided here and nowhere else, so the whole set of answers is one
 * screen rather than something you assemble from six call sites.
 *
 * It reads as a cascade of guards on purpose. That's a decision table, and a
 * decision table is easier to check when you can see every branch at once than
 * when it's scattered across six small functions you have to reassemble.
 *
 * Every variant is an **observation**, not a verdict. `overpaid` does not mean
 * "rejected"; `late` does not mean "invalid". Whether ninety seconds late is
 * acceptable is a business judgement, and this library has no standing to make
 * it — see `types.ts`.
 */
import { isAfter } from "../timestamp.js";
import type { ResolvedRequest } from "../request.js";
import type { Arrived, Fulfilment } from "../types.js";
import type { Tally } from "./tally.js";

/**
 * `tallied` — the findings (stage 2), including what it examined.
 * `now` — consensus timestamp, needed only to tell `unpaid` from `expired`.
 */
export function classify(tallied: Tally, resolved: ResolvedRequest, now?: string): Fulfilment {
  const { expiresAt, amount } = resolved.request;
  const { claimed, paying, received } = tallied;

  if (claimed.length === 0) return nothingClaimed(expiresAt, now);

  // Something carried the reference but credited nothing we asked for — a token
  // sent against an HBAR request, or a payment to the wrong account. A distinct
  // fact, and emphatically not "unpaid": someone did send something.
  if (paying.length === 0) return { status: "wrong-asset", payments: claimed };

  const arrived: Arrived = {
    received,
    payments: paying,
    late: expiresAt !== undefined && paying.some((p) => isAfter(p.consensusTimestamp, expiresAt)),
  };

  if (received < amount) return { status: "underpaid", shortfall: amount - received, ...arrived };
  if (received > amount) return { status: "overpaid", excess: received - amount, ...arrived };
  return { status: "paid", ...arrived };
}

/** Nothing even claimed to be for this request — so the only question left is
 *  whether the request is still open. Without a `now` we can't know, and say so
 *  by reporting `unpaid` rather than guessing. */
function nothingClaimed(expiresAt: string | undefined, now: string | undefined): Fulfilment {
  const expired = expiresAt !== undefined && now !== undefined && isAfter(now, expiresAt);
  return expired ? { status: "expired" } : { status: "unpaid" };
}
