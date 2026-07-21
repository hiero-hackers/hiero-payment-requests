// SPDX-License-Identifier: Apache-2.0
/**
 * The matching rule — the part that is actually worth a library.
 *
 * Encoding a request is easy. Deciding whether a transaction fulfils it is
 * where every hand-rolled integration goes wrong, because the honest answer is
 * not a boolean. A customer can underpay, overpay, pay twice, pay late, pay in
 * the wrong asset, pay on the wrong network, or pay a token that skims a custom
 * fee on the way. Each is a *different fact*, and the merchant needs to know
 * which one happened.
 *
 * A sequence, one module per stage — each owning one subtlety:
 *
 *   correlate   which payments claim to be for this request   ← the memo bet
 *     ↓
 *   tally       what the recipient actually received          ← the custom-fee trap
 *     ↓
 *   classify    so what does that mean                        ← the only Fulfilment factory
 *
 * Each stage takes only the previous stage's output, so `correlate` can be
 * swapped for a different correlation strategy without `tally` or `classify`
 * learning about it.
 *
 * What this does NOT do is decide what those facts mean for you. See `types.ts`.
 *
 * This file is a barrel: the public surface, no logic. Same rule as `caip/`.
 */
export { match } from "./pipeline.js";
export type { MatchOptions } from "./pipeline.js";
export { correlate, canonicalize, byTransactionId, byUniqueAmount } from "./correlate.js";
export type { CorrelationStrategy } from "./correlate.js";
export { assignDistinctAmount } from "./amounts.js";
export type { AssignAmountOptions } from "./amounts.js";
export { tally } from "./tally.js";
export type { Tally } from "./tally.js";
export { classify } from "./classify.js";
