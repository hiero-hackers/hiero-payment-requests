// SPDX-License-Identifier: Apache-2.0
/**
 * Amount assignment for `byUniqueAmount` correlation — the issuing side of
 * the memo-free strategy. Each open invoice gets a unique amount, and the
 * amount becomes the correlator.
 */
import { RequestError } from "../request.js";

export interface AssignAmountOptions {
  /**
   * How far above `base` the search may go, in base units. The ceiling on
   * concurrent open invoices at one price point — with the default 999n,
   * a thousand invoices can share a price before assignment fails.
   */
  readonly maxDelta?: bigint;
}

/**
 * The smallest amount `>= base` not already taken by an open invoice.
 *
 * Adjustment is only ever UPWARD — a merchant can round a price up by dust
 * without a conversation; silently charging less than the price is not this
 * library's call to make. With a 6-decimal token the default headroom of
 * 999 base units tops out at 0.000999 above the price; with tinybar,
 * 0.00000999 ℏ.
 *
 * `taken` is the amounts of currently OPEN invoices in the same asset —
 * once one settles or expires, its amount is reusable. Throws `RequestError`
 * when the whole window is taken: that is the strategy's honest ceiling, not
 * a retryable hiccup — widen `maxDelta` or correlate by memo instead.
 */
export function assignDistinctAmount(
  base: bigint,
  taken: Iterable<bigint>,
  options: AssignAmountOptions = {},
): bigint {
  const maxDelta = options.maxDelta ?? 999n;
  if (base <= 0n) throw new RequestError(`amount must be positive (got ${base})`);
  if (maxDelta < 0n) throw new RequestError(`maxDelta must not be negative (got ${maxDelta})`);

  const used = new Set<bigint>(taken);
  for (let delta = 0n; delta <= maxDelta; delta++) {
    const candidate = base + delta;
    if (!used.has(candidate)) return candidate;
  }
  throw new RequestError(
    `every amount from ${base} to ${base + maxDelta} is taken by an open invoice — ` +
      `that is the ceiling of unique-amount correlation at one price point; ` +
      `widen maxDelta, or correlate by memo where wallets allow it`,
  );
}
