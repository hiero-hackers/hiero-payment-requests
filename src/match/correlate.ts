// SPDX-License-Identifier: Apache-2.0
/**
 * Stage 1 — **which payments claim to be for this request?**
 *
 * Cheap, structural checks only: is it real, is it on the right network, does it
 * carry the reference. Whether it actually *paid* is stage 2's problem.
 *
 * ────────────────────────────────────────────────────────────────────────
 * **This module is the library's one unverified bet.**
 *
 * Correlating on the memo assumes wallets let a payer set one. That is an
 * empirical claim about the wallet ecosystem, not a fact we've checked. If it
 * doesn't hold, the strategy has to change — and the alternatives are real:
 *
 *   unique amount          SHIPPED below as `byUniqueAmount` — no memo needed;
 *                          see its doc for the trade it makes
 *   known transaction id   SHIPPED below as `byTransactionId` — for rails that
 *                          hand the settlement id back (x402, scheduled
 *                          transactions, wallet callbacks); correlation stops
 *                          being a heuristic at all
 *   account per invoice    unambiguous, costs an account creation
 *
 * This file exists so that swapping strategies is a swap, not a refactor:
 * everything downstream takes "the payments that claim to be for this request"
 * and doesn't care how we decided that. See docs/ARCHITECTURE.md § Correlation.
 * ────────────────────────────────────────────────────────────────────────
 */
import type { ResolvedRequest } from "../request.js";
import type { Payment } from "../types.js";
import { compareTimestamps } from "../timestamp.js";
import { creditedTotal } from "./tally.js";

/**
 * A correlation strategy: given every candidate payment, return the ones
 * that **claim to be for this request**. The default is the memo strategy
 * below; swap in your own via `MatchOptions.correlate` (unique amounts,
 * account-per-invoice, scheduled transactions — see the module header).
 *
 * Strategies only FILTER. Deduplication and consensus ordering are applied
 * by the pipeline to whatever a strategy returns (`canonicalize`), so the
 * match invariants — re-delivery idempotence, order independence — hold for
 * every strategy, not just the built-in one.
 */
export type CorrelationStrategy = (
  payments: readonly Payment[],
  resolved: ResolvedRequest,
) => readonly Payment[];

/** The default (memo) strategy — see the module header for the bet it makes. */
export const correlate: CorrelationStrategy = (payments, resolved) => {
  const { request, recipient } = resolved;
  return payments.filter(
    (payment) =>
      // A transaction can reach consensus and still fail; it moved nothing.
      payment.succeeded &&
      // The network rides inside the CAIP-10 recipient, so a testnet payment can
      // never settle a mainnet request. Free, because we never took a `network`
      // option to get out of sync with.
      payment.network === recipient.network &&
      carriesReference(payment.memo, request.reference),
  );
};

/**
 * The memo-free strategy: a payment claims this request by crediting the
 * recipient **exactly** the requested amount in the requested asset. Pair it
 * with `assignDistinctAmount`, which gives each open invoice a unique amount —
 * the amount IS the reference, so it works in every wallet that can send a
 * number, including ones that never let the payer touch a memo.
 *
 * The trade is stated plainly: exactness is the correlator, so anything
 * inexact does not correlate at all. An underpayment, an overpayment, or a
 * custom-fee token that skims 2 on the way (you asked 100, got credited 98)
 * all report `unpaid` — not `underpaid`, because with no other correlator
 * this library cannot honestly claim those payments were for THIS request.
 * Use memo correlation where wallets allow it and the richer verdicts
 * matter; use this where they don't.
 */
export const byUniqueAmount: CorrelationStrategy = (payments, resolved) =>
  payments.filter(
    (payment) =>
      payment.succeeded &&
      payment.network === resolved.recipient.network &&
      creditedTotal(payment, resolved) === resolved.request.amount,
  );

/**
 * The out-of-band strategy: the caller already KNOWS which transaction is
 * supposed to have paid — a settlement id handed back by a payment rail
 * (x402's `SettleResponse`, a scheduled transaction the merchant built, a
 * wallet callback). Correlation stops being a heuristic: a payment claims
 * this request iff it IS that transaction — and is real, on the request's
 * network. Every richer verdict survives, because tally still measures what
 * that transaction actually credited: underpaid, overpaid, wrong-asset all
 * report honestly.
 *
 * Hedera spells transaction ids two ways — `0.0.x@seconds.nanos` (SDK,
 * HashScan, most rails) and `0.0.x-seconds-nanos` (mirror REST, so most
 * `Payment`s) — and this strategy accepts either on either side. The id you
 * PASS is validated loudly (a typo must not silently correlate nothing); a
 * candidate payment whose id has some other shape simply never matches.
 */
export function byTransactionId(transactionId: string): CorrelationStrategy {
  const wanted = canonicalTransactionId(transactionId);
  if (wanted === undefined) {
    throw new Error(
      `not a Hedera transaction id: "${transactionId}" ` +
        '(expected "0.0.x@seconds.nanos" or "0.0.x-seconds-nanos")',
    );
  }
  return (payments, resolved) =>
    payments.filter(
      (payment) =>
        payment.succeeded &&
        payment.network === resolved.recipient.network &&
        canonicalTransactionId(payment.transactionId) === wanted,
    );
}

/** Both spellings → one canonical form (nanos zero-padded, so `@1.5` and
 *  `-1-000000005` are the same id); anything else → undefined. */
function canonicalTransactionId(id: string): string | undefined {
  const parts =
    /^(\d+\.\d+\.\d+)@(\d+)\.(\d+)$/.exec(id) ?? /^(\d+\.\d+\.\d+)-(\d+)-(\d+)$/.exec(id);
  if (parts === null) return undefined;
  return `${parts[1]}-${parts[2]}-${parts[3]!.padStart(9, "0")}`;
}

/**
 * The pipeline's canonicalization — **deduplicated** and in **consensus
 * order**, whatever a strategy returned and however the caller's data
 * source delivered it. A fulfilment is a statement of chain facts, so it
 * must be identical for two merchants matching the same chain state (order
 * independence), and identical no matter how many times the same
 * transaction was delivered (re-delivery idempotence): overlapping mirror
 * pages and at-least-once notification feeds both hand the same payment in
 * twice, and a transaction that happened once must never tally twice.
 * Hedera transaction ids are globally unique, which makes the id the dedup
 * key. Both rules were found by property tests — and they live HERE, not
 * in the strategy, so no custom strategy can lose them.
 */
export function canonicalize(payments: readonly Payment[]): readonly Payment[] {
  const seen = new Set<string>();
  return payments
    .filter((payment) => {
      if (seen.has(payment.transactionId)) return false;
      seen.add(payment.transactionId);
      return true;
    })
    .sort(
      (a, b) =>
        compareTimestamps(a.consensusTimestamp, b.consensusTimestamp) ||
        a.transactionId.localeCompare(b.transactionId),
    );
}

/**
 * Does the memo carry the reference?
 *
 * Substring, not equality: wallets and humans decorate memos ("Inv INV-2026-041
 * — thanks!"), and demanding an exact memo would reject payments a merchant
 * would obviously accept. The cost is that a reference must be distinctive
 * enough not to appear by accident — `INV-2026-041` is; `1` is not.
 */
function carriesReference(memo: string, reference: string): boolean {
  return memo.includes(reference);
}
