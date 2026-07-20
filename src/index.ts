// SPDX-License-Identifier: Apache-2.0
/**
 * hiero-payment-requests — ask for a Hedera payment, and prove it was made.
 *
 * Two halves. A **request** built on the CAIP identifiers Hedera already
 * standardised ([HIP-30](https://hips.hedera.com/HIP/hip-30.html)), and a
 * **matching rule** that says what the chain thinks of it. Pure: no network, no
 * runtime dependencies. You bring the transactions.
 *
 *   import { createRequest, match } from "@hiero-hackers/hiero-payment-requests";
 *
 *   const request = {
 *     recipient: "hedera:mainnet:0.0.1234",   // CAIP-10 — carries the network
 *     asset:     "hedera:mainnet/token:0.0.720",
 *     amount:    100_000000n,                 // smallest unit, always integer
 *     reference: "INV-2026-041",
 *   };
 *   createRequest(request);                   // validate up front
 *   match(request, payments);                 // → paid | underpaid | overpaid | …
 *
 * The exports below are ordered as the money moves — read top to bottom and
 * this file is the library's table of contents.
 */

// ── The request: the vocabulary, validated up front ─────────────────────────
export type { PaymentRequest, Payment, Credit, Fulfilment, Arrived } from "./types.js";
export { createRequest, RequestError } from "./request.js";
export type { ResolvedRequest } from "./request.js";

// ── The wire: share it — URI, JSON, universal link, QR ──────────────────────
export {
  toURI,
  fromURI,
  toLink,
  fromLink,
  fromAny,
  encodeRequest,
  decodeRequest,
  WIRE_VERSION,
} from "./wire.js";
export { toQRSVG, toQRTerminal, toQRMatrix, encodeQR, QrError } from "./qr/index.js";
export type { QrMatrix, QrOptions, QrEcc, SvgOptions } from "./qr/index.js";

// ── The wallet hand-off: plain transfer fields, CAIP knowledge kept in here ─
export { paymentInstructions } from "./instructions.js";
export type { PaymentInstructions, InstructedAsset } from "./instructions.js";

// ── Matching: what does the chain say about the request? ────────────────────
export { match, byUniqueAmount, assignDistinctAmount } from "./match/index.js";
export type { MatchOptions, CorrelationStrategy, AssignAmountOptions } from "./match/index.js";
export { compareTimestamps, isAfter, isConsensusTimestamp } from "./timestamp.js";

// ── After the verdict: remainders, refunds, and the verdict as JSON ─────────
export { remainderRequest, refundInstructions } from "./followup.js";
export type { RefundInstruction } from "./followup.js";
export { encodeFulfilment, decodeFulfilment, FULFILMENT_VERSION } from "./fulfilment.js";

// ── Money as text: bigint ↔ decimals, exactly or not at all ─────────────────
export { formatBaseUnits, parseDecimalAmount } from "./money.js";
export type { FormatBaseUnitsOptions } from "./money.js";

// ── The identifiers: CAIP-2/10/19 with HIP-15 checksums ─────────────────────
export {
  parseChain,
  formatChain,
  parseAccount,
  tryParseAccount,
  formatAccount,
  accountKey,
  parseAsset,
  tryParseAsset,
  formatAsset,
  assetKey,
  parseEntityId,
  tryParseEntityId,
  formatEntityId,
  entityKey,
  sameEntity,
  sameAccount,
  sameAsset,
  isNetwork,
  CaipError,
  HBAR_SLIP44,
  NETWORKS,
  HIERO_NETWORKS,
  networkSpec,
  expectedChecksum,
} from "./caip/index.js";
export type { Network, NetworkSpec, EntityId, AccountRef, AssetRef } from "./caip/index.js";

// ── Adapters: stack siblings, coupled structurally, never imported ──────────
export { fromReceipt } from "./adapters/receipt.js";
export type { ReceiptLike, MovementLike, NftMovementLike } from "./adapters/receipt.js";
export { fulfils, fulfilsAccumulating } from "./adapters/notifications.js";
