// SPDX-License-Identifier: Apache-2.0
/**
 * The wallet-facing extraction: everything an adapter needs to build the
 * actual transfer — *send X of asset Y to account Z with memo R* — in plain
 * fields, so CAIP parsing stays in this library instead of leaking into
 * every WalletConnect payload and wallet deep link.
 *
 * The `memo` field is the load-bearing one: it carries the request's
 * reference, and putting it on the transfer is WHAT MAKES THE PAYMENT
 * CORRELATABLE under the default matching strategy. A wallet adapter that
 * drops the memo produces payments this library will honestly report as
 * `unpaid` (unless the merchant matches with `byUniqueAmount`, where the
 * memo is welcome but not needed).
 */
import { entityKey } from "./caip/index.js";
import type { AssetRef, Network } from "./caip/index.js";
import { createRequest } from "./request.js";
import type { PaymentRequest } from "./types.js";

/** The asset in wallet terms — bare ids, checksums verified then stripped. */
export type InstructedAsset =
  | { readonly kind: "hbar" }
  | { readonly kind: "token"; readonly id: string }
  | { readonly kind: "nft"; readonly id: string; readonly serial: bigint };

/** What a wallet needs, and nothing it doesn't. */
export interface PaymentInstructions {
  readonly network: Network;
  /** Bare recipient id, `shard.realm.num` — checksum verified, then stripped:
   *  wallets and SDKs take the id, not the CAIP form. */
  readonly recipient: string;
  readonly asset: InstructedAsset;
  /** Base units (tinybar / token smallest unit) — exactly what a transfer
   *  body takes. Never decimals. */
  readonly amount: bigint;
  /** The transfer memo. This is the request's reference — see the module
   *  header for why omitting it breaks matching. */
  readonly memo: string;
  /** Consensus timestamp after which the merchant considers the request
   *  stale. Advisory to the wallet — the chain does not enforce it. */
  readonly expiresAt?: string;
}

/**
 * Distil a request into transfer fields. VALIDATES first (full
 * `createRequest`, checksums included) — an invalid request fails here, not
 * inside a wallet.
 */
export function paymentInstructions(request: PaymentRequest): PaymentInstructions {
  const { recipient, asset } = createRequest(request);
  return {
    network: recipient.network,
    recipient: entityKey(recipient.id),
    asset: toInstructedAsset(asset),
    amount: request.amount,
    memo: request.reference,
    ...(request.expiresAt !== undefined ? { expiresAt: request.expiresAt } : {}),
  };
}

/** A parsed asset in wallet terms — shared with `refundInstructions`, so the
 *  two ends of the money movement speak identical fields. */
export function toInstructedAsset(asset: AssetRef): InstructedAsset {
  return asset.kind === "hbar"
    ? { kind: "hbar" }
    : asset.kind === "token"
      ? { kind: "token", id: entityKey(asset.id) }
      : { kind: "nft", id: entityKey(asset.id), serial: asset.serial };
}
