/**
 * The vocabulary. Two things: a **request** (what you're asking for) and a
 * **fulfilment** (what the chain says about it).
 *
 * The line that governs this whole library:
 *
 *   > It computes the facts. Your policy decides what they mean.
 *
 * So `Fulfilment` reports `overpaid` / `underpaid` / `late` as *observations*.
 * It does not decide whether an overpayment counts as settled, or whether a
 * payment that landed a minute after expiry is acceptable — those are business
 * judgements, and a library that bakes them in is making a decision it has no
 * standing to make.
 */
import type { AssetRef } from "./caip/index.js";

/** A request for payment. Identifiers are CAIP strings — see `caip/`. */
export interface PaymentRequest {
  /** CAIP-10, e.g. `hedera:mainnet:0.0.1234`. Carries the network. */
  readonly recipient: string;
  /** CAIP-19, e.g. `hedera:mainnet/token:0.0.720`, or the provisional HBAR form. */
  readonly asset: string;
  /**
   * Amount in the asset's **smallest unit** — tinybar for HBAR, base units for
   * a token. Always an integer. There are no decimals on the wire: BIP-21 put
   * decimal BTC in the URI and has been generating float bugs ever since.
   * Presenting `1.5 ℏ` to a human needs the token's decimals and is the
   * caller's concern.
   */
  readonly amount: bigint;
  /** The correlator that ties a payment back to this request, e.g. `INV-2026-041`. */
  readonly reference: string;
  /**
   * Consensus timestamp (`seconds.nanos`) after which this request is stale —
   * **not** wall-clock. The chain's clock is the one that is provable; a
   * payer's laptop clock is not a fact.
   */
  readonly expiresAt?: string;
  /** Human-facing only. Never matched on. */
  readonly label?: string;
}

/**
 * A candidate payment: what an account **actually received**, as observed on
 * chain. Structural on purpose — this library depends on no data client. Build
 * one from a `hiero-receipts` receipt (`adapters/receipt.ts`), from a mirror
 * transaction, or by hand in a test.
 */
export interface Payment {
  readonly transactionId: string;
  /** Consensus timestamp, `seconds.nanos`. */
  readonly consensusTimestamp: string;
  readonly network: string;
  /** The payer's memo. Empty string when absent. */
  readonly memo: string;
  /** False for a transaction that reached consensus but failed. */
  readonly succeeded: boolean;
  /**
   * What accounts were **credited** — the receiving side, never the sender's
   * intent. This distinction is load-bearing: an HTS token may carry custom
   * fees, so a customer who sends 100 can credit you 98. Matching the sender's
   * debit would mark that paid, and you would be 2 short.
   */
  readonly credits: readonly Credit[];
}

export interface Credit {
  /** Bare Hedera id, e.g. `0.0.1234`. */
  readonly account: string;
  readonly asset: AssetRef;
  /** Smallest unit, positive. */
  readonly amount: bigint;
}

/**
 * What every outcome where money *actually arrived* has in common.
 *
 * `paid`, `underpaid`, and `overpaid` differ only in how the total compares to
 * what was asked — they are otherwise the same fact. Naming that shape means
 * the three cannot drift apart, and that adding a field means editing one type.
 */
export interface Arrived {
  /** Total credited to the recipient in the requested asset, smallest unit. */
  readonly received: bigint;
  /** The payments that contributed. More than one is normal — see `match`. */
  readonly payments: readonly Payment[];
  /** At least one contributing payment landed after `expiresAt`. A fact, not a
   *  verdict: whether late still counts is yours to decide. */
  readonly late: boolean;
}

/**
 * What the chain says about a request. Every variant is an observation, not a
 * verdict — see the note at the top of this file.
 *
 * The three "money arrived" cases share {@link Arrived}; the three "nothing
 * arrived" cases carry only what they can honestly claim.
 */
export type Fulfilment =
  /** Nothing correlated to this reference. */
  | { readonly status: "unpaid" }
  /** Nothing correlated, and `expiresAt` has passed. */
  | { readonly status: "expired" }
  /** Correlated payments exist, but none credited the requested asset. */
  | { readonly status: "wrong-asset"; readonly payments: readonly Payment[] }
  /** Less arrived than asked. `shortfall` is what's still owed. */
  | (Arrived & { readonly status: "underpaid"; readonly shortfall: bigint })
  /** Exactly what was asked. */
  | (Arrived & { readonly status: "paid" })
  /**
   * More arrived than asked. Also how a **double payment** surfaces: pay a 100
   * request twice and you get `overpaid` with both payments attached, not a
   * silently-swallowed duplicate.
   */
  | (Arrived & { readonly status: "overpaid"; readonly excess: bigint });
