/**
 * hiero-payment-requests — ask for a Hedera payment, and prove it was made.
 *
 * Two halves. A **request** built on the CAIP identifiers Hedera already
 * standardised ([HIP-30](https://hips.hedera.com/HIP/hip-30.html)), and a
 * **matching rule** that says what the chain thinks of it. Pure: no network, no
 * runtime dependencies. You bring the transactions.
 *
 *   import { createRequest, match } from "hiero-payment-requests";
 *
 *   const request = {
 *     recipient: "hedera:mainnet:0.0.1234",   // CAIP-10 — carries the network
 *     asset:     "hedera:mainnet/token:0.0.720",
 *     amount:    100_000000n,                 // smallest unit, always integer
 *     reference: "INV-2026-041",
 *   };
 *   createRequest(request);                   // validate up front
 *   match(request, payments);                 // → paid | underpaid | overpaid | …
 */
export { match } from "./match/index.js";
export type { MatchOptions } from "./match/index.js";
export { createRequest, RequestError } from "./request.js";
export type { ResolvedRequest } from "./request.js";
export { compareTimestamps, isAfter, isConsensusTimestamp } from "./timestamp.js";
export type { PaymentRequest, Payment, Credit, Fulfilment, Arrived } from "./types.js";

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
  CaipError,
  HBAR_SLIP44,
} from "./caip/index.js";
export type { Network, EntityId, AccountRef, AssetRef } from "./caip/index.js";

export { fromReceipt } from "./adapters/receipt.js";
export type { ReceiptLike, MovementLike } from "./adapters/receipt.js";
export { fulfils } from "./adapters/notifications.js";
