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
 *   unique amount          vary by a few tinybar per request; ugly, collides at scale
 *   account per invoice    unambiguous, costs an account creation
 *   scheduled transaction  the payer signs a pre-built transfer — Hedera-native,
 *                          and correlation stops being a heuristic at all
 *
 * This file exists so that swapping strategies is a swap, not a refactor:
 * everything downstream takes "the payments that claim to be for this request"
 * and doesn't care how we decided that. See docs/ARCHITECTURE.md § Correlation.
 * ────────────────────────────────────────────────────────────────────────
 */
import type { ResolvedRequest } from "../request.js";
import type { Payment } from "../types.js";

/** The payments that claim to be for this request. */
export function correlate(payments: readonly Payment[], resolved: ResolvedRequest): readonly Payment[] {
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
