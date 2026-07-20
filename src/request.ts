// SPDX-License-Identifier: Apache-2.0
/**
 * Building and validating a request. `createRequest` parses every identifier up
 * front, so a malformed recipient fails *here* — at the point you can still fix
 * it — rather than silently never matching a payment three weeks later.
 */
import { parseAccount, parseAsset, type AccountRef, type AssetRef } from "./caip/index.js";
import { isConsensusTimestamp } from "./timestamp.js";
import type { PaymentRequest } from "./types.js";

export class RequestError extends Error {}

/** A request with its identifiers already parsed. */
export interface ResolvedRequest {
  readonly request: PaymentRequest;
  readonly recipient: AccountRef;
  readonly asset: AssetRef;
}

/**
 * Validate a request and resolve its identifiers. Throws `RequestError` (or
 * `CaipError`) on anything malformed.
 */
export function createRequest(request: PaymentRequest): ResolvedRequest {
  const recipient = parseAccount(request.recipient);
  const asset = parseAsset(request.asset);

  if (recipient.network !== asset.network) {
    throw new RequestError(
      `recipient is on ${recipient.network} but the asset is on ${asset.network} — a request cannot span networks`,
    );
  }
  if (request.amount <= 0n) {
    throw new RequestError(`amount must be positive (got ${request.amount})`);
  }
  if (asset.kind === "nft" && request.amount !== 1n) {
    throw new RequestError(
      `an NFT request names one specific serial, so its amount can only be 1 ` +
        `(got ${request.amount}) — any other amount could never be fulfilled`,
    );
  }
  if (request.reference.length === 0) {
    throw new RequestError(
      "reference must not be empty — it is what ties a payment back to this request",
    );
  }
  if (request.expiresAt !== undefined && !isConsensusTimestamp(request.expiresAt)) {
    throw new RequestError(
      `expiresAt must be a consensus timestamp "seconds.nanos" (got "${request.expiresAt}")`,
    );
  }

  return { request, recipient, asset };
}
